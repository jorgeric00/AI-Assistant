import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { createOpencodeLlm } from './integrations/opencode/llm.js';
import { RemindersRepository } from './modules/reminders/repository.js';
import { startReminderScheduler } from './modules/reminders/scheduler.js';
import { desktopNotifier } from './modules/reminders/system-notifier.js';

const config = loadConfig();
const { db } = openDatabase(config.databasePath);
// opencode arranca solo la primera vez que se usa la IA (o se usa el que indique OPENCODE_URL).
const llm = createOpencodeLlm({ url: config.opencodeUrl });
const app = await buildApp(db, { logger: true, llm });
app.addHook('onClose', async () => llm.close());
await app.listen({ host: config.host, port: config.port });

// Recordatorios: aviso en la app y notificación del sistema (Teams queda pospuesto).
startReminderScheduler(new RemindersRepository(db), desktopNotifier, app.log);
