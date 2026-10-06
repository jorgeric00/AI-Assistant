import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JiraKey, TaskListQuery } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import type { JiraSync } from './jira-sync.js';
import { TasksRepository } from './repository.js';

const KeyParams = z.object({ key: JiraKey });

/** Tareas de JIRA asignadas (R9): lista, ficha con notas vinculadas y sincronización. */
export async function tasksRoutes(app: FastifyInstance, { db, jiraSync }: { db: Db; jiraSync: JiraSync }) {
  const repo = new TasksRepository(db);

  app.get('/api/tasks', async (req) => repo.list(TaskListQuery.parse(req.query)));

  app.get('/api/tasks/:key', async (req, reply) => repo.get(KeyParams.parse(req.params).key) ?? reply.code(404).send({ error: 'Tarea no encontrada' }));

  app.get('/api/jira/status', async () => jiraSync.status());

  app.post('/api/jira/sync', async (req) => {
    try {
      const last = await jiraSync.sync();
      req.log.info(`JIRA sincronizado como ${last.user}: ${last.count} tareas`);
    } catch (err) {
      req.log.warn(`No se pudo sincronizar JIRA: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    return jiraSync.status();
  });
}
