// "Avisos de tus PR": cada 10 minutos se consultan tus PR abiertas en GitHub y se comparan con la foto
// anterior. Lo que cambia (CI en rojo, comentarios o revisiones de otros, cambios pedidos, aprobada,
// mergeada) queda como aviso en la app (tarjeta de Hoy) y sale como notificación del sistema.
import type { FastifyBaseLogger } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import type { PrAlert, PrAlertKind, PrDetail, PrFailures, PrList, PrListFilter, PrWatchStatus, PullRequestInfo } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { prAlerts, pullRequests, settings, tasks } from '../../db/schema.js';
import { GithubError, type GhPullRequest, type GithubClient } from '../../integrations/github/client.js';
import { t } from '../../i18n/index.js';

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
    alerts.push({ kind: 'ci_failed', title: t('prs.alert.ciFailed'), detail: pr.failingChecks.length ? t('prs.alert.failing', { checks: pr.failingChecks.slice(0, 3).join(', ') }) : null });
  }

  const since = Date.parse(prev.activityCursor ?? prev.lastSeenAt);
  const reviews = pr.reviews.filter((r) => Date.parse(r.at) > since);
  const comments = pr.comments.filter((c) => Date.parse(c.at) > since);
  const changes = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
  const approvals = reviews.filter((r) => r.state === 'APPROVED');
  if (changes.length) alerts.push({ kind: 'changes_requested', title: t('prs.alert.changesRequested'), detail: t('prs.alert.by', { people: people(changes.map((r) => r.author)) }) });
  if (approvals.length) alerts.push({ kind: 'approved', title: t('prs.alert.approved'), detail: t('prs.alert.by', { people: people(approvals.map((r) => r.author)) }) });
  // Los comentarios de una revisión con cambios pedidos ya van en ese aviso.
  const commentAuthors = [...comments.map((c) => c.author), ...reviews.filter((r) => r.state !== 'CHANGES_REQUESTED' && r.comments > 0).map((r) => r.author)];
  const count = comments.length + reviews.filter((r) => r.state !== 'CHANGES_REQUESTED').reduce((n, r) => n + r.comments, 0);
  if (count > 0) alerts.push({ kind: 'comments', title: count === 1 ? t('prs.alert.commentsOne') : t('prs.alert.commentsOther', { count }), detail: t('prs.alert.from', { people: people(commentAuthors) }) });

  const times = [...reviews.map((r) => r.at), ...comments.map((c) => c.at)];
  const cursor = times.length ? times.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : prev.activityCursor;
  return { alerts, cursor };
}

/** Lo que se guarda de una PR (sin `watched`, que solo cambia el usuario). */
function rowValues(pr: GhPullRequest, now: string, cursor: string | null, me: string) {
  return {
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    headRef: pr.headRef,
    author: pr.author,
    mine: !pr.author || pr.author.toLowerCase() === me.toLowerCase(),
    taskKey: taskKeyOf(pr.headRef, pr.title),
    checks: pr.checks,
    failingChecks: pr.failingChecks,
    ...reviewState(pr),
    activityCursor: cursor,
    updatedAt: pr.updatedAt,
    lastSeenAt: now,
  };
}

const toInfo = ({ activityCursor: _c, lastSeenAt: _l, ...pr }: PrRow): PullRequestInfo => pr;

function latestActivity(pr: GhPullRequest): string | null {
  const times = [...pr.reviews.map((r) => r.at), ...pr.comments.map((c) => c.at)].sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.at(-1) ?? null;
}

