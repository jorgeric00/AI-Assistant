import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiOptions, AiSettings, ConversationList, GeneralChat, TaskChat } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { OpencodeApi } from '../../integrations/opencode/api.js';
import { createOpencodeConnection } from '../../integrations/opencode/connection.js';
import { createOpencodeLlm } from '../../integrations/opencode/llm.js';

interface Call {
  method: string;
  path: string;
  directory: string | null;
  body: any;
}

/** Un `opencode serve` de mentira: guarda lo que se le pide y contesta lo que el test le deja preparado. */
async function fakeOpencode() {
  const calls: Call[] = [];
  const state = {
    sessions: new Set<string>(),
    titles: {} as Record<string, string>,
    messages: [] as object[],
    status: {} as Record<string, { type: string }>,
    permissions: [] as object[],
  };
  let next = 1;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      const body = raw ? JSON.parse(raw) : undefined;
      const call = { method: req.method!, path: url.pathname, directory: url.searchParams.get('directory'), body };
      calls.push(call);
      const send = (status: number, data?: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(data === undefined ? '' : JSON.stringify(data));
      const session = url.pathname.match(/^\/session\/([^/]+)\/(.+)$/);
      if (call.path === '/config/providers')
        return send(200, {
          providers: [
            { id: 'copilot', name: 'GitHub Copilot', models: { 'gpt-5': { id: 'gpt-5', name: 'GPT-5', limit: { context: 1000 } }, 'claude/sonnet': { id: 'claude/sonnet', name: 'Claude Sonnet' } } },
            { id: 'vacio', name: 'Sin modelos', models: {} },
          ],
          default: { copilot: 'gpt-5' },
        });
      if (call.path === '/config') return send(200, { model: 'copilot/gpt-5' });
      if (call.path === '/agent')
        return send(200, [
          { name: 'build', description: 'Hace cambios', mode: 'primary' },
          { name: 'plan', mode: 'primary' },
          { name: 'explore', mode: 'subagent' },
          { name: 'title', mode: 'primary', hidden: true },
        ]);
      if (call.path === '/session' && call.method === 'POST') {
        const id = `ses_${next++}`;
        state.sessions.add(id);
        return send(200, { id });
      }
      if (call.path === '/session' && call.method === 'GET')
        return send(
          200,
          [...state.sessions].map((id) => ({ id, title: state.titles[id] ?? 'New session - 2026-11-10T10:00:00.000Z', time: { updated: 1_700_000_000_000 + Number(id.slice(4)) } })),
        );
      if (call.method === 'DELETE' && /^\/session\/[^/]+$/.test(call.path)) {
        state.sessions.delete(call.path.slice('/session/'.length));
        return send(200, true);
      }
      if (call.path === '/session/status') return send(200, state.status);
      if (call.path === '/permission') return send(200, state.permissions);
      if (call.path.startsWith('/permission/')) return send(200, true);
      if (session) {
        if (!state.sessions.has(session[1]!)) return send(404, { error: 'no existe' });
        if (session[2] === 'message' && call.method === 'GET') return send(200, state.messages);
        // El modelo de la app (sin herramientas) contesta con el modelo que le llega.
        if (session[2] === 'message') return send(200, { info: { id: 'm', role: 'assistant' }, parts: [{ id: 'p', type: 'text', text: `modelo:${body.model?.modelID ?? 'predeterminado'}` }] });
        if (session[2] === 'prompt_async') return send(204);
        return send(200, true);
      }
      if (req.method === 'DELETE') return send(200, true);
      send(404, {});
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, state, close: () => server.close() };
}

async function setup(opts: { withOpencode?: boolean } = {}) {
  const oc = await fakeOpencode();
  const home = mkdtempSync(join(tmpdir(), 'da-chat-'));
  const connection = createOpencodeConnection({ url: oc.url });
  const { db } = openDatabase(':memory:');
  const app = await buildApp(db, { devAssistantHome: home, opencode: opts.withOpencode === false ? null : new OpencodeApi(connection) });
  const call = async <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };
  return { oc, home, app, call, connection, folder: join(home, 'worktrees', 'ABC-1') };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.app.close();
  ctx?.oc.close();
});

