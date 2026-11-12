import { afterEach, describe, expect, it } from 'vitest';
import type { JiraSyncStatus, Note, Task, TaskDetail } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import type { JiraClient, JiraIssue } from '../../integrations/jira/client.js';
import { JiraError } from '../../integrations/jira/client.js';
import { JiraSync } from './jira-sync.js';
import { parseJiraRef } from './import.js';
import { TasksRepository } from './repository.js';

const issue = (key: string, extra: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  summary: `Resumen ${key}`,
  description: null,
  status: 'En curso',
  statusCategory: 'indeterminate',
  priority: 'Media',
  issueType: 'Historia',
  project: 'ABC',
  updated: '2026-10-05T10:00:00.000Z',
  url: `https://jira/browse/${key}`,
  ...extra,
});

/** Cliente falso: `search` devuelve `assigned`; `getIssue` busca en `others`. */
function fakeClient(assigned: JiraIssue[], others: JiraIssue[] = []) {
  const state = { assigned, others, fail: null as Error | null };
  const client = {
    myself: async () => {
      if (state.fail) throw state.fail;
      return 'Jorge';
    },
    search: async () => {
      if (state.fail) throw state.fail;
      return [...state.assigned];
    },
    getIssue: async (key: string) => state.others.find((i) => i.key === key) ?? null,
  } as unknown as JiraClient;
  return { client, state };
}

async function setup(client: JiraClient | null, withClient = false) {
  const { db } = openDatabase(':memory:');
  const jiraSync = new JiraSync(db, new TasksRepository(db), client, 'assignee = currentUser()');
  const app = await buildApp(db, { jiraSync, jiraClient: withClient ? client : undefined });
  const get = async <T>(url: string) => (await app.inject({ method: 'GET', url })).json() as T;
  const sync = () => app.inject({ method: 'POST', url: '/api/jira/sync' });
  const note = async (taskKeys: string[]) =>
    (await app.inject({ method: 'POST', url: '/api/notes', payload: { title: 'Formato CSV', taskKeys } })).json() as Note;
  return { app, get, sync, note };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('tareas de JIRA', () => {
  it('sincroniza, oculta las terminadas y ordena por última modificación', async () => {
    const { client } = fakeClient([
      issue('ABC-1', { updated: '2026-10-01T10:00:00.000Z' }),
      issue('ABC-2', { updated: '2026-10-04T10:00:00.000Z' }),
      issue('ABC-3', { statusCategory: 'done', status: 'Cerrada' }),
    ]);
    ctx = await setup(client);
    const res = await ctx.sync();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<JiraSyncStatus>()).toMatchObject({ configured: true, syncing: false, user: 'Jorge', lastCount: 3, lastError: null });
    expect(res.json<JiraSyncStatus>().lastSyncedAt).not.toBeNull();

    expect((await ctx.get<Task[]>('/api/tasks')).map((t) => t.key)).toEqual(['ABC-2', 'ABC-1']);
    expect((await ctx.get<Task[]>('/api/tasks?done=true')).map((t) => t.key)).toEqual(['ABC-3', 'ABC-2', 'ABC-1']);
  });

  it('lista los proyectos de las tareas cargadas, con su nombre', async () => {
    const { client } = fakeClient([issue('ABC-1', { project: 'Backoffice' }), issue('ABC-2', { project: 'Backoffice' }), issue('DEF-7', { project: 'Plataforma' })]);
    ctx = await setup(client);
    await ctx.sync();
    await ctx.note(['XYZ-3']);
    expect(await ctx.get('/api/tasks/projects')).toEqual([
      { key: 'ABC', name: 'Backoffice' },
      { key: 'DEF', name: 'Plataforma' },
      { key: 'XYZ', name: 'XYZ' },
    ]);
  });

  it('completa la tarea creada desde una nota sin perder el vínculo', async () => {
    const { client } = fakeClient([issue('ABC-131', { summary: 'Exportar informe a CSV', description: 'Columnas: id, fecha' })]);
    ctx = await setup(client);
    const n = await ctx.note(['abc-131']);
    expect(n.tasks).toEqual([{ key: 'ABC-131', summary: 'ABC-131', synced: false }]);

    await ctx.sync();
    const detail = await ctx.get<TaskDetail>('/api/tasks/abc-131');
    expect(detail).toMatchObject({ key: 'ABC-131', summary: 'Exportar informe a CSV', description: 'Columnas: id, fecha', synced: true });
    expect(detail.notes).toEqual([{ id: n.id, title: 'Formato CSV', kind: 'note' }]);
    expect((await ctx.get<Note>(`/api/notes/${n.id}`)).tasks[0]).toMatchObject({ summary: 'Exportar informe a CSV', synced: true });
  });

  it('pide una a una las claves de notas que no salen en la consulta y deja sin tocar las que no existen', async () => {
    const { client } = fakeClient([issue('ABC-1')], [issue('XYZ-7', { summary: 'De otra persona' })]);
    ctx = await setup(client);
    await ctx.note(['XYZ-7', 'NOPE-1']);
    await ctx.sync();

    const keys = (await ctx.get<Task[]>('/api/tasks')).map((t) => [t.key, t.synced]);
    expect(keys).toEqual(expect.arrayContaining([['ABC-1', true], ['XYZ-7', true], ['NOPE-1', false]]));
  });

  it('una sincronización sin tareas también queda registrada, con el usuario', async () => {
    ctx = await setup(fakeClient([]).client);
    await ctx.sync();
    const status = await ctx.get<JiraSyncStatus>('/api/jira/status');
    expect(status).toMatchObject({ user: 'Jorge', lastCount: 0, lastError: null });
    expect(status.lastSyncedAt).not.toBeNull();
  });

  it('una tarea que deja de estar asignada no se borra', async () => {
    const { client, state } = fakeClient([issue('ABC-1'), issue('ABC-2')]);
    ctx = await setup(client);
    await ctx.sync();
    state.assigned = [issue('ABC-1', { status: 'En revisión' })];
    await ctx.sync();
    const tasks = await ctx.get<Task[]>('/api/tasks');
    expect(tasks.map((t) => t.key).sort()).toEqual(['ABC-1', 'ABC-2']);
    expect(tasks.find((t) => t.key === 'ABC-1')!.status).toBe('En revisión');
  });

  it('un error de JIRA se devuelve con su mensaje y queda en el estado', async () => {
    const { client, state } = fakeClient([]);
    state.fail = new JiraError('JIRA rechazó las credenciales (401).');
    ctx = await setup(client);
    const res = await ctx.sync();
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('401');
    expect((await ctx.get<JiraSyncStatus>('/api/jira/status')).lastError).toContain('401');
  });

  it('sin JIRA configurado lo indica y la ficha de una tarea desconocida da 404', async () => {
    ctx = await setup(null);
    expect(await ctx.get<JiraSyncStatus>('/api/jira/status')).toEqual({
      configured: false,
      syncing: false,
      lastSyncedAt: null,
      user: null,
      lastCount: null,
      lastError: null,
      writeProblem: 'JIRA no está configurado: añade JIRA_URL y JIRA_TOKEN al fichero .env.',
    });
    const res = await ctx.sync();
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('JIRA_URL');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks/ABC-404' })).statusCode).toBe(404);
  });
});

