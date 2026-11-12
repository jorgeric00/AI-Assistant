import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import type { JiraSyncStatus } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { JiraError, type JiraClient } from '../../integrations/jira/client.js';
import { t } from '../../i18n/index.js';
import type { TasksRepository } from './repository.js';

const INTERVAL_MS = 15 * 60_000;
const LAST_SYNC_KEY = 'jira.lastSync';

/** Resultado de la última sincronización correcta (tabla `settings`, sobrevive a reinicios). */
interface LastSync {
  at: string;
  user: string;
  count: number;
}

/** Sincronización de tareas de JIRA: con el botón "Sincronizar" y cada 15 minutos (diseño, 5.3). */
export class JiraSync {
  private running: Promise<LastSync> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly repo: TasksRepository,
    private readonly client: JiraClient | null,
    private readonly jql: string,
  ) {}

  private lastSync(): LastSync | null {
    return (this.db.select().from(settings).where(eq(settings.key, LAST_SYNC_KEY)).get()?.valueJson as LastSync | undefined) ?? null;
  }

  /** Estado de la lectura; si se puede escribir lo añade la ruta. */
  status(): Omit<JiraSyncStatus, 'writeProblem'> {
    const last = this.lastSync();
    return {
      configured: !!this.client,
      syncing: !!this.running,
      lastSyncedAt: last?.at ?? this.repo.lastSyncedAt(),
      user: last?.user ?? null,
      lastCount: last?.count ?? null,
      lastError: this.lastError,
    };
  }

  /** Trae las tareas de la JQL y completa las claves escritas en notas. Devuelve cuántas se actualizaron. */
  sync(): Promise<LastSync> {
    if (!this.client) return Promise.reject(new JiraError(t('jira.notConfigured')));
    this.running ??= this.run(this.client).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(client: JiraClient): Promise<LastSync> {
    try {
      const syncedAt = new Date().toISOString();
      const user = await client.myself();
      const issues = await client.search(this.jql);
      const found = new Set(issues.map((i) => i.key));
      // Claves de notas que no están en la JQL (p. ej. tareas de otra persona): se piden una a una.
      // Las importadas de otra persona también se actualizan.
      const imported = new Set(this.repo.importedKeys().filter((k) => !found.has(k)));
      for (const key of [...this.repo.unsyncedKeys(), ...imported].filter((k) => !found.has(k))) {
        // Una clave mal escrita o sin permiso no debe frenar el resto de la sincronización.
        const issue = await client.getIssue(key).catch(() => null);
        if (issue) issues.push(issue);
      }
      this.repo.upsertFromJira(issues, syncedAt, imported);
      const last: LastSync = { at: syncedAt, user, count: issues.length };
      this.db
        .insert(settings)
        .values({ key: LAST_SYNC_KEY, valueJson: last })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: last } })
        .run();
      this.lastError = null;
      return last;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Sincroniza al arrancar y cada 15 minutos. Sin JIRA configurado no hace nada. */
  start(log: FastifyBaseLogger) {
    if (!this.client) return () => {};
    const tick = () =>
      this.sync().then(
        (last) => log.info(`JIRA sincronizado como ${last.user}: ${last.count} tareas`),
        (err: unknown) => log.warn(`No se pudo sincronizar JIRA: ${err instanceof Error ? err.message : String(err)}`),
      );
    void tick();
    const timer = setInterval(tick, INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