describe('modelos y modos de opencode', () => {
  it('lista los modelos como proveedor/modelo, el predeterminado y solo los modos que se pueden elegir', async () => {
    ctx = await setup();
    const { body } = await ctx.call<AiOptions>('GET', '/api/ai/options');
    expect(body).toEqual({
      available: true,
      error: null,
      providers: [{ id: 'copilot', name: 'GitHub Copilot', models: [{ id: 'copilot/claude/sonnet', name: 'Claude Sonnet' }, { id: 'copilot/gpt-5', name: 'GPT-5' }] }],
      defaultModel: 'copilot/gpt-5',
      agents: [{ name: 'build', description: 'Hace cambios' }, { name: 'plan', description: null }],
    });
  });

  it('sin opencode dice que no está disponible, sin fallar', async () => {
    ctx = await setup({ withOpencode: false });
    const { status, body } = await ctx.call<AiOptions>('GET', '/api/ai/options');
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, providers: [], agents: [] });
    expect(body.error).toBeTruthy();
  });

  it('guarda los ajustes de IA y rechaza un modelo mal escrito', async () => {
    ctx = await setup();
    expect((await ctx.call<AiSettings>('GET', '/api/ai/settings')).body).toEqual({ appModel: null, sessionModel: null, sessionAgent: 'build' });
    await ctx.call('PUT', '/api/ai/settings', { appModel: 'copilot/gpt-5', sessionAgent: 'plan' });
    expect((await ctx.call<AiSettings>('GET', '/api/ai/settings')).body).toEqual({ appModel: 'copilot/gpt-5', sessionModel: null, sessionAgent: 'plan' });
    expect((await ctx.call('PUT', '/api/ai/settings', { appModel: 'sin-proveedor' })).status).toBe(400);
  });

  it('la IA de la app usa el modelo elegido en Ajustes y, sin elegir, el de opencode', async () => {
    ctx = await setup();
    let model: string | null = null;
    const llm = createOpencodeLlm({ connection: ctx.connection, model: () => model });
    expect(await llm.complete({ system: 's', user: 'u', title: 't' })).toBe('modelo:predeterminado');
    model = 'copilot/claude/sonnet';
    expect(await llm.complete({ system: 's', user: 'u', title: 't' })).toBe('modelo:claude/sonnet');
  });
});

