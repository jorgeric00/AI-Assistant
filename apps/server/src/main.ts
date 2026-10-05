import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';

const config = loadConfig();
const { db } = openDatabase(config.databasePath);
const app = await buildApp(db, { logger: true });
await app.listen({ host: config.host, port: config.port });
