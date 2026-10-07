import type { FastifyInstance } from 'fastify';
import { AutostartUpdate, ConnectionsUpdate, ConnectionTestInput } from '@dev-assistant/shared';
import type { Autostart } from './autostart.js';
import type { Backups } from './backup.js';
import type { Connections } from './connections.js';

/** Ajustes > Arranque, Copias de seguridad y Conexiones. */
export async function systemRoutes(
  app: FastifyInstance,
  { autostart, backups, connections }: { autostart: Autostart; backups: Backups; connections: Connections },
) {
  app.get('/api/system/autostart', async () => autostart.status());
  app.patch('/api/system/autostart', async (req) => autostart.update(AutostartUpdate.parse(req.body)));

  app.get('/api/system/backups', async () => backups.status());
  app.post('/api/system/backups', async (_req, reply) => reply.code(201).send(await backups.run()));

  app.get('/api/system/connections', async () => connections.status());
  app.patch('/api/system/connections', async (req, reply) => {
    const parsed = ConnectionsUpdate.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' });
    return connections.update(parsed.data);
  });
  app.post('/api/system/connections/test', async (req) => connections.test(ConnectionTestInput.parse(req.body).target));
}
