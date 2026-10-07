import { join } from 'node:path';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { HealthResponse } from '@dev-assistant/shared';
import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import { JiraClient, JiraError } from './integrations/jira/client.js';
import { LlmUnavailableError, type Llm } from './integrations/opencode/llm.js';
import { aiRoutes } from './modules/ai/routes.js';
import { DiaryFeed } from './modules/journal/feed.js';
import { journalRoutes } from './modules/journal/routes.js';
import { notesRoutes, type NotesRoutesOptions } from './modules/notes/routes.js';
import type { GitRunner } from './modules/repos/git.js';
import { opencodeSkillRoutes } from './modules/opencode/skill.js';
import { remindersRoutes } from './modules/reminders/routes.js';
import { reposRoutes } from './modules/repos/routes.js';
import { JiraSync } from './modules/tasks/jira-sync.js';
import { JiraUpdateService } from './modules/tasks/jira-update.js';
import { TasksRepository } from './modules/tasks/repository.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { PrWatcher } from './modules/prs/watcher.js';
import { prsRoutes } from './modules/prs/routes.js';
import { webRoutes } from './modules/system/web.js';
import { Autostart, REPO_ROOT } from './modules/system/autostart.js';
import { Backups } from './modules/system/backup.js';
import { systemRoutes } from './modules/system/routes.js';
import { Connections } from './modules/system/connections.js';
import { GithubClient } from './integrations/github/client.js';
import { DevSessionService, type TerminalLauncher } from './modules/tasks/session.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Permite sustituir la descarga de títulos de enlaces en los tests. */
  fetchTitle?: NotesRoutesOptions['fetchTitle'];
  /** Modelo de IA (opencode). Sin él, las funciones con IA responden que no está disponible. */
  llm?: Llm;
  /** Sincronización con JIRA. Sin ella, la sección de tareas indica que falta configurar JIRA. */
  jiraSync?: JiraSync;
  prWatcher?: PrWatcher;
  /** Carpeta de la web compilada que sirve el servidor; por defecto apps/web/dist si existe. */
  webDist?: string;
  /** Arranque automático (Ajustes); por defecto, el de este equipo. */
  autostart?: Autostart;
  /** Copias de la base de datos (Ajustes); sin ellas, Ajustes dice que no hay. */
  backups?: Backups;
  /** Ajustes > Conexiones; por defecto, el .env de la app y process.env. */
  connections?: Connections;
  /** Cliente REST de JIRA (estados posibles y refresco tras actualizar). */
  jiraClient?: JiraClient | null;
  /** Carpeta de trabajo (worktrees y ficheros de cada tarea). Por defecto ~/.dev-assistant. */
  devAssistantHome?: string;
  /** git en los tests de repositorios. */
  git?: GitRunner;
  /** Carpeta global de skills de opencode. Por defecto ~/.config/opencode/skill. */
  opencodeSkillsDir?: string;
  /** Abre opencode en una terminal (sesión de desarrollo); por defecto, una ventana nueva en Windows. */
  terminalLauncher?: TerminalLauncher;
}

const noLlm: Llm = {
  complete: async () => {
    throw new LlmUnavailableError('La IA no está configurada.');
  },
};

export async function buildApp(db: Db, opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    let dbStatus: HealthResponse['db'] = 'ok';
    try {
      db.get(sql`select 1`);
    } catch {
      dbStatus = 'error';
    }
    return { status: 'ok', version: '0.1.0', db: dbStatus };
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    }
    if (err instanceof LlmUnavailableError || err instanceof JiraError) {
      return reply.code(503).send({ error: err.message });
    }
    return reply.send(err);
  });

  // Módulos (dev-sessions, repos... se añaden en sus hilos).
  await app.register(notesRoutes, { db, fetchTitle: opts.fetchTitle });
  await app.register(remindersRoutes, { db });
  const config = loadConfig();
  const devAssistantHome = opts.devAssistantHome ?? config.devAssistantHome;
  // Los commits que anota opencode en HISTORIAL.md entran en el diario antes de leerlo.
  const diaryFeed = new DiaryFeed(db, devAssistantHome);
  await app.register(journalRoutes, { db, diaryFeed });
  await app.register(aiRoutes, { db, llm: opts.llm ?? noLlm, diaryFeed });
  const tasksRepo = new TasksRepository(db);
  const jiraSync = opts.jiraSync ?? new JiraSync(db, tasksRepo, null, '');
  const jiraUpdates = new JiraUpdateService(db, tasksRepo, opts.jiraClient ?? null, opts.llm ?? noLlm, devAssistantHome);
  const prWatcher = opts.prWatcher ?? new PrWatcher(db, null);
  // Lo que se cambia en Ajustes > Conexiones se aplica al momento, sin reiniciar.
  const connections = opts.connections ?? new Connections(join(REPO_ROOT, '.env'));
  connections.onChange((env, changed) => {
    const cfg = loadConfig(env);
    if (changed.jira) {
      const jira = cfg.jira ? new JiraClient(cfg.jira) : null;
      jiraSync.setClient(jira, cfg.jira?.jql ?? '');
      jiraUpdates.setClient(jira);
      if (jira) void jiraSync.sync().catch(() => {});
    }
    if (changed.github) {
      prWatcher.setClient(cfg.github ? new GithubClient(cfg.github) : null);
      if (cfg.github) void prWatcher.check().catch(() => {});
    }
  });
  await app.register(tasksRoutes, {
    db,
    jiraSync,
    jiraUpdates,
    devAssistantHome,
    sessions: new DevSessionService(db, tasksRepo, devAssistantHome, opts.git, opts.terminalLauncher),
  });
  await app.register(systemRoutes, {
    autostart:
      opts.autostart ??
      new Autostart(db, { platform: process.platform, appData: process.env.APPDATA, repoRoot: REPO_ROOT, logFile: join(devAssistantHome, 'logs', 'app.log') }),
    backups: opts.backups ?? new Backups(null, join(devAssistantHome, 'copias')),
    connections,
  });
  await app.register(webRoutes, { dist: opts.webDist });
  await app.register(prsRoutes, { prWatcher });
  await app.register(reposRoutes, { db, llm: opts.llm ?? noLlm, git: opts.git });
  await app.register(opencodeSkillRoutes, { skillsDir: opts.opencodeSkillsDir ?? config.opencodeSkillsDir });
  return app;
}
