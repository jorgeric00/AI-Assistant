import type { FastifyInstance } from 'fastify';
import { JiraKey, PR_LIST_FILTERS, PrWatchInput } from '@dev-assistant/shared';
import { z } from 'zod';
import { GithubError } from '../../integrations/github/client.js';
import { t } from '../../i18n/index.js';
import { PrFixError, type PrFixService } from './fix.js';
import type { PrWatcher } from './watcher.js';

/** Avisos de tus PR (tarjeta de Hoy) y PR de cada tarea (detalle de tarea). */
const PrParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_=-]{1,200}$/) });

export async function prsRoutes(app: FastifyInstance, { prWatcher, prFix }: { prWatcher: PrWatcher; prFix: PrFixService }) {
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

  app.get('/api/prs', async (req) => prWatcher.list(z.object({ state: z.enum(PR_LIST_FILTERS).default('open') }).parse(req.query).state));
  app.get('/api/prs/:id', async (req, reply) => prWatcher.detail(PrParams.parse(req.params).id) ?? reply.code(404).send({ error: t('prs.notFound') }));
  app.put('/api/prs/:id/watch', async (req, reply) => {
    const { id } = PrParams.parse(req.params);
    return prWatcher.setWatched(id, PrWatchInput.parse(req.body).watched) ?? reply.code(404).send({ error: t('prs.notFound') });
  });

  app.get('/api/tasks/:key/prs', async (req) => prWatcher.forTask(z.object({ key: JiraKey }).parse(req.params).key));

  // Lo que dicen ahora en GitHub los checks en rojo de una PR, y pasárselo a opencode para que lo arregle.
  app.get('/api/prs/:id/failures', async (req, reply) => {
    try {
      return (await prWatcher.failures(PrParams.parse(req.params).id)) ?? reply.code(404).send({ error: t('prs.notFound') });
    } catch (err) {
      if (err instanceof GithubError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });
  app.post('/api/prs/:id/fix', async (req, reply) => {
    try {
      return (await prFix.fix(PrParams.parse(req.params).id)) ?? reply.code(404).send({ error: t('prs.notFound') });
    } catch (err) {
      if (err instanceof GithubError) return reply.code(503).send({ error: err.message });
      if (err instanceof PrFixError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
