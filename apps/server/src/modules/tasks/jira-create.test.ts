import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JiraCreateDraft, JiraCreateForm, JiraCreateProjects, JiraCreateResult, JiraEpicOption, TaskDetail } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { JiraError, type JiraClient, type JiraFieldMeta, type JiraIssue } from '../../integrations/jira/client.js';
import type { Llm, LlmRequest } from '../../integrations/opencode/llm.js';

const FIELDS: JiraFieldMeta[] = [
  { id: 'summary', name: 'Resumen', required: true, hasDefaultValue: false, schema: { type: 'string', system: 'summary' }, allowedValues: [] },
  { id: 'assignee', name: 'Responsable', required: false, hasDefaultValue: false, schema: { type: 'user' }, allowedValues: [] },
  {
    id: 'priority',
    name: 'Prioridad',
    required: false,
    hasDefaultValue: true,
    schema: { type: 'priority' },
    allowedValues: [
      { id: '1', name: 'Alta' },
      { id: '3', name: 'Media' },
      { id: '5', name: 'Baja' },
    ],
  },
  { id: 'labels', name: 'Etiquetas', required: false, hasDefaultValue: false, schema: { type: 'array', items: 'string' }, allowedValues: [] },
  { id: 'customfield_10008', name: 'Epic Link', required: false, hasDefaultValue: false, schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' }, allowedValues: [] },
  {
    id: 'components',
    name: 'Componente',
    required: true,
    hasDefaultValue: false,
    schema: { type: 'array', items: 'component' },
    allowedValues: [
      { id: '100', name: 'backoffice-web' },
      { id: '101', name: 'orders-api' },
    ],
  },
  { id: 'customfield_20000', name: 'Equipo', required: true, hasDefaultValue: false, schema: { type: 'string', custom: 'x:textfield' }, allowedValues: [] },
];

const created = (key: string): JiraIssue => ({
  key,
  summary: 'Exportar devoluciones a CSV',
  description: 'Criterios',
  status: 'Por hacer',
  statusCategory: 'new',
  priority: 'Media',
  issueType: 'Historia',
  project: 'ABC',
  updated: '2026-10-07T10:00:00.000Z',
  url: `https://jira/browse/${key}`,
});

async function setup({ failSprint = false, projectTypes = [{ id: '10001', name: 'Historia' }, { id: '10000', name: 'Epic' }], allTypes = [] as { id: string; name: string }[] } = {}) {
  const { db } = openDatabase(':memory:');
  const calls: { created?: Record<string, unknown>; epic?: string; sprint?: number; jql?: string } = {};
  const client = {
    projects: async () => [
      { key: 'DEF', name: 'Plataforma' },
      { key: 'ABC', name: 'Backoffice' },
    ],
    issueTypes: async () => projectTypes,
    allIssueTypes: async () => allTypes,
    createFields: async () => FIELDS,
    assigneeRef: async () => ({ name: 'jorge' }),
    richText: (text: string) => text,
    createIssue: async (fields: Record<string, unknown>) => {
      calls.created = fields;
      return 'ABC-142';
    },
    addToEpic: async (epic: string) => {
      calls.epic = epic;
    },
    addToSprint: async (id: number) => {
      if (failSprint) throw new JiraError('JIRA respondió 400: sprint cerrado');
      calls.sprint = id;
    },
    search: async (jql: string) => {
      calls.jql = jql;
      return [created('ABC-90')];
    },
    getIssue: async (key: string) => created(key),
    browseUrl: (key: string) => `https://jira/browse/${key}`,
  } as unknown as JiraClient;
  const prompts: LlmRequest[] = [];
  const llm: Llm = {
    complete: async (req) => {
      prompts.push(req);
      return 'Resumen: Exportar devoluciones a CSV\n\nComo gestor quiero exportarlas.\n- Botón Exportar CSV\n';
    },
  };
  const app = await buildApp(db, { jiraClient: client, llm, devAssistantHome: mkdtempSync(join(tmpdir(), 'dev-assistant-')) });
  const inject = async <T>(method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: res.json() as T };
  };
  return { app, inject, calls, prompts };
}

