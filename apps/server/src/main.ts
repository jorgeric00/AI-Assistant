import { join } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { GithubClient } from './integrations/github/client.js';
import { JiraClient } from './integrations/jira/client.js';
import { PrWatcher } from './modules/prs/watcher.js';
import { AUTOSTART_ENV, Autostart, REPO_ROOT, openInBrowser } from './modules/system/autostart.js';
import { Backups } from './modules/system/backup.js';
import { OpencodeApi } from './integrations/opencode/api.js';
import { createOpencodeConnection } from './integrations/opencode/connection.js';
import { createOpencodeLlm } from './integrations/opencode/llm.js';
import { AiSettingsStore } from './modules/opencode/ai-settings.js';
import { RemindersRepository } from './modules/reminders/repository.js';
import { startReminderScheduler } from './modules/reminders/scheduler.js';
import { desktopNotifier, notifyDesktop } from './modules/reminders/system-notifier.js';
import { JiraSync } from './modules/tasks/jira-sync.js';
import { TasksRepository } from './modules/tasks/repository.js';

const config = loadConfig();
const { db, sqlite } = openDatabase(config.databasePath);
// opencode arranca solo la primera vez que se usa la IA (o se usa el que indique OPENCODE_URL).
const opencode = createOpencodeConnection({ url: config.opencodeUrl, password: config.opencodePassword, username: process.env.OPENCODE_SERVER_USERNAME || undefined });
const aiSettings = new AiSettingsStore(db);
// La IA de la app usa el modelo elegido en Ajustes (o el predeterminado de opencode).
const llm = createOpencodeLlm({ connection: opencode, model: () => aiSettings.get().appModel });
const jiraClient = config.jira ? new JiraClient(config.jira) : null;
const jiraSync = new JiraSync(db, new TasksRepository(db), jiraClient, config.jira?.jql ?? '');
const prWatcher = new PrWatcher(db, config.github ? new GithubClient(config.github) : null, notifyDesktop);
const autostart = new Autostart(db, { platform: process.platform, appData: process.env.APPDATA, repoRoot: REPO_ROOT, logFile: join(config.devAssistantHome, 'logs', 'app.log') });
const backups = new Backups(sqlite, join(config.devAssistantHome, 'copias'));
const app = await buildApp(db, { logger: true, llm, opencode: new OpencodeApi(opencode), jiraSync, jiraClient, prWatcher, autostart, backups });
app.addHook('onClose', async () => opencode.close());
await app.listen({ host: config.host, port: config.port });

// Recordatorios: aviso en la app y notificación del sistema (Teams queda pospuesto).
startReminderScheduler(new RemindersRepository(db), desktopNotifier, app.log);

// Tareas de JIRA: al arrancar y cada 15 minutos (si JIRA está configurado en .env).
jiraSync.start(app.log);

// Avisos de tus PR: al arrancar y cada 10 minutos (si GITHUB_TOKEN está en .env).
prWatcher.start(app.log);

// Copia de la base de datos: una al día en ~/.dev-assistant/copias (se guardan 7).
backups.start(app.log);

// Si arrancó sola al iniciar sesión (Ajustes > Arranque), abre la app en el navegador.
if (process.env[AUTOSTART_ENV] === '1' && autostart.openBrowser()) openInBrowser(`http://127.0.0.1:${config.port}`);
