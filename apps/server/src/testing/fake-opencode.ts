// Un `opencode serve` de mentira para los tests: guarda lo que se le pide y contesta lo que el test le deja preparado.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Call {
  method: string;
  path: string;
  directory: string | null;
  body: any;
}

/** Un `opencode serve` de mentira: guarda lo que se le pide y contesta lo que el test le deja preparado. */
export async function fakeOpencode() {
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
      if (call.path === '/mcp')
        return send(200, { jira: { status: 'failed', error: 'MCP error -32000: Connection closed' }, github: { status: 'connected' }, sonar: { status: 'needs_client_registration' }, viejo: { status: 'disabled' } });
      if (call.path === '/global/health') return send(200, { healthy: true, version: '1.18.34' });
      if (call.path === '/path') return send(200, { home: '/home/u', config: '/home/u/.config/opencode' });
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
