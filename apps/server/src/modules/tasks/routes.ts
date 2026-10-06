import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { JiraDraftInput, JiraKey, JiraUpdateInput, TaskListQuery, type JiraSyncStatus } from '@dev-assistant/shared';
import { readTaskDevInfo } from './dev-files.js';
import type { Db } from '../../db/client.js';
import type { JiraSync } from './jira-sync.js';
import { JiraUpdateInputError, type JiraUpdateService } from './jira-update.js';
import { TasksRepository } from './repository.js';
import type { DevSessionService } from './session.js';

const KeyParams = z.object({ key: JiraKey });

/** Tareas de JIRA asignadas (R9): lista, ficha con notas vinculadas y sincronización. */
export async function tasksRoutes(
  app: FastifyInstance,
  {
    db,
    jiraSync,
    jiraUpdates,
    devAssistantHome,
    sessions,
  }: { db: Db; jiraSync: JiraSync; jiraUpdates: JiraUpdateService; devAssistantHome: string; sessions: DevSessionService },
) {
  const repo = new TasksRepository(db);
  const status = (): JiraSyncStatus => ({ ...jiraSync.status(), ...jiraUpdates.writerStatus() });
  const badInput = (reply: FastifyReply) => (err: unknown) => {
    if (err instanceof JiraUpdateInputError) return reply.code(400).send({ error: err.message });
    throw err;
  };

  app.get('/api/tasks', async (req) => repo.list(TaskListQuery.parse(req.query)));

  app.get('/api/tasks/:key', async (req, reply) => repo.get(KeyParams.parse(req.params).key) ?? reply.code(404).send({ error: 'Tarea no encontrada' }));

  // Plan e histórico que escribe opencode en la carpeta de la tarea (aunque la tarea no esté sincronizada).
  app.get('/api/tasks/:key/dev', async (req) => readTaskDevInfo(devAssistantHome, KeyParams.parse(req.params).key));

  // Sesión de desarrollo: estado de los repos de la tarea y botón para abrir opencode en la terminal.
  app.get('/api/tasks/:key/session', async (req) => sessions.get(KeyParams.parse(req.params).key));

  app.post('/api/tasks/:key/session/open', async (req) => {
    const { key } = KeyParams.parse(req.params);
    const result = await sessions.open(key);
    req.log.info(result.opened ? `opencode abierto para ${key}` : `TAREA.md preparado para ${key} (abrir opencode a mano)`);
    return result;
  });

  // Actualizar JIRA: estados posibles (API REST), borrador con IA y envío confirmado (MCP).
  app.get('/api/tasks/:key/transitions', async (req, reply) => jiraUpdates.transitions(KeyParams.parse(req.params).key).catch(badInput(reply)));

  app.post('/api/tasks/:key/jira-update/draft', async (req, reply) =>
    jiraUpdates.draft(KeyParams.parse(req.params).key, JiraDraftInput.parse(req.body ?? {})).catch(badInput(reply)),
  );

  app.post('/api/tasks/:key/jira-update', async (req, reply) => {
    const { key } = KeyParams.parse(req.params);
    const input = JiraUpdateInput.parse(req.body);
    try {
      const entry = await jiraUpdates.send(key, input);
      req.log.info(`JIRA actualizado: ${key}${entry.comment ? ' · comentario' : ''}${entry.transition ? ` · ${entry.transition.from} → ${entry.transition.to}` : ''}`);
      return reply.code(201).send(entry);
    } catch (err) {
      if (!(err instanceof JiraUpdateInputError)) req.log.warn(`No se pudo actualizar JIRA (${key}): ${err instanceof Error ? err.message : String(err)}`);
      return badInput(reply)(err);
    }
  });

  app.get('/api/jira/status', async () => status());

  app.post('/api/jira/sync', async (req) => {
    try {
      const last = await jiraSync.sync();
      req.log.info(`JIRA sincronizado como ${last.user}: ${last.count} tareas`);
    } catch (err) {
      req.log.warn(`No se pudo sincronizar JIRA: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    return status();
  });
}
