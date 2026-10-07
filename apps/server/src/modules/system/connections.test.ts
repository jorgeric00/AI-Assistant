import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionsStatus, ConnectionTestResult, JiraSyncStatus, PrWatchStatus } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { Connections, patchEnv } from './connections.js';

let close: (() => Promise<unknown>) | undefined;
afterEach(async () => close?.());

/** JIRA y GitHub falsos: responden quién es el usuario del token. */
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('/rest/api/2/myself')) return Response.json({ displayName: 'Jorge Rico' });
  if (url.includes('graphql')) return Response.json({ data: { viewer: { login: 'jorgeric00', pullRequests: { nodes: [] } } } });
  return new Response('no', { status: 404 });
};

async function setup(initial = '') {
  const dir = await mkdtemp(join(tmpdir(), 'ai-assistant-'));
  const envFile = join(dir, '.env');
  await writeFile(envFile, initial);
  const env: NodeJS.ProcessEnv = {};
  const connections = new Connections(envFile, env, fakeFetch);
  const app = await buildApp(openDatabase(':memory:').db, { connections });
  close = () => app.close();
  const req = async <T>(method: 'GET' | 'PATCH' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: res.json<T>() };
  };
  return { envFile, env, req };
}

describe('Ajustes > Conexiones', () => {
  it('guarda la URL y los tokens en el .env sin tocar el resto, y nunca devuelve un token', async () => {
    const ctx = await setup('# Mi configuración\r\nPORT=4321\r\nJIRA_URL=https://viejo\r\n');
    const { status, body } = await ctx.req<ConnectionsStatus>('PATCH', '/api/system/connections', {
      jiraUrl: 'https://jira.inditex.com/jira/',
      jiraToken: 'abcdefghijkl1234',
      jiraMcpToken: 'mcp-token-con espacio',
      githubToken: 'ghp_0123456789wxyz',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      jiraUrl: 'https://jira.inditex.com/jira',
      jiraToken: { set: true, hint: '1234' },
      jiraMcpToken: { set: true, hint: 'acio' },
      githubToken: { set: true, hint: 'wxyz' },
    });
    expect(JSON.stringify(body)).not.toContain('abcdefgh');
    expect(await readFile(ctx.envFile, 'utf8')).toBe(
      "# Mi configuración\r\nPORT=4321\r\nJIRA_URL=https://jira.inditex.com/jira\r\nJIRA_TOKEN=abcdefghijkl1234\r\nJIRA_MCP_TOKEN='mcp-token-con espacio'\r\nGITHUB_TOKEN=ghp_0123456789wxyz\r\n",
    );
    // opencode, abierto desde la app, hereda el token del MCP.
    expect(ctx.env.JIRA_MCP_TOKEN).toBe('mcp-token-con espacio');

    const removed = await ctx.req<ConnectionsStatus>('PATCH', '/api/system/connections', { githubToken: null });
    expect(removed.body.githubToken).toEqual({ set: false, hint: null });
    expect(await readFile(ctx.envFile, 'utf8')).not.toContain('GITHUB_TOKEN');
    expect(ctx.env.GITHUB_TOKEN).toBeUndefined();
  });

  it('se aplica al momento: JIRA y GitHub pasan a estar configurados y "Probar conexión" dice el usuario', async () => {
    const ctx = await setup();
    expect((await ctx.req<JiraSyncStatus>('GET', '/api/jira/status')).body.configured).toBe(false);
    expect((await ctx.req<PrWatchStatus>('GET', '/api/prs/status')).body.configured).toBe(false);
    expect((await ctx.req<ConnectionTestResult>('POST', '/api/system/connections/test', { target: 'jira' })).body).toMatchObject({ ok: false });

    await ctx.req('PATCH', '/api/system/connections', { jiraUrl: 'https://jira.example.com/jira', jiraToken: 'token-jira-123456', githubToken: 'ghp_token123456' });
    expect((await ctx.req<JiraSyncStatus>('GET', '/api/jira/status')).body).toMatchObject({ configured: true, writeProblem: null });
    expect((await ctx.req<PrWatchStatus>('GET', '/api/prs/status')).body.configured).toBe(true);
    expect((await ctx.req<ConnectionTestResult>('POST', '/api/system/connections/test', { target: 'jira' })).body).toEqual({ ok: true, user: 'Jorge Rico', error: null });
    expect((await ctx.req<ConnectionTestResult>('POST', '/api/system/connections/test', { target: 'github' })).body).toEqual({ ok: true, user: 'jorgeric00', error: null });
  });

  it('rechaza una URL que no es http(s) y un token vacío o con saltos de línea', async () => {
    const ctx = await setup();
    for (const payload of [{ jiraUrl: 'jira.inditex.com' }, { jiraToken: '  ' }, { githubToken: 'a\nGITHUB_GRAPHQL_URL=x' }]) {
      expect((await ctx.req('PATCH', '/api/system/connections', payload)).status).toBe(400);
    }
    expect(await readFile(ctx.envFile, 'utf8')).toBe('');
  });

  it('patchEnv deja una sola línea por variable y respeta export', () => {
    expect(patchEnv('export JIRA_TOKEN=a\nX=1\nJIRA_TOKEN=b\n', { JIRA_TOKEN: 'c' })).toBe('JIRA_TOKEN=c\nX=1\n');
    expect(patchEnv('', { A: "it's \"x\"" })).toBe('A="it\'s \\"x\\""\n');
  });
});
