// "Avisos de tus PR": cada 10 minutos se consultan tus PR abiertas en GitHub y se comparan con la foto
// anterior. Lo que cambia (CI en rojo, comentarios o revisiones de otros, cambios pedidos, aprobada,
// mergeada) queda como aviso en la app (tarjeta de Hoy) y sale como notificación del sistema.
import type { FastifyBaseLogger } from 'fastify';
import { desc, eq, gte } from 'drizzle-orm';
import type { PrAlert, PrAlertKind, PrWatchStatus, PullRequestInfo } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { prAlerts, pullRequests, settings } from '../../db/schema.js';
import { GithubError, type GhPullRequest, type GithubClient } from '../../integrations/github/client.js';

const INTERVAL_MS = 10 * 60_000;
const STATUS_KEY = 'github.prWatch';

/** Notificación del sistema (en Windows, el centro de notificaciones). */
export type DesktopNotify = (title: string, message: string) => Promise<void> | void;

interface StoredStatus {
  user: string;
  lastCheckedAt: string;
}

type PrRow = typeof pullRequests.$inferSelect;
type NewAlert = { kind: PrAlertKind; title: string; detail: string | null };

const KEY_RE = /([A-Z][A-Z0-9_]+-\d+)/;

/** Clave de JIRA de la PR: primero la rama (feature/ABC-1-...), luego el título ([ABC-1] ...). */
export function taskKeyOf(headRef: string, title: string): string | null {
  return headRef.toUpperCase().match(KEY_RE)?.[1] ?? title.match(KEY_RE)?.[1] ?? null;
}

const people = (names: string[]) => [...new Set(names)].join(', ');

/** Revisión vigente: la última de cada persona cuenta para aprobado / cambios pedidos. */
function reviewState(pr: GhPullRequest) {
  const latest = new Map<string, string>();
  for (const r of [...pr.reviews].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(r.author, r.state);
  }
  const by = (state: string) => [...latest].filter(([, s]) => s === state).map(([a]) => a);
  return {
    approvedBy: by('APPROVED'),
    changesRequestedBy: by('CHANGES_REQUESTED'),
    comments: pr.comments.length + pr.reviews.reduce((n, r) => n + r.comments, 0),
  };
}

/** Avisos que salen de comparar la foto anterior de una PR con la actual. */
export function diffPr(prev: PrRow, pr: GhPullRequest): { alerts: NewAlert[]; cursor: string | null } {
  const alerts: NewAlert[] = [];
  if (pr.checks === 'failure' && prev.checks !== 'failure') {
    alerts.push({ kind: 'ci_failed', title: 'CI en rojo', detail: pr.failingChecks.length ? `Falla ${pr.failingChecks.slice(0, 3).join(', ')}` : null });
  }

  const since = Date.parse(prev.activityCursor ?? prev.lastSeenAt);
  const reviews = pr.reviews.filter((r) => Date.parse(r.at) > since);
  const comments = pr.comments.filter((c) => Date.parse(c.at) > since);
  const changes = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
  const approvals = reviews.filter((r) => r.state === 'APPROVED');
  if (changes.length) alerts.push({ kind: 'changes_requested', title: 'Cambios pedidos', detail: `Por ${people(changes.map((r) => r.author))}` });
  if (approvals.length) alerts.push({ kind: 'approved', title: 'Aprobada', detail: `Por ${people(approvals.map((r) => r.author))}` });
  // Los comentarios de una revisión con cambios pedidos ya van en ese aviso.
  const commentAuthors = [...comments.map((c) => c.author), ...reviews.filter((r) => r.state !== 'CHANGES_REQUESTED' && r.comments > 0).map((r) => r.author)];
  const count = comments.length + reviews.filter((r) => r.state !== 'CHANGES_REQUESTED').reduce((n, r) => n + r.comments, 0);
  if (count > 0) alerts.push({ kind: 'comments', title: count === 1 ? '1 comentario nuevo' : `${count} comentarios nuevos`, detail: `De ${people(commentAuthors)}` });

  const times = [...reviews.map((r) => r.at), ...comments.map((c) => c.at)];
  const cursor = times.length ? times.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : prev.activityCursor;
  return { alerts, cursor };
}

function latestActivity(pr: GhPullRequest): string | null {
  const times = [...pr.reviews.map((r) => r.at), ...pr.comments.map((c) => c.at)].sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.at(-1) ?? null;
}

