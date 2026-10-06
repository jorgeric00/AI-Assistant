import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JiraDraft, JiraSyncStatus, JiraTransitionOption, JiraUpdateEntry, TaskDetail } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { JiraError, type JiraClient, type JiraIssue } from '../../integrations/jira/client.js';
import type { Llm, LlmRequest } from '../../integrations/opencode/llm.js';
import { JiraSync } from './jira-sync.js';
import { TasksRepository } from './repository.js';

const issue = (status: string): JiraIssue => ({
  key: 'ABC-1',
  summary: 'Exportar pedidos a CSV',
  description: null,
  status,
  statusCategory: 'new',
  priority: null,
  issueType: null,
  project: null,
  updated: '2026-10-05T10:00:00.000Z',
  url: 'https://jira/browse/ABC-1',
});

const TRANSITIONS: JiraTransitionOption[] = [
  { id: '21', name: 'Empezar', to: 'En curso', toCategory: 'indeterminate' },
  { id: '31', name: 'Enviar a revisión', to: 'En revisión', toCategory: 'indeterminate' },
];

async function setup({ failTransition = false, configured = true } = {}) {
  const { db } = openDatabase(':memory:');
  const jira = { status: 'Por hacer' };
  const sent: string[] = [];
  const client = {
    myself: async () => 'Jorge',
    search: async () => [issue(jira.status)],
    getIssue: async () => issue(jira.status),
    transitions: async () => TRANSITIONS,
    addComment: async (key: string, comment: string) => {
      sent.push(`comment ${key}: ${comment}`);
    },
    transition: async (key: string, id: string) => {
      if (failTransition) throw new JiraError('JIRA respondió 400: falta resolución');
      sent.push(`transition ${key}: ${id}`);
      jira.status = TRANSITIONS.find((t) => t.id === id)!.to;
    },
  } as unknown as JiraClient;
  const prompts: LlmRequest[] = [];
  const llm: Llm = {
    complete: async (req) => {
      prompts.push(req);
      return '  Hecho:\n- Endpoint de exportación.  ';
    },
  };
  const home = mkdtempSync(join(tmpdir(), 'dev-assistant-'));
  const repo = new TasksRepository(db);
  const jiraSync = new JiraSync(db, repo, client, 'x');
  const app = await buildApp(db, { jiraSync, jiraClient: configured ? client : null, llm, devAssistantHome: home });
  await jiraSync.sync();
  const inject = async <T>(method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: res.json() as T };
  };
  return { app, inject, sent, prompts, home };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('Actualizar JIRA', () => {
  it('lista los estados posibles y el estado de la escritura', async () => {
    ctx = await setup();
    expect((await ctx.inject<JiraTransitionOption[]>('GET', '/api/tasks/ABC-1/transitions')).body.map((t) => t.to)).toEqual(['En curso', 'En revisión']);
    expect((await ctx.inject<JiraSyncStatus>('GET', '/api/jira/status')).body).toMatchObject({ writeProblem: null });
  });

  it('envía comentario y estado, lo registra en la ficha y refresca el estado', async () => {
    ctx = await setup();
    const res = await ctx.inject<JiraUpdateEntry>('POST', '/api/tasks/ABC-1/jira-update', { comment: ' Listo para revisar ', transitionId: '31' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ comment: 'Listo para revisar', transition: { from: 'Por hacer', to: 'En revisión' } });
    expect(ctx.sent).toEqual(['comment ABC-1: Listo para revisar', 'transition ABC-1: 31']);

    const task = (await ctx.inject<TaskDetail>('GET', '/api/tasks/ABC-1')).body;
    expect(task.status).toBe('En revisión');
    expect(task.jiraUpdates).toHaveLength(1);
    expect(task.jiraUpdates[0]).toMatchObject({ comment: 'Listo para revisar', transition: { from: 'Por hacer', to: 'En revisión' } });
  });

  it('solo comentario, y los envíos salen del más reciente al más antiguo', async () => {
    ctx = await setup();
    await ctx.inject('POST', '/api/tasks/ABC-1/jira-update', { comment: 'Primero' });
    await ctx.inject('POST', '/api/tasks/ABC-1/jira-update', { transitionId: '21' });
    const task = (await ctx.inject<TaskDetail>('GET', '/api/tasks/ABC-1')).body;
    expect(task.jiraUpdates.map((u) => [u.comment, u.transition?.to ?? null])).toEqual([
      [null, 'En curso'],
      ['Primero', null],
    ]);
  });

  it('rechaza envíos vacíos, estados no permitidos y tareas desconocidas', async () => {
    ctx = await setup();
    expect((await ctx.inject('POST', '/api/tasks/ABC-1/jira-update', {})).status).toBe(400);
    expect((await ctx.inject('POST', '/api/tasks/ABC-1/jira-update', { comment: '   ' })).status).toBe(400);
    const bad = await ctx.inject<{ error: string }>('POST', '/api/tasks/ABC-1/jira-update', { transitionId: '99' });
    expect(bad.status).toBe(503);
    expect(bad.body.error).toContain('ya no permite');
    expect((await ctx.inject('POST', '/api/tasks/ZZZ-9/jira-update', { comment: 'x' })).status).toBe(400);
    expect(ctx.sent).toEqual([]);
  });

  it('si falla el cambio de estado, avisa de que el comentario sí se envió y solo registra el comentario', async () => {
    ctx = await setup({ failTransition: true });
    const res = await ctx.inject<{ error: string }>('POST', '/api/tasks/ABC-1/jira-update', { comment: 'Hecho', transitionId: '31' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/^Se añadió el comentario, pero no se pudo cambiar el estado: .*falta resolución/);
    const task = (await ctx.inject<TaskDetail>('GET', '/api/tasks/ABC-1')).body;
    expect(task.jiraUpdates).toEqual([expect.objectContaining({ comment: 'Hecho', transition: null })]);
  });

  it('sin JIRA configurado no envía nada y explica por qué', async () => {
    ctx = await setup({ configured: false });
    expect((await ctx.inject<JiraSyncStatus>('GET', '/api/jira/status')).body.writeProblem).toContain('JIRA_TOKEN');
    const res = await ctx.inject<{ error: string }>('POST', '/api/tasks/ABC-1/jira-update', { comment: 'Hola' });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('JIRA no está configurado');
    expect(ctx.sent).toEqual([]);
  });

  it('el borrador con IA usa notas, plan e histórico; sin datos pide escribirlo a mano', async () => {
    ctx = await setup();
    const empty = await ctx.inject<{ error: string }>('POST', '/api/tasks/ABC-1/jira-update/draft', {});
    expect(empty.status).toBe(400);
    expect(ctx.prompts).toHaveLength(0);

    await ctx.inject('POST', '/api/notes', { title: 'Formato CSV', bodyMd: 'Separador ; y decimales con coma', taskKeys: ['ABC-1'] });
    const folder = join(ctx.home, 'worktrees', 'ABC-1');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'HISTORIAL.md'), '- 2026-10-06 10:00 | orders-api | abc1234 | https://github.com/x/orders-api/commit/abc1234 | Endpoint GET /orders/export\n');
    const res = await ctx.inject<JiraDraft>('POST', '/api/tasks/ABC-1/jira-update/draft', { targetStatus: 'En revisión' });
    expect(res.status).toBe(200);
    expect(res.body.comment).toBe('Hecho:\n- Endpoint de exportación.');
    const prompt = ctx.prompts[0]!.user;
    expect(prompt).toContain('Separador ; y decimales con coma');
    expect(prompt).toContain('orders-api@abc1234');
    expect(prompt).toContain('Se va a cambiar el estado a: En revisión');
  });
});
