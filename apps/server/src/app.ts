import { join } from 'node:path';
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
import { DiaryFeed } from './modules/journal/feed.js';
import { journalRoutes } from './modules/journal/routes.js';
import { notesRoutes, type NotesRoutesOptions } from './modules/notes/routes.js';
import type { GitRunner } from './modules/repos/git.js';
import { opencodeSkillRoutes } from './modules/opencode/skill.js';
import type { OpencodeApi } from './integrations/opencode/api.js';
import { AiOptionsService, AiSettingsStore } from './modules/opencode/ai-settings.js';
import { TaskChatService } from './modules/opencode/chat.js';
import { OpencodeChat } from './modules/opencode/chat-core.js';
import { GeneralChatService } from './modules/opencode/general-chat.js';
import { McpService } from './modules/opencode/mcp.js';
import { opencodeAiRoutes } from './modules/opencode/routes.js';
import { remindersRoutes } from './modules/reminders/routes.js';
import { reposRoutes } from './modules/repos/routes.js';
import { JiraSync } from './modules/tasks/jira-sync.js';
import { JiraCreateService } from './modules/tasks/jira-create.js';
import { JiraUpdateService } from './modules/tasks/jira-update.js';
import { TasksRepository } from './modules/tasks/repository.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { PrWatcher } from './modules/prs/watcher.js';
import { PrFixService } from './modules/prs/fix.js';
import { prsRoutes } from './modules/prs/routes.js';
import { webRoutes } from './modules/system/web.js';
import { Autostart, REPO_ROOT } from './modules/system/autostart.js';
import { Backups } from './modules/system/backup.js';
import { systemRoutes } from './modules/system/routes.js';
import { languageRoutes } from './modules/system/language.js';
import { DevSessionService, type TerminalLauncher } from './modules/tasks/session.js';
import { t, type MessageKey } from './i18n/index.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Permite sustituir la descarga de títulos de enlaces en los tests. */
  fetchTitle?: NotesRoutesOptions['fetchTitle'];
  /** Modelo de IA (opencode). Sin él, las funciones con IA responden que no está disponible. */
  llm?: Llm;
  /** API de opencode para las sesiones de desarrollo en la app y la lista de modelos. Sin ella, dicen que no está disponible. */
  opencode?: OpencodeApi | null;
  /** Sincronización con JIRA. Sin ella, la sección de tareas indica que falta configurar JIRA. */
  jiraSync?: JiraSync;
  prWatcher?: PrWatcher;
  /** Carpeta de la web compilada que sirve el servidor; por defecto apps/web/dist si existe. */
  webDist?: string;
  /** Arranque automático (Ajustes); por defecto, el de este equipo. */
  autostart?: Autostart;
  /** Copias de la base de datos (Ajustes); sin ellas, Ajustes dice que no hay. */
  backups?: Backups;
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

/** Mensajes propios de los esquemas de @dev-assistant/shared (en castellano) → su clave, para responder en el idioma de la app. */
const SHARED_MESSAGES = new Map<string, MessageKey>(Object.entries({
  'Clave de JIRA no válida (ej.: ABC-123)': 'validation.jiraKey',
  'El título es obligatorio': 'validation.titleRequired',
  'Elige al menos un día': 'validation.pickADay',
  'Escribe qué quieres recordar': 'validation.reminderTitleRequired',
  'El comentario está vacío': 'validation.commentEmpty',
  'Clave de proyecto de JIRA no válida (ej.: ABC)': 'validation.projectKey',
  'El repo de GitHub debe ser dueño/nombre': 'validation.githubRepo',
} satisfies Record<string, MessageKey>) as [string, MessageKey][]);
const sharedMessage = (message: string) => {
  const key = SHARED_MESSAGES.get(message);
  return key ? t(key) : message;
};

const noLlm: Llm = {
  complete: async () => {
    throw new LlmUnavailableError(t('ai.notConfigured'));
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
      return reply.code(400).send({ error: err.issues.map((i) => sharedMessage(i.message)).join('; ') });
    }
    if (err instanceof LlmUnavailableError || err instanceof JiraError) {
      return reply.code(503).send({ error: err.message });
    }
    return reply.send(err);
  });

  // Módulos (dev-sessions, repos... se añaden en sus hilos).
  // Primero el idioma: los demás módulos ya responden en el elegido.
  await app.register(languageRoutes, { db });
  await app.register(notesRoutes, { db, fetchTitle: opts.fetchTitle });
  await app.register(remindersRoutes, { db });
  const config = loadConfig();
  const devAssistantHome = opts.devAssistantHome ?? config.devAssistantHome;
  // Los commits que anota opencode en HISTORIAL.md entran en el diario antes de leerlo.
  const diaryFeed = new DiaryFeed(db, devAssistantHome);
  await app.register(journalRoutes, { db, diaryFeed });
  await app.register(aiRoutes, { db, llm: opts.llm ?? noLlm, diaryFeed, devAssistantHome });
  const tasksRepo = new TasksRepository(db);
  const sessions = new DevSessionService(db, tasksRepo, devAssistantHome, opts.git, opts.terminalLauncher, opts.opencodeSkillsDir ?? config.opencodeSkillsDir, opts.jiraClient ?? null);
  await app.register(tasksRoutes, {
    db,
    jiraSync: opts.jiraSync ?? new JiraSync(db, tasksRepo, null, ''),
    jiraUpdates: new JiraUpdateService(db, tasksRepo, opts.jiraClient ?? null, opts.llm ?? noLlm, devAssistantHome),
    jiraCreate: new JiraCreateService(db, tasksRepo, opts.jiraClient ?? null, opts.llm ?? noLlm),
    devAssistantHome,
    sessions,
  });
  await app.register(systemRoutes, {
    autostart:
      opts.autostart ??
      new Autostart(db, { platform: process.platform, appData: process.env.APPDATA, repoRoot: REPO_ROOT, logFile: join(devAssistantHome, 'logs', 'app.log') }),
    backups: opts.backups ?? new Backups(null, join(devAssistantHome, 'copias')),
  });
  await app.register(webRoutes, { dist: opts.webDist });
  await app.register(reposRoutes, { db, llm: opts.llm ?? noLlm, git: opts.git });
  const aiSettings = new AiSettingsStore(db);
  const aiOptions = new AiOptionsService(opts.opencode ?? null);
  const opencodeChat = new OpencodeChat(opts.opencode ?? null, aiOptions);
  const taskChat = new TaskChatService(db, opencodeChat, sessions, aiSettings);
  const generalChat = new GeneralChatService(db, opencodeChat, aiSettings, devAssistantHome);
  await app.register(opencodeAiRoutes, { aiSettings, aiOptions, chat: taskChat, general: generalChat, mcp: new McpService(opts.opencode ?? null) });
  const prWatcher = opts.prWatcher ?? new PrWatcher(db, null);
  await app.register(prsRoutes, { prWatcher, prFix: new PrFixService(prWatcher, taskChat, generalChat) });
  await app.register(opencodeSkillRoutes, { skillsDir: opts.opencodeSkillsDir ?? config.opencodeSkillsDir });
  return app;
}
