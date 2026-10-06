import type { FastifyInstance } from 'fastify';
import { AutostartUpdate } from '@dev-assistant/shared';
import type { Autostart } from './autostart.js';
import type { Backups } from './backup.js';

/** Ajustes > Arranque y Ajustes > Copias de seguridad. */
export async function systemRoutes(app: FastifyInstance, { autostart, backups }: { autostart: Autostart; backups: Backups }) {
  app.get('/api/system/autostart', async () => autostart.status());
  app.patch('/api/system/autostart', async (req) => autostart.update(AutostartUpdate.parse(req.body)));

  app.get('/api/system/backups', async () => backups.status());
  app.post('/api/system/backups', async (_req, reply) => reply.code(201).send(await backups.run()));
}
