import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { JiraCreateDraftInput, JiraDraftInput, JiraKey, JiraUpdateInput, ProjectKey, TaskImportInput, TaskListQuery, type JiraSyncStatus } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';
import { readTaskDevInfo, withReadyStepDone } from './dev-files.js';
import { getTaskDoc, listTaskDocs } from './task-docs.js';
import type { Db } from '../../db/client.js';
import { pullRequests } from '../../db/schema.js';
import type { JiraSync } from './jira-sync.js';
import { TaskImportError, type TaskImportService } from './import.js';
import { JiraCreateInputError, type JiraCreateService } from './jira-create.js';
import { JiraUpdateInputError, type JiraUpdateService } from './jira-update.js';
import { TasksRepository } from './repository.js';
import type { DevSessionService } from './session.js';

const KeyParams = z.object({ key: JiraKey });
const ProjectParams = z.object({ project: ProjectKey });
const TypeParams = ProjectParams.extend({ type: z.string().trim().min(1) });

/** Tareas de JIRA asignadas (R9): lista, ficha con notas vinculadas y sincronización. */
export async function tasksRoutes(
  app: FastifyInstance,
  {
    db,
    jiraSync,
    jiraUpdates,
    jiraCreate,
    taskImport,
    devAssistantHome,
    sessions,
  }: {
    db: Db;
    jiraSync: JiraSync;
    jiraUpdates: JiraUpdateService;
    jiraCreate: JiraCreateService;
    taskImport: TaskImportService;
    devAssistantHome: string;
    sessions: DevSessionService;
  },
) {
  const repo = new TasksRepository(db);
  const status = (): JiraSyncStatus => ({ ...jiraSync.status(), ...jiraUpdates.writerStatus() });
  const badInput = (reply: FastifyReply) => (err: unknown) => {
    if (err instanceof JiraUpdateInputError || err instanceof JiraCreateInputError || err instanceof TaskImportError) return reply.code(400).send({ error: err.message });
    throw err;
  };

  app.get('/api/tasks', async (req) => repo.list(TaskListQuery.parse(req.query)));

  // Proyectos de las tareas cargadas, para elegirlos en la ficha de un repositorio.
  app.get('/api/tasks/projects', async () => repo.projects());

  // Importar una tarea de otra persona: se mira primero (preview) y luego se guarda.
  app.get('/api/tasks/import/preview', async (req, reply) =>
    taskImport.preview(TaskImportInput.parse(req.query).ref).catch(badInput(reply)),
  );
  app.post('/api/tasks/import', async (req, reply) => {
    const task = await taskImport.import(TaskImportInput.parse(req.body).ref).catch(badInput(reply));
    return task && reply.code(201).send(task);
  });

  // Solo se pueden quitar las importadas; las propias vuelven con la siguiente sincronización.
  app.delete('/api/tasks/:key', async (req, reply) =>
    repo.removeImported(KeyParams.parse(req.params).key) ? reply.code(204).send() : reply.code(400).send({ error: t('tasks.removeNotImported') }),
  );

  app.get('/api/tasks/:key', async (req, reply) => repo.get(KeyParams.parse(req.params).key) ?? reply.code(404).send({ error: t('tasks.notFound') }));

  // Plan e histórico que escribe opencode en la carpeta de la tarea (aunque la tarea no esté sincronizada).
  app.get('/api/tasks/:key/dev', async (req) => {
    const { key } = KeyParams.parse(req.params);
    const info = await readTaskDevInfo(devAssistantHome, key);
    if (!info.plan) return info;
    // El paso final del plan lo marca la app si las PR y JIRA ya están como dice, lo haya hecho opencode o el usuario.
    const task = repo.get(key);
    const prs = db.select({ state: pullRequests.state, isDraft: pullRequests.isDraft }).from(pullRequests).where(eq(pullRequests.taskKey, key)).all();
    return { ...info, plan: withReadyStepDone(info.plan, { prs, jiraStatus: task?.synced ? task.status : null, jiraDone: task?.statusCategory === 'done' }) };
  });

  // Documentación de tareas: el RESUMEN.md que escribe opencode al cerrar cada tarea.
  app.get('/api/task-docs', async (req) => listTaskDocs(devAssistantHome, z.object({ q: z.string().trim().optional() }).parse(req.query).q));

  app.get('/api/task-docs/:key', async (req, reply) => {
    const { key } = KeyParams.parse(req.params);
    return (await getTaskDoc(devAssistantHome, key)) ?? reply.code(404).send({ error: t('tasks.noSummary', { key }) });
  });

  // Sesión de desarrollo: estado de los repos de la tarea y botón para abrir opencode en la terminal.
  app.get('/api/tasks/:key/session', async (req) => sessions.get(KeyParams.parse(req.params).key));

  app.post('/api/tasks/:key/session/open', async (req) => {
    const { key } = KeyParams.parse(req.params);
    const result = await sessions.open(key);
    req.log.info(result.opened ? `opencode abierto para ${key}` : `TAREA.md preparado para ${key} (abrir opencode a mano)`);
    return result;
  });

  // Actualizar JIRA (API REST): estados posibles, borrador con IA y envío confirmado.
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

  // Nueva tarea en JIRA (API REST): proyectos, tipos, campos, épicas, sprints, borrador con IA y creación confirmada.
  app.get('/api/jira/create/projects', async () => jiraCreate.projects());
  app.get('/api/jira/create/projects/:project/types', async (req) => jiraCreate.issueTypes(ProjectParams.parse(req.params).project));
  app.get('/api/jira/create/projects/:project/types/:type', async (req) => {
    const { project, type } = TypeParams.parse(req.params);
    return jiraCreate.form(project, type);
  });
  app.get('/api/jira/create/projects/:project/epics', async (req) =>
    jiraCreate.epics(ProjectParams.parse(req.params).project, z.object({ q: z.string().trim().optional() }).parse(req.query).q),
  );
  app.get('/api/jira/create/projects/:project/sprints', async (req) => jiraCreate.sprints(ProjectParams.parse(req.params).project));
  app.post('/api/jira/create/draft', async (req, reply) => jiraCreate.draft(JiraCreateDraftInput.parse(req.body)).catch(badInput(reply)));
  app.post('/api/jira/create', async (req, reply) => {
    try {
      const result = await jiraCreate.create(req.body as never);
      req.log.info(`Tarea creada en JIRA: ${result.key}${result.warnings.length ? ` (avisos: ${result.warnings.join(' | ')})` : ''}`);
      return reply.code(201).send(result);
    } catch (err) {
      if (!(err instanceof JiraCreateInputError)) req.log.warn(`No se pudo crear la tarea en JIRA: ${err instanceof Error ? err.message : String(err)}`);
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