export class PrWatcher {
  private running: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly client: GithubClient | null,
    private readonly notify: DesktopNotify = () => {},
  ) {}

  private stored(): StoredStatus | null {
    return (this.db.select().from(settings).where(eq(settings.key, STATUS_KEY)).get()?.valueJson as StoredStatus | undefined) ?? null;
  }

  status(): PrWatchStatus {
    const s = this.stored();
    return { configured: !!this.client, user: s?.user ?? null, lastCheckedAt: s?.lastCheckedAt ?? null, lastError: this.lastError };
  }

  /** Una consulta a GitHub. Si ya hay una en marcha, espera a esa. */
  check(): Promise<void> {
    if (!this.client) return Promise.reject(new GithubError('GitHub no está configurado: añade GITHUB_TOKEN al fichero .env.'));
    this.running ??= this.run(this.client).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(client: GithubClient) {
    try {
      const now = new Date().toISOString();
      const { login, prs } = await client.myOpenPrs();
      const openIds = new Set(prs.map((p) => p.id));
      // Las que estaban abiertas y ya no salen: se mergearon o se cerraron.
      const gone = this.db
        .select({ id: pullRequests.id })
        .from(pullRequests)
        .where(eq(pullRequests.state, 'open'))
        .all()
        .map((r) => r.id)
        .filter((id) => !openIds.has(id));
      const closed = await client.prsByIds(gone, login);
      const warning = client.warnings[0] ?? null;

      const fired: { pr: GhPullRequest; alert: NewAlert }[] = [];
      this.db.transaction((tx) => {
        for (const pr of [...prs, ...closed]) {
          const prev = tx.select().from(pullRequests).where(eq(pullRequests.id, pr.id)).get();
          let alerts: NewAlert[] = [];
          let cursor = latestActivity(pr);
          if (prev) {
            ({ alerts, cursor } = diffPr(prev, pr));
            if (pr.state === 'merged' && prev.state !== 'merged') alerts.push({ kind: 'merged', title: 'Mergeada', detail: null });
          }
          const values = {
            repo: pr.repo,
            number: pr.number,
            title: pr.title,
            url: pr.url,
            state: pr.state,
            isDraft: pr.isDraft,
            headRef: pr.headRef,
            taskKey: taskKeyOf(pr.headRef, pr.title),
            checks: pr.checks,
            failingChecks: pr.failingChecks,
            ...reviewState(pr),
            activityCursor: cursor,
            updatedAt: pr.updatedAt,
            lastSeenAt: now,
          };
          tx.insert(pullRequests)
            .values({ id: pr.id, ...values })
            .onConflictDoUpdate({ target: pullRequests.id, set: values })
            .run();
          for (const alert of alerts) {
            tx.insert(prAlerts).values({ prId: pr.id, ...alert, createdAt: now }).run();
            fired.push({ pr, alert });
          }
        }
        const status: StoredStatus = { user: login, lastCheckedAt: now };
        tx.insert(settings).values({ key: STATUS_KEY, valueJson: status }).onConflictDoUpdate({ target: settings.key, set: { valueJson: status } }).run();
      });
      this.lastError = warning;

      for (const { pr, alert } of fired) {
        const repo = pr.repo.split('/').pop();
        await Promise.resolve(this.notify(`${alert.title} · ${repo} #${pr.number}`, [pr.title, alert.detail].filter(Boolean).join('\n'))).catch(() => {});
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Avisos de los últimos `days` días, del más reciente al más antiguo. */
  alerts(days = 3, limit = 20): PrAlert[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db
      .select({ a: prAlerts, pr: pullRequests })
      .from(prAlerts)
      .innerJoin(pullRequests, eq(pullRequests.id, prAlerts.prId))
      .where(gte(prAlerts.createdAt, since))
      .orderBy(desc(prAlerts.createdAt), desc(prAlerts.id))
      .limit(limit)
      .all()
      .map(({ a, pr }) => ({ id: a.id, kind: a.kind, repo: pr.repo, number: pr.number, url: pr.url, taskKey: pr.taskKey, title: a.title, detail: a.detail, createdAt: a.createdAt }));
  }

  /** PR de una tarea (abiertas y ya mergeadas o cerradas), la más reciente primero. */
  forTask(key: string): PullRequestInfo[] {
    return this.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.taskKey, key))
      .orderBy(desc(pullRequests.updatedAt))
      .all()
      .map(({ activityCursor: _c, lastSeenAt: _l, ...pr }) => pr);
  }

  /** Comprueba al arrancar y cada 10 minutos. Sin GITHUB_TOKEN no hace nada. */
  start(log: FastifyBaseLogger) {
    if (!this.client) return () => {};
    const tick = () => this.check().catch((err: unknown) => log.warn(`No se pudieron consultar tus PR en GitHub: ${err instanceof Error ? err.message : String(err)}`));
    void tick();
    const timer = setInterval(tick, INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
