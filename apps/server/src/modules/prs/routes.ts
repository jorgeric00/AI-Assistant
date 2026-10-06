import type { FastifyInstance } from 'fastify';
import { JiraKey } from '@dev-assistant/shared';
import { z } from 'zod';
import { GithubError } from '../../integrations/github/client.js';
import type { PrWatcher } from './watcher.js';

/** Avisos de tus PR (tarjeta de Hoy) y PR de cada tarea (detalle de tarea). */
export async function prsRoutes(app: FastifyInstance, { prWatcher }: { prWatcher: PrWatcher }) {
  app.get('/api/prs/status', async () => prWatcher.status());

  app.post('/api/prs/check', async (_req, reply) => {
    try {
      await prWatcher.check();
    } catch (err) {
      if (err instanceof GithubError) return reply.code(503).send({ error: err.message });
      throw err;
    }
    return prWatcher.status();
  });

  app.get('/api/pr-alerts', async () => prWatcher.alerts());

  app.get('/api/tasks/:key/prs', async (req) => prWatcher.forTask(z.object({ key: JiraKey }).parse(req.params).key));
}
