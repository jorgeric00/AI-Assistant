import type { FastifyBaseLogger } from 'fastify';
import type { JiraSyncStatus } from '@dev-assistant/shared';
import { JiraError, type JiraClient } from '../../integrations/jira/client.js';
import type { TasksRepository } from './repository.js';

const INTERVAL_MS = 15 * 60_000;

/** Sincronización de tareas de JIRA: con el botón "Sincronizar" y cada 15 minutos (diseño, 5.3). */
export class JiraSync {
  private running: Promise<number> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly repo: TasksRepository,
    private readonly client: JiraClient | null,
    private readonly jql: string,
  ) {}

  status(): JiraSyncStatus {
    return { configured: !!this.client, syncing: !!this.running, lastSyncedAt: this.repo.lastSyncedAt(), lastError: this.lastError };
  }

  /** Trae las tareas de la JQL y completa las claves escritas en notas. Devuelve cuántas se actualizaron. */
  sync(): Promise<number> {
    if (!this.client) return Promise.reject(new JiraError('JIRA no está configurado: añade JIRA_URL y JIRA_TOKEN al fichero .env.'));
    this.running ??= this.run(this.client).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(client: JiraClient): Promise<number> {
    try {
      const syncedAt = new Date().toISOString();
      const issues = await client.search(this.jql);
      const found = new Set(issues.map((i) => i.key));
      // Claves de notas que no están en la JQL (p. ej. tareas de otra persona): se piden una a una.
      for (const key of this.repo.unsyncedKeys().filter((k) => !found.has(k))) {
        // Una clave mal escrita o sin permiso no debe frenar el resto de la sincronización.
        const issue = await client.getIssue(key).catch(() => null);
        if (issue) issues.push(issue);
      }
      this.repo.upsertFromJira(issues, syncedAt);
      this.lastError = null;
      return issues.length;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Sincroniza al arrancar y cada 15 minutos. Sin JIRA configurado no hace nada. */
  start(log: FastifyBaseLogger) {
    if (!this.client) return () => {};
    const tick = () => this.sync().catch((err: unknown) => log.warn({ err }, 'No se pudo sincronizar JIRA'));
    void tick();
    const timer = setInterval(tick, INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
