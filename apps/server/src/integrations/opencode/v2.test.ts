import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OpencodeApi } from './api.js';
import { createOpencodeConnection, type OpencodeConnection } from './connection.js';
import { createOpencodeLlm } from './llm.js';
import { toMessages, toPermission, toProviders, toQuestion } from './v2.js';

describe('traducción de la API de opencode 2.x', () => {
  it('quita proveedores desactivados y modelos apagados', () => {
    const providers = toProviders(
      [
        { id: 'github-copilot', name: 'GitHub Copilot', activation: 'active' },
        { id: 'off', name: 'Off', activation: 'disabled' },
      ],
      [
        { id: 'gpt-5', providerID: 'github-copilot', name: 'GPT-5', limit: { context: 128000 } },
        { id: 'viejo', providerID: 'github-copilot', name: 'Viejo', enabled: false },
        { id: 'x', providerID: 'off', name: 'X' },
      ],
    );
    expect(providers).toEqual([{ id: 'github-copilot', name: 'GitHub Copilot', models: { 'gpt-5': { id: 'gpt-5', name: 'GPT-5', limit: { context: 128000 } } } }]);
  });

  it('convierte mensajes y herramientas a los nombres de siempre', () => {
    const messages = toMessages([
      { id: 'u1', type: 'user', text: 'hola', time: { created: 1 } },
      { id: 's1', type: 'agent-switched' },
      {
        id: 'a1',
        type: 'assistant',
        agent: 'build',
        model: { id: 'gpt-5', providerID: 'github-copilot' },
        content: [
          { type: 'reasoning', text: 'pensando' },
          { type: 'text', text: 'Voy' },
          { type: 'tool', id: 't1', name: 'shell', state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'a.txt' }] } },
          { type: 'tool', id: 't2', name: 'read', state: { status: 'streaming', input: { path: '/x/a.txt' } } },
        ],
      },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'hola' }] });
    expect(messages[1]!.info).toMatchObject({ role: 'assistant', agent: 'build', providerID: 'github-copilot', modelID: 'gpt-5' });
    expect(messages[1]!.parts).toMatchObject([
      { type: 'text', text: 'Voy' },
      { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt' } },
      { type: 'tool', tool: 'read', state: { status: 'pending', input: { path: '/x/a.txt', filePath: '/x/a.txt' } } },
    ]);
  });

  it('un turno que acaba mal pone el error en la última respuesta', () => {
    const failed = toMessages([
      { id: 'u1', type: 'user', text: 'hola' },
      { id: 'a1', type: 'assistant', content: [] },
      { id: 'i1', type: 'idle', outcome: 'failed', error: { type: 'ProviderError', message: 'sin cuota' } },
    ]);
    expect(failed[1]!.info.error).toEqual({ name: 'ProviderError', data: { message: 'sin cuota' } });

    const dismissed = toMessages([{ id: 'a1', type: 'assistant', error: { type: 'aborted', message: 'Step interrupted' }, content: [] }]);
    expect(dismissed[0]!.info.error).toEqual({ name: 'MessageAbortedError' });

    const stopped = toMessages([
      { id: 'u1', type: 'user', text: 'hola' },
      { id: 'i1', type: 'idle', outcome: 'interrupted' },
    ]);
    expect(stopped[1]!.info).toMatchObject({ role: 'assistant', error: { name: 'MessageAbortedError' } });
  });

  it('los permisos de shell se ven como los de bash', () => {
    expect(toPermission({ id: 'p1', sessionID: 's1', action: 'shell', resources: ['ls *'], save: ['ls *'] })).toMatchObject({
      permission: 'bash',
      patterns: ['ls *'],
      always: ['ls *'],
    });
  });

  it('las preguntas de opencode se ven con sus opciones y la recomendada marcada', () => {
    const q = toQuestion({
      id: 'frm_1',
      sessionID: 'ses_1',
      title: 'Questions',
      metadata: { kind: 'question' },
      fields: [
        {
          key: 'q0',
          type: 'string',
          title: 'Rama',
          description: '¿En qué rama lo subo?',
          custom: true,
          options: [
            { value: 'develop (Recommended)', label: 'develop (Recommended)', description: 'La de siempre' },
            { value: 'main', label: 'main' },
          ],
        },
        { key: 'q1', type: 'multiselect', title: 'Tests', description: '¿Qué tests paso?', custom: false, options: [{ value: 'e2e', label: 'e2e' }] },
      ],
    });
    expect(q).toEqual({
      id: 'frm_1',
      sessionID: 'ses_1',
      items: [
        {
          key: 'q0',
          header: 'Rama',
          question: '¿En qué rama lo subo?',
          multiple: false,
          custom: true,
          options: [
            { value: 'develop (Recommended)', label: 'develop', description: 'La de siempre', recommended: true },
            { value: 'main', label: 'main', description: null, recommended: false },
          ],
        },
        { key: 'q1', header: 'Tests', question: '¿Qué tests paso?', multiple: true, custom: false, options: [{ value: 'e2e', label: 'e2e', description: null, recommended: false }] },
      ],
    });
    // Un formulario con campos que el chat no sabe enseñar no sale.
    expect(toQuestion({ id: 'f', sessionID: 's', fields: [{ key: 'n', type: 'number' }] })).toBeNull();
  });
});

