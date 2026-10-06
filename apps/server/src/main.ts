import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { JiraClient } from './integrations/jira/client.js';
import { McpJiraWriter } from './integrations/jira/mcp-writer.js';
import { createOpencodeLlm } from './integrations/opencode/llm.js';
import { RemindersRepository } from './modules/reminders/repository.js';
import { startReminderScheduler } from './modules/reminders/scheduler.js';
import { desktopNotifier } from './modules/reminders/system-notifier.js';
import { JiraSync } from './modules/tasks/jira-sync.js';
import { TasksRepository } from './modules/tasks/repository.js';

const config = loadConfig();
const { db } = openDatabase(config.databasePath);
// opencode arranca solo la primera vez que se usa la IA (o se usa el que indique OPENCODE_URL).
const llm = createOpencodeLlm({ url: config.opencodeUrl });
const jiraClient = config.jira ? new JiraClient(config.jira) : null;
const jiraSync = new JiraSync(db, new TasksRepository(db), jiraClient, config.jira?.jql ?? '');
// Escritura en JIRA por el MCP de JIRA configurado en opencode (se conecta al primer envío).
const jiraWriter = new McpJiraWriter(config.opencodeConfigPath, config.jiraMcpServer);
const app = await buildApp(db, { logger: true, llm, jiraSync, jiraClient, jiraWriter });
app.addHook('onClose', async () => {
  llm.close();
  await jiraWriter.close();
});
await app.listen({ host: config.host, port: config.port });

// Recordatorios: aviso en la app y notificación del sistema (Teams queda pospuesto).
startReminderScheduler(new RemindersRepository(db), desktopNotifier, app.log);

// Tareas de JIRA: al arrancar y cada 15 minutos (si JIRA está configurado en .env).
jiraSync.start(app.log);