const base = { project: 'ABC', issueTypeId: '10001', summary: 'Exportar devoluciones a CSV', extra: { components: ['100'], customfield_20000: 'Pedidos' } };

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('Nueva tarea en JIRA', () => {
  it('lista los proyectos ordenados y recuerda el último usado', async () => {
    ctx = await setup();
    const before = await ctx.inject<JiraCreateProjects>('GET', '/api/jira/create/projects');
    expect(before.body.projects.map((p) => p.key)).toEqual(['ABC', 'DEF']);
    expect(before.body.last).toBeNull();
    await ctx.inject('POST', '/api/jira/create', base);
    expect((await ctx.inject<JiraCreateProjects>('GET', '/api/jira/create/projects')).body.last).toEqual({ project: 'ABC', issueTypeId: '10001' });
  });

  it('muestra solo los obligatorios extra, sin la épica, y la prioridad del medio por defecto', async () => {
    ctx = await setup();
    const form = (await ctx.inject<JiraCreateForm>('GET', '/api/jira/create/projects/ABC/types/10001')).body;
    expect(form.extraFields.map((f) => [f.id, f.input])).toEqual([
      ['components', 'multi'],
      ['customfield_20000', 'text'],
    ]);
    expect(form.defaultPriorityId).toBe('3');
    expect(form).toMatchObject({ labels: true, assignee: true });
  });

  it('crea la tarea con sus campos, la mete en la épica y el sprint y aparece en la app', async () => {
    ctx = await setup();
    const res = await ctx.inject<JiraCreateResult>('POST', '/api/jira/create', {
      ...base,
      description: 'Criterios',
      priorityId: '3',
      labels: ['backoffice', 'csv'],
      epicKey: 'abc-90',
      sprintId: 42,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ key: 'ABC-142', url: 'https://jira/browse/ABC-142', warnings: [] });
    expect(ctx.calls.created).toEqual({
      project: { key: 'ABC' },
      issuetype: { id: '10001' },
      summary: 'Exportar devoluciones a CSV',
      description: 'Criterios',
      assignee: { name: 'jorge' },
      priority: { id: '3' },
      labels: ['backoffice', 'csv'],
      components: [{ id: '100' }],
      customfield_20000: 'Pedidos',
    });
    expect(ctx.calls).toMatchObject({ epic: 'ABC-90', sprint: 42 });
    expect((await ctx.inject<TaskDetail>('GET', '/api/tasks/ABC-142')).body).toMatchObject({ key: 'ABC-142', status: 'Por hacer' });
  });

  it('no crea nada si falta un obligatorio', async () => {
    ctx = await setup();
    const res = await ctx.inject<{ error: string }>('POST', '/api/jira/create', { ...base, extra: { components: ['100'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Equipo');
    expect(ctx.calls.created).toBeUndefined();
  });

  it('si falla el sprint la tarea queda creada y se avisa', async () => {
    ctx = await setup({ failSprint: true });
    const res = await ctx.inject<JiraCreateResult>('POST', '/api/jira/create', { ...base, sprintId: 7 });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['No se pudo añadir al sprint: JIRA respondió 400: sprint cerrado']);
  });

  it('busca épicas abiertas del proyecto por texto o clave', async () => {
    ctx = await setup();
    const res = await ctx.inject<JiraEpicOption[]>('GET', '/api/jira/create/projects/ABC/epics?q=abc-90');
    expect(res.body).toEqual([{ key: 'ABC-90', summary: 'Exportar devoluciones a CSV' }]);
    expect(ctx.calls.jql).toBe('project = "ABC" AND issuetype = 10000 AND statusCategory != Done AND (key = "ABC-90" OR summary ~ "abc-90*") ORDER BY updated DESC');
  });

  it('si las épicas no se crean en el proyecto, busca el tipo épica entre todos los de JIRA', async () => {
    ctx = await setup({ projectTypes: [{ id: '10001', name: 'Historia' }], allTypes: [{ id: '10001', name: 'Historia' }, { id: '10500', name: 'Épica' }] });
    await ctx.inject<JiraEpicOption[]>('GET', '/api/jira/create/projects/ABC/epics');
    expect(ctx.calls.jql).toBe('project = "ABC" AND issuetype = 10500 AND statusCategory != Done ORDER BY updated DESC');
  });

  it('si JIRA no tiene tipo épica, no ofrece épicas (y no busca «Epic», que daría error)', async () => {
    ctx = await setup({ projectTypes: [{ id: '10001', name: 'Historia' }] });
    const res = await ctx.inject<JiraEpicOption[]>('GET', '/api/jira/create/projects/ABC/epics');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(ctx.calls.jql).toBeUndefined();
  });

  it('redacta resumen y descripción a partir de la idea', async () => {
    ctx = await setup();
    const res = await ctx.inject<JiraCreateDraft>('POST', '/api/jira/create/draft', { idea: 'exportar devoluciones', project: 'ABC', issueType: 'Historia' });
    expect(res.body).toEqual({ summary: 'Exportar devoluciones a CSV', description: 'Como gestor quiero exportarlas.\n- Botón Exportar CSV' });
    expect(ctx.prompts[0]!.user).toContain('exportar devoluciones');
  });

  it('sin JIRA configurado lo explica', async () => {
    const { db } = openDatabase(':memory:');
    const app = await buildApp(db, { jiraClient: null, devAssistantHome: mkdtempSync(join(tmpdir(), 'dev-assistant-')) });
    const res = await app.inject({ method: 'GET', url: '/api/jira/create/projects' });
    expect(res.json().error).toContain('JIRA_URL');
    await app.close();
  });
});