export class PrWatcher {
  private running: Promise<void> | null = null;
  private lastError: string | null = null;
  private searchWarning: string | null = null;

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
    if (!this.client) return Promise.reject(new GithubError(t('github.notConfigured')));
    this.running ??= this.run(this.client).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(client: GithubClient) {
    try {
      const now = new Date().toISOString();
      const { login, prs: mine } = await client.myOpenPrs();
      // Las de otras personas con la clave de una de tus tareas abiertas en el título: solo se enseñan en la tarea.
      const others = await this.othersWithTaskKeys(client, login, new Set(mine.map((p) => p.id)));
      const prs = [...mine, ...others];
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
          const values0 = rowValues(pr, now, cursor, login);
          if (prev) {
            ({ alerts, cursor } = diffPr(prev, pr));
            if (pr.state === 'merged' && prev.state !== 'merged') alerts.push({ kind: 'merged', title: t('prs.alert.merged'), detail: null });
          }
          // De las PR de otras personas no se avisa.
          if (!values0.mine) alerts = [];
          const values = { ...values0, activityCursor: cursor };
          tx.insert(pullRequests)
            .values({ id: pr.id, ...values })
            .onConflictDoUpdate({ target: pullRequests.id, set: values })
            .run();
          for (const alert of alerts) {
            tx.insert(prAlerts).values({ prId: pr.id, ...alert, createdAt: now }).run();
            // Sin observar: el aviso queda guardado (por si se vuelve a observar) pero no se notifica.
            if (prev?.watched !== false) fired.push({ pr, alert });
          }
        }
        const status: StoredStatus = { user: login, lastCheckedAt: now };
        tx.insert(settings).values({ key: STATUS_KEY, valueJson: status }).onConflictDoUpdate({ target: settings.key, set: { valueJson: status } }).run();
      });
      this.lastError = warning ?? this.searchWarning;
      this.searchWarning = null;

      for (const { pr, alert } of fired) {
        const repo = pr.repo.split('/').pop();
        await Promise.resolve(this.notify(`${alert.title} · ${repo} #${pr.number}`, [pr.title, alert.detail].filter(Boolean).join('\n'))).catch(() => {});
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Claves de las tareas sin terminar, que son las que se buscan en los títulos de las PR. */
  private openTaskKeys(): string[] {
    return this.db
      .select({ key: tasks.jiraKey })
      .from(tasks)
      .where(or(isNull(tasks.statusCategory), ne(tasks.statusCategory, 'done')))
      .all()
      .map((r) => r.key);
  }

  /** Si la búsqueda falla (límite de GitHub, permisos) la comprobación sigue con tus PR y queda el motivo. */
  private async othersWithTaskKeys(client: GithubClient, login: string, known: Set<string>): Promise<GhPullRequest[]> {
    const keys = this.openTaskKeys();
    if (!keys.length) return [];
    try {
      return (await client.openPrsWithKeys(keys, login)).filter((p) => !known.has(p.id));
    } catch (err) {
      this.searchWarning = err instanceof Error ? err.message : String(err);
      return [];
    }
  }

  /** Avisos de los últimos `days` días de las PR que siguen abiertas, del más reciente al más antiguo. */
  alerts(days = 3, limit = 20): PrAlert[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db
      .select({ a: prAlerts, pr: pullRequests })
      .from(prAlerts)
      .innerJoin(pullRequests, eq(pullRequests.id, prAlerts.prId))
      .where(and(gte(prAlerts.createdAt, since), eq(pullRequests.watched, true), eq(pullRequests.state, 'open')))
      .orderBy(desc(prAlerts.createdAt), desc(prAlerts.id))
      .limit(limit)
      .all()
      .map(({ a, pr }) => ({ id: a.id, kind: a.kind, prId: pr.id, repo: pr.repo, number: pr.number, url: pr.url, taskKey: pr.taskKey, title: a.title, prTitle: pr.title, detail: a.detail, createdAt: a.createdAt }));
  }

  /** PR de una tarea (abiertas y ya mergeadas o cerradas), la más reciente primero. */
  forTask(key: string): PullRequestInfo[] {
    return this.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.taskKey, key))
      .orderBy(desc(pullRequests.updatedAt))
      .all()
      .map(toInfo);
  }

  /** Tus PR: las abiertas que ya conoce la app; las mergeadas y cerradas se piden a GitHub al momento. */
  async list(filter: PrListFilter): Promise<PrList> {
    let error: string | null = null;
    if (filter !== 'open' && this.client) {
      try {
        const { login, prs } = await this.client.myClosedPrs();
        const now = new Date().toISOString();
        this.db.transaction((tx) => {
          for (const pr of prs) {
            const prev = tx.select().from(pullRequests).where(eq(pullRequests.id, pr.id)).get();
            const values = rowValues(pr, now, prev ? prev.activityCursor : latestActivity(pr), login);
            tx.insert(pullRequests).values({ id: pr.id, ...values }).onConflictDoUpdate({ target: pullRequests.id, set: values }).run();
          }
        });
      } catch (err) {
        if (!(err instanceof GithubError)) throw err;
        error = err.message;
      }
    }
    const states = filter === 'all' ? (['open', 'merged', 'closed'] as const) : ([filter] as const);
    const prs = this.db
      .select()
      .from(pullRequests)
      .where(and(inArray(pullRequests.state, [...states]), eq(pullRequests.mine, true)))
      .orderBy(desc(pullRequests.updatedAt))
      .all()
      .map(toInfo);
    return { prs, error };
  }

  /** La PR con sus avisos (también los de cuando no se observaba). null si la app no la conoce. */
  detail(prId: string): PrDetail | null {
    const pr = this.pr(prId);
    if (!pr) return null;
    const alerts = this.db
      .select()
      .from(prAlerts)
      .where(eq(prAlerts.prId, prId))
      .orderBy(desc(prAlerts.createdAt), desc(prAlerts.id))
      .limit(30)
      .all()
      .map((a) => ({ id: a.id, kind: a.kind, prId, repo: pr.repo, number: pr.number, url: pr.url, taskKey: pr.taskKey, title: a.title, prTitle: pr.title, detail: a.detail, createdAt: a.createdAt }));
    return { ...pr, alerts };
  }

  /** Observar o no la PR. null si la app no la conoce. */
  setWatched(prId: string, watched: boolean): PullRequestInfo | null {
    if (!this.pr(prId)) return null;
    this.db.update(pullRequests).set({ watched }).where(eq(pullRequests.id, prId)).run();
    return this.pr(prId);
  }

  /** null si la PR no es una de las tuyas que conoce la app. */
  pr(prId: string): PullRequestInfo | null {
    const row = this.db.select().from(pullRequests).where(eq(pullRequests.id, prId)).get();
    return row ? toInfo(row) : null;
  }

  /** Los checks en rojo de la PR tal como están ahora en GitHub. null si la PR no es una de las tuyas. */
  async failures(prId: string): Promise<PrFailures | null> {
    if (!this.client) throw new GithubError(t('github.notConfigured'));
    const pr = this.pr(prId);
    if (!pr) return null;
    const { checks, failures, passing, pending } = await this.client.checkFailures(prId);
    return { prId, repo: pr.repo, number: pr.number, url: pr.url, taskKey: pr.taskKey, checks, failures, passing, pending };
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