/** Un opencode 2.x mínimo en memoria que apunta lo que le piden. */
function fakeV2() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const routes: Record<string, unknown> = {
    'GET /api/info': { version: '2.1.2' },
    'GET /api/provider': { data: [{ id: 'copilot', name: 'Copilot', activation: 'active' }] },
    'GET /api/model': { data: [{ id: 'gpt-5', providerID: 'copilot', name: 'GPT-5', limit: { context: 1000 } }] },
    'GET /api/model/default': { data: { id: 'gpt-5', providerID: 'copilot', name: 'GPT-5' } },
    'GET /api/agent': { data: [{ id: 'build', name: 'Build', mode: 'primary' }] },
    'POST /api/session': { data: { id: 'ses_1', location: { directory: '/repo' } } },
    'GET /api/session/active': { data: { ses_1: { type: 'running' } } },
    'GET /api/permission/request': { data: [{ id: 'per_1', sessionID: 'ses_1', action: 'shell', resources: ['ls'] }] },
    'GET /api/mcp': { data: [{ name: 'jira', status: { status: 'failed', error: 'JIRA_PERSONAL_TOKEN is not set' } }] },
    'POST /api/experimental/generate': { data: { text: ' Resumen \n' } },
    'GET /api/form': { data: [{ id: 'frm_1', sessionID: 'ses_1', title: 'Questions', fields: [{ key: 'q0', type: 'string', title: 'Rama', options: [{ value: 'main', label: 'main' }] }] }] },
  };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : undefined });
      const path = req.url!.split('?')[0]!;
      const key = `${req.method} ${path}`;
      if (key in routes) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(routes[key]));
      }
      if ((req.method === 'POST' || req.method === 'DELETE') && path.startsWith('/api/session/')) {
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html></html>');
    });
  });
  return {
    calls,
    async start() {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const address = server.address();
      return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    },
    close: () => server.close(),
  };
}

describe('OpencodeApi con opencode 2.x', () => {
  let fake: ReturnType<typeof fakeV2> | undefined;
  let conn: OpencodeConnection | undefined;
  afterEach(() => {
    conn?.close();
    fake?.close();
  });

  async function api() {
    fake = fakeV2();
    conn = createOpencodeConnection({ url: await fake.start() });
    return new OpencodeApi(conn);
  }

  it('lee modelos, modos, MCP y estado con las rutas nuevas', async () => {
    const oc = await api();
    expect(await oc.isV2()).toBe(true);
    expect((await oc.providers()).providers[0]!.models['gpt-5']).toBeDefined();
    expect(await oc.config()).toEqual({ model: 'copilot/gpt-5' });
    expect((await oc.agents())[0]!.name).toBe('build');
    expect(await oc.mcp('/repo')).toEqual({ jira: { status: 'failed', error: 'JIRA_PERSONAL_TOKEN is not set' } });
    expect(await oc.status('/repo')).toEqual({ ses_1: { type: 'busy' } });
    expect(fake!.calls.find((c) => c.url.startsWith('/api/mcp'))!.url).toContain(encodeURIComponent('location[directory]'));
  });

  it('cambia modelo y modo solo cuando cambian, y manda el texto', async () => {
    const oc = await api();
    expect(await oc.createSession('/repo', 'Prueba')).toEqual({ id: 'ses_1' });
    const body = { parts: [{ type: 'text' as const, text: 'hola' }], model: { providerID: 'copilot', modelID: 'gpt-5' }, agent: 'build' };
    await oc.prompt('ses_1', '/repo', body);
    await oc.prompt('ses_1', '/repo', body);
    const posts = fake!.calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/session/ses_1/')).map((c) => [c.url, c.body]);
    expect(posts).toEqual([
      ['/api/session/ses_1/model', { model: { id: 'gpt-5', providerID: 'copilot' } }],
      ['/api/session/ses_1/agent', { agent: 'build' }],
      ['/api/session/ses_1/prompt', { text: 'hola' }],
      ['/api/session/ses_1/prompt', { text: 'hola' }],
    ]);
  });

  it('responde un permiso en su sesión', async () => {
    const oc = await api();
    expect((await oc.permissions('/repo'))[0]).toMatchObject({ id: 'per_1', permission: 'bash' });
    await oc.replyPermission('per_1', 'once', '/repo');
    expect(fake!.calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/session/ses_1/permission/per_1/reply', body: { decision: 'once' } });
  });

  it('lee las preguntas pendientes, las contesta en su sesión o las deja sin contestar', async () => {
    const oc = await api();
    const [question] = await oc.questions('/repo');
    expect(question).toMatchObject({ id: 'frm_1', sessionID: 'ses_1', items: [{ key: 'q0', header: 'Rama' }] });
    await oc.replyQuestion('ses_1', 'frm_1', { q0: 'main' });
    expect(fake!.calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/session/ses_1/form/frm_1/reply', body: { answer: { q0: 'main' } } });
    await oc.dismissQuestion('ses_1', 'frm_1');
    expect(fake!.calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/session/ses_1/form/frm_1' });
  });

  it('la IA de la app usa la generación sin sesión', async () => {
    fake = fakeV2();
    conn = createOpencodeConnection({ url: await fake.start() });
    const llm = createOpencodeLlm({ connection: conn, model: () => 'copilot/gpt-5' });
    expect(await llm.complete({ system: 'Eres útil.', user: 'Resume', title: 't' })).toBe('Resumen');
    expect(fake.calls.at(-1)).toMatchObject({
      url: '/api/experimental/generate',
      body: { prompt: 'Eres útil.\n\nResume', model: { id: 'gpt-5', providerID: 'copilot' } },
    });
  });
});