describe('importar tareas de otra persona', () => {
  it('saca la clave de un ID o de un enlace de JIRA', () => {
    expect(parseJiraRef(' sgar-123 ')).toBe('SGAR-123');
    expect(parseJiraRef('https://jira.empresa.com/browse/SGAR-123')).toBe('SGAR-123');
    expect(parseJiraRef('https://jira-2.empresa.com/jira/browse/sgar-7?focusedId=5')).toBe('SGAR-7');
    expect(parseJiraRef('https://jira.empresa.com/jira/software/projects/SGAR/boards/4?selectedIssue=SGAR-88')).toBe('SGAR-88');
    expect(parseJiraRef('https://jira.empresa.com/')).toBeNull();
    expect(parseJiraRef('hola')).toBeNull();
  });

  it('se mira, se importa, se actualiza con cada sincronización y se puede quitar', async () => {
    const { client, state } = fakeClient([issue('ABC-1')], [issue('XYZ-9', { assignee: 'Luis Pérez' })]);
    ctx = await setup(client, true);
    const preview = await ctx.app.inject({ method: 'GET', url: `/api/tasks/import/preview?ref=${encodeURIComponent('https://jira/browse/xyz-9')}` });
    expect(preview.json()).toMatchObject({ key: 'XYZ-9', assignee: 'Luis Pérez', inApp: false });
    expect(await ctx.get<Task[]>('/api/tasks')).toEqual([]);

    const imported = await ctx.app.inject({ method: 'POST', url: '/api/tasks/import', payload: { ref: 'XYZ-9' } });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ key: 'XYZ-9', imported: true, assignee: 'Luis Pérez', synced: true });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks/import/preview?ref=XYZ-9' })).json()).toMatchObject({ inApp: true });

    // La sincronización la actualiza y sigue siendo importada.
    state.others = [issue('XYZ-9', { assignee: 'Luis Pérez', status: 'Hecha', statusCategory: 'indeterminate' })];
    await ctx.sync();
    const tasks = await ctx.get<Task[]>('/api/tasks');
    expect(tasks.map((t) => [t.key, t.imported, t.status])).toEqual(expect.arrayContaining([['XYZ-9', true, 'Hecha'], ['ABC-1', false, 'En curso']]));

    // Solo se quitan las importadas.
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/tasks/ABC-1' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/tasks/XYZ-9' })).statusCode).toBe(204);
    expect((await ctx.get<Task[]>('/api/tasks')).map((t) => t.key)).toEqual(['ABC-1']);
  });

  it('explica si la tarea no existe o el enlace no vale, y no toca una que ya está en la app', async () => {
    const { client } = fakeClient([issue('ABC-1')], [issue('ABC-1')]);
    ctx = await setup(client, true);
    await ctx.sync();
    expect((await ctx.app.inject({ method: 'POST', url: '/api/tasks/import', payload: { ref: 'ABC-1' } })).json()).toMatchObject({ key: 'ABC-1', imported: false });
    const missing = await ctx.app.inject({ method: 'POST', url: '/api/tasks/import', payload: { ref: 'ABC-404' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toContain('ABC-404');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks/import/preview?ref=nada' })).statusCode).toBe(400);
  });
});
