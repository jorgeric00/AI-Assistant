import { afterEach, describe, expect, it } from 'vitest';
import type { JiraSyncStatus, Note, Task, TaskDetail } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import type { JiraClient, JiraIssue } from '../../integrations/jira/client.js';
import { JiraError } from '../../integrations/jira/client.js';
import { JiraSync } from './jira-sync.js';
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

async function setup(client: JiraClient | null) {
  const { db } = openDatabase(':memory:');
  const jiraSync = new JiraSync(db, new TasksRepository(db), client, 'assignee = currentUser()');
  const app = await buildApp(db, { jiraSync });
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
      writeServer: null,
      writeProblem: 'La escritura en JIRA no está configurada.',
    });
    const res = await ctx.sync();
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('JIRA_URL');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks/ABC-404' })).statusCode).toBe(404);
  });
});
