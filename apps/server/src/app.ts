import cors from '@fastify/cors';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { HealthResponse } from '@dev-assistant/shared';
import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import { JiraError, type JiraClient } from './integrations/jira/client.js';
import { LlmUnavailableError, type Llm } from './integrations/opencode/llm.js';
import { aiRoutes } from './modules/ai/routes.js';
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
import { DevSessionService, type TerminalLauncher } from './modules/tasks/session.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Permite sustituir la descarga de títulos de enlaces en los tests. */
  fetchTitle?: NotesRoutesOptions['fetchTitle'];
  /** Modelo de IA (opencode). Sin él, las funciones con IA responden que no está disponible. */
  llm?: Llm;
  /** Sincronización con JIRA. Sin ella, la sección de tareas indica que falta configurar JIRA. */
  jiraSync?: JiraSync;
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
  await app.register(journalRoutes, { db });
  await app.register(aiRoutes, { db, llm: opts.llm ?? noLlm });
  const config = loadConfig();
  const devAssistantHome = opts.devAssistantHome ?? config.devAssistantHome;
  const tasksRepo = new TasksRepository(db);
  await app.register(tasksRoutes, {
    db,
    jiraSync: opts.jiraSync ?? new JiraSync(db, tasksRepo, null, ''),
    jiraUpdates: new JiraUpdateService(db, tasksRepo, opts.jiraClient ?? null, opts.llm ?? noLlm, devAssistantHome),
    devAssistantHome,
    sessions: new DevSessionService(db, tasksRepo, devAssistantHome, opts.git, opts.terminalLauncher),
  });
  await app.register(reposRoutes, { db, llm: opts.llm ?? noLlm, git: opts.git });
  await app.register(opencodeSkillRoutes, { skillsDir: opts.opencodeSkillsDir ?? config.opencodeSkillsDir });
  return app;
}