describe('sesión con opencode en la app', () => {
  it('antes de empezar no llama a opencode y propone el modelo y el modo de Ajustes', async () => {
    ctx = await setup();
    await ctx.call('PUT', '/api/ai/settings', { sessionModel: 'copilot/gpt-5', sessionAgent: 'plan' });
    const { body } = await ctx.call<TaskChat>('GET', '/api/tasks/ABC-1/chat');
    expect(body).toMatchObject({ available: true, started: false, busy: false, messages: [], model: 'copilot/gpt-5', agent: 'plan' });
    expect(body.starterPrompt).toContain('ABC-1');
    expect(ctx.oc.calls).toEqual([]);
  });

  it('el primer mensaje crea la sesión en la carpeta de la tarea, con TAREA.md, y envía el modelo y el modo elegidos', async () => {
    ctx = await setup();
    const sent = await ctx.call<TaskChat>('POST', '/api/tasks/ABC-1/chat/messages', { text: ' Empieza ', model: 'copilot/claude/sonnet', agent: 'plan' });
    expect(sent.body).toMatchObject({ started: true, busy: true, model: 'copilot/claude/sonnet', agent: 'plan' });
    expect(existsSync(join(ctx.folder, 'TAREA.md'))).toBe(true);
    expect(readFileSync(join(ctx.folder, 'TAREA.md'), 'utf8')).toContain('ABC-1');

    const created = ctx.oc.calls.find((c) => c.path === '/session' && c.method === 'POST')!;
    expect(created.directory).toBe(ctx.folder);
    const prompt = ctx.oc.calls.find((c) => c.path.endsWith('/prompt_async'))!;
    expect(prompt.directory).toBe(ctx.folder);
    expect(prompt.body).toEqual({
      parts: [{ type: 'text', text: 'Empieza' }],
      model: { providerID: 'copilot', modelID: 'claude/sonnet' },
      agent: 'plan',
      tools: { question: false },
    });

    // El siguiente mensaje sigue en la misma sesión y recuerda la selección; se puede cambiar solo el modo.
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Sigue', agent: 'build' });
    const prompts = ctx.oc.calls.filter((c) => c.path.endsWith('/prompt_async'));
    expect(ctx.oc.calls.filter((c) => c.path === '/session' && c.method === 'POST')).toHaveLength(1);
    expect(prompts[1]!.body).toMatchObject({ model: { providerID: 'copilot', modelID: 'claude/sonnet' }, agent: 'build' });
    // Con "el predeterminado de opencode" no se envía modelo.
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Otra', model: null });
    expect(ctx.oc.calls.filter((c) => c.path.endsWith('/prompt_async'))[2]!.body.model).toBeUndefined();
  });

  it('enseña la conversación, la actividad, el contexto usado y los permisos de la sesión en marcha', async () => {
    ctx = await setup();
    await ctx.call('GET', '/api/ai/options'); // carga los límites de contexto
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' });
    ctx.oc.state.messages = [
      { info: { id: 'm1', role: 'user', agent: 'build', model: { providerID: 'copilot', modelID: 'gpt-5' }, time: { created: 1000 } }, parts: [{ id: 'p1', type: 'text', text: 'Hola' }, { id: 'p0', type: 'text', text: 'interno', synthetic: true }] },
      {
        info: { id: 'm2', role: 'assistant', mode: 'build', providerID: 'copilot', modelID: 'gpt-5', time: { created: 2000 }, tokens: { input: 200, output: 30, cache: { read: 20 } } },
        parts: [
          { id: 'p2', type: 'step-start' },
          { id: 'p3', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: join(ctx.folder, 'TAREA.md') }, output: 'x'.repeat(5000), time: { start: 1000, end: 3400 } } },
          { id: 'p4', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'git status' } } },
          { id: 'p5', type: 'tool', tool: 'jira_get_issue', state: { status: 'error', input: { issueKey: 'ABC-1' }, error: 'sin permiso' } },
          { id: 'p6', type: 'text', text: 'Voy a mirar el repo.' },
        ],
      },
      { info: { id: 'm3', role: 'assistant', mode: 'build', providerID: 'copilot', modelID: 'gpt-5', time: { created: 3000 }, error: { name: 'MessageAbortedError', data: { message: 'aborted' } } }, parts: [] },
    ];
    ctx.oc.state.status = { ses_1: { type: 'busy' } };
    ctx.oc.state.permissions = [
      { id: 'per_1', sessionID: 'ses_1', permission: 'bash', patterns: ['git commit -m x'], metadata: { command: 'git commit -m x' }, always: ['git commit *'] },
      { id: 'per_2', sessionID: 'ses_1', permission: 'edit', patterns: ['a'], metadata: { filepath: join(ctx.folder, 'src', 'a.ts'), diff: '+hola' }, always: ['*'] },
      { id: 'per_viejo', sessionID: 'ses_parada', permission: 'bash', patterns: ['rm x'], metadata: {}, always: [] },
    ];

    const { body } = await ctx.call<TaskChat>('GET', '/api/tasks/ABC-1/chat');
    expect(body).toMatchObject({ started: true, busy: true, contextPercent: 25 });
    expect(body.messages.map((m) => [m.role, m.agent, m.model, m.error])).toEqual([
      ['user', 'build', 'copilot/gpt-5', null],
      ['assistant', 'build', 'copilot/gpt-5', null],
      ['assistant', 'build', 'copilot/gpt-5', 'Parado.'],
    ]);
    expect(body.messages[0]!.parts).toEqual([{ type: 'text', id: 'p1', text: 'Hola' }]);
    const [read, bash, mcp, text] = body.messages[1]!.parts;
    expect(read).toMatchObject({ type: 'tool', tool: 'read', status: 'completed', detail: 'TAREA.md', seconds: 2 });
    expect(read?.type === 'tool' && read.output).toHaveLength(4001);
    expect(bash).toMatchObject({ tool: 'bash', status: 'running', detail: 'git status', output: null, seconds: null });
    expect(mcp).toMatchObject({ tool: 'jira_get_issue', status: 'error', detail: 'ABC-1', output: 'sin permiso' });
    expect(text).toEqual({ type: 'text', id: 'p6', text: 'Voy a mirar el repo.' });
    expect(body.permissions).toEqual([
      { id: 'per_1', permission: 'bash', detail: 'git commit -m x', diff: null, always: ['git commit *'] },
      { id: 'per_2', permission: 'edit', detail: join('src', 'a.ts'), diff: '+hola', always: ['*'] },
    ]);
  });

  it('responde un permiso con lo que elige el usuario', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' });
    ctx.oc.state.status = { ses_1: { type: 'busy' } };
    ctx.oc.state.permissions = [{ id: 'per_1', sessionID: 'ses_1', permission: 'bash', patterns: ['ls'], metadata: {}, always: [] }];
    expect((await ctx.call('POST', '/api/tasks/ABC-1/chat/permissions/per_1', { reply: 'siempre' })).status).toBe(400);
    await ctx.call('POST', '/api/tasks/ABC-1/chat/permissions/per_1', { reply: 'always' });
    expect(ctx.oc.calls.find((c) => c.path === '/permission/per_1/reply')).toMatchObject({ directory: ctx.folder, body: { reply: 'always' } });
    // Uno que ya no está pendiente no se responde.
    await ctx.call('POST', '/api/tasks/ABC-1/chat/permissions/per_otro', { reply: 'once' });
    expect(ctx.oc.calls.some((c) => c.path.includes('per_otro'))).toBe(false);
  });

  it('parar la sesión la aborta y rechaza lo que tenía pendiente; "nueva sesión" empieza otra', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' });
    ctx.oc.state.permissions = [{ id: 'per_1', sessionID: 'ses_1', permission: 'bash', patterns: ['ls'], metadata: {}, always: [] }];
    await ctx.call('POST', '/api/tasks/ABC-1/chat/abort');
    expect(ctx.oc.calls.some((c) => c.path === '/session/ses_1/abort')).toBe(true);
    expect(ctx.oc.calls.find((c) => c.path === '/permission/per_1/reply')?.body).toEqual({ reply: 'reject' });

    const reset = await ctx.call<TaskChat>('POST', '/api/tasks/ABC-1/chat/reset');
    expect(reset.body).toMatchObject({ started: false, messages: [] });
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'De nuevo' });
    expect(ctx.oc.calls.filter((c) => c.path.endsWith('/prompt_async')).pop()!.path).toBe('/session/ses_2/prompt_async');
  });

  it('si la sesión ya no existe en opencode, la conversación vuelve a empezar', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' });
    ctx.oc.state.sessions.clear();
    expect((await ctx.call<TaskChat>('GET', '/api/tasks/ABC-1/chat')).body).toMatchObject({ available: true, started: false });
  });

  it('si opencode no responde, lo dice sin perder la sesión', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' });
    ctx.oc.close();
    await new Promise((r) => setTimeout(r, 50));
    const { status, body } = await ctx.call<TaskChat>('GET', '/api/tasks/ABC-1/chat');
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, started: true });
    expect(body.error).toBeTruthy();
    expect((await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' })).status).toBe(503);
  });

  it('sin opencode configurado, enviar responde que la IA no está disponible', async () => {
    ctx = await setup({ withOpencode: false });
    expect((await ctx.call<TaskChat>('GET', '/api/tasks/ABC-1/chat')).body).toMatchObject({ available: false, started: false });
    expect((await ctx.call('POST', '/api/tasks/ABC-1/chat/messages', { text: 'Hola' })).status).toBe(503);
  });
});

describe('chat general con opencode', () => {
  it('la primera vez enseña una conversación nueva con el modelo y el modo de Ajustes, sin llamar a opencode', async () => {
    ctx = await setup();
    await ctx.call('PUT', '/api/ai/settings', { sessionModel: 'copilot/gpt-5', sessionAgent: 'plan' });
    expect((await ctx.call<GeneralChat>('GET', '/api/chats/new')).body).toMatchObject({ id: null, started: false, model: 'copilot/gpt-5', agent: 'plan' });
    expect(ctx.oc.calls).toEqual([]);
  });

  it('el primer mensaje crea la conversación en la carpeta del chat, con instrucciones para no guardar ahí sin preguntar', async () => {
    ctx = await setup();
    const folder = join(ctx.home, 'chat');
    const { body } = await ctx.call<GeneralChat>('POST', '/api/chats', { text: 'Analiza la latencia\n de checkout', model: 'copilot/gpt-5', agent: 'plan' });
    expect(body).toMatchObject({ id: 'ses_1', started: true, busy: true, title: 'Analiza la latencia de checkout', model: 'copilot/gpt-5', agent: 'plan' });
    const create = ctx.oc.calls.find((c) => c.path === '/session' && c.method === 'POST')!;
    expect(create.directory).toBe(folder);
    // Sin título: lo pone opencode a partir del primer mensaje.
    expect(create.body).toEqual({});
    expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).toContain('pregúntale en qué carpeta');
    const prompt = ctx.oc.calls.find((c) => c.path === '/session/ses_1/prompt_async')!;
    expect(prompt.directory).toBe(folder);
    expect(prompt.body).toMatchObject({ model: { providerID: 'copilot', modelID: 'gpt-5' }, agent: 'plan', tools: { question: false } });
  });

  it('lista las conversaciones de la app con el título de opencode, la más reciente primero, y no las de otras sesiones', async () => {
    ctx = await setup();
    ctx.oc.state.sessions.add('ses_99');
    await ctx.call('POST', '/api/chats', { text: 'Primera' });
    await ctx.call('POST', '/api/chats', { text: 'Segunda' });
    ctx.oc.state.titles.ses_1 = 'Latencia de checkout-api';
    const { body } = await ctx.call<ConversationList>('GET', '/api/chats');
    expect(body.available).toBe(true);
    expect(body.conversations.map((c) => [c.id, c.title])).toEqual([
      ['ses_2', 'Segunda'],
      ['ses_1', 'Latencia de checkout-api'],
    ]);
  });

  it('sigue la conversación con el modelo y el modo de cada mensaje, y solo enseña sus permisos', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/chats', { text: 'Hola' });
    const { body } = await ctx.call<GeneralChat>('POST', '/api/chats/ses_1/messages', { text: 'Sigue', agent: 'plan' });
    expect(body).toMatchObject({ id: 'ses_1', agent: 'plan', busy: true });
    ctx.oc.state.status = { ses_1: { type: 'busy' }, ses_7: { type: 'busy' } };
    ctx.oc.state.permissions = [
      { id: 'per_1', sessionID: 'ses_1', permission: 'external_directory', patterns: ['/home/jorge/analisis/*'] },
      { id: 'per_2', sessionID: 'ses_7', permission: 'bash', patterns: ['ls'] },
    ];
    const chat = (await ctx.call<GeneralChat>('GET', '/api/chats/ses_1')).body;
    expect(chat.permissions.map((p) => p.id)).toEqual(['per_1']);
    expect(chat.permissions[0]!.detail).toBe('/home/jorge/analisis/*');
  });

  it('borra la conversación de la app y de opencode; una que no es del chat da 404', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/chats', { text: 'Hola' });
    expect((await ctx.call('DELETE', '/api/chats/ses_1')).status).toBe(204);
    expect(ctx.oc.state.sessions.has('ses_1')).toBe(false);
    expect((await ctx.call<ConversationList>('GET', '/api/chats')).body.conversations).toEqual([]);
    expect((await ctx.call('GET', '/api/chats/ses_1')).status).toBe(404);
    ctx.oc.state.sessions.add('ses_50');
    expect((await ctx.call('POST', '/api/chats/ses_50/messages', { text: 'x' })).status).toBe(404);
  });

  it('si la borraron en opencode, desaparece de la lista', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/chats', { text: 'Hola' });
    ctx.oc.state.sessions.delete('ses_1');
    expect((await ctx.call('GET', '/api/chats/ses_1')).status).toBe(404);
    expect((await ctx.call<ConversationList>('GET', '/api/chats')).body.conversations).toEqual([]);
  });

  it('sin opencode no se puede empezar y lo dice', async () => {
    ctx = await setup({ withOpencode: false });
    expect((await ctx.call<ConversationList>('GET', '/api/chats')).body).toMatchObject({ available: false, conversations: [] });
    expect((await ctx.call('POST', '/api/chats', { text: 'Hola' })).status).toBe(503);
  });
});
