import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrCheckFailure, PrFailures, PrFixResult } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { GithubClient, failuresOf, type GhPullRequest } from '../../integrations/github/client.js';
import { OpencodeApi } from '../../integrations/opencode/api.js';
import { createOpencodeConnection } from '../../integrations/opencode/connection.js';
import { fakeOpencode } from '../../testing/fake-opencode.js';
import { PrWatcher } from './watcher.js';

const checkstyle = {
  __typename: 'CheckRun' as const,
  name: 'build / checkstyle',
  conclusion: 'FAILURE',
  title: '3 errores de Checkstyle',
  summary: '',
  text: null,
  detailsUrl: 'https://github.com/acme/orders-api/runs/1',
  annotations: {
    totalCount: 3,
    nodes: [
      { path: 'src/Iban.java', location: { start: { line: 9 } }, message: 'Variable sin usar', title: null, annotationLevel: 'WARNING' as const },
      { path: 'src/Iban.java', location: { start: { line: 42 } }, message: 'Falta el Javadoc. [MissingJavadocMethod]', title: null, annotationLevel: 'FAILURE' as const },
      { path: 'src/Iban.java', location: { start: { line: 57 } }, message: 'Línea de 134 caracteres. [LineLength]', title: null, annotationLevel: 'FAILURE' as const },
    ],
  },
};

describe('fallos de los checks', () => {
  it('saca de GitHub el título, el resumen y las líneas marcadas (los errores primero) de cada check en rojo', () => {
    const failures = failuresOf([
      checkstyle,
      { ...checkstyle, name: 'build / test', conclusion: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'sherpa-conventions', state: 'FAILURE', description: 'El título de la PR no cumple la convención', targetUrl: 'https://sherpa/x' },
      { __typename: 'StatusContext', context: 'jenkins', state: 'SUCCESS', description: 'ok', targetUrl: null },
      { ...checkstyle, name: 'secrets', title: 'Secret detected', summary: 'Found 1 secret in config.yml', text: 'Rotate it.', annotations: null },
    ]);
    expect(failures.map((f) => f.name)).toEqual(['build / checkstyle', 'sherpa-conventions', 'secrets']);
    expect(failures[0]).toMatchObject({ title: '3 errores de Checkstyle', summary: null, annotationsTotal: 3 });
    expect(failures[0]!.annotations.map((a) => [a.line, a.level])).toEqual([
      [42, 'failure'],
      [57, 'failure'],
      [9, 'warning'],
    ]);
    expect(failures[1]).toEqual<PrCheckFailure>({
      name: 'sherpa-conventions',
      title: 'El título de la PR no cumple la convención',
      summary: null,
      url: 'https://sherpa/x',
      annotations: [],
      annotationsTotal: 0,
    });
    expect(failures[2]!.summary).toBe('Found 1 secret in config.yml\n\nRotate it.');
  });

  it('pide a GitHub solo esa PR', async () => {
    let sent: any;
    const client = new GithubClient({ token: 't' }, (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { node: { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [checkstyle] } } } }] } } } }));
    }) as typeof fetch);
    const result = await client.checkFailures('PR_9');
    expect(sent.variables).toEqual({ id: 'PR_9' });
    expect(result.checks).toBe('failure');
    expect(result.failures).toHaveLength(1);
    expect(result.passing).toEqual([]);
  });
});

const pr = (over: Partial<GhPullRequest> = {}): GhPullRequest => ({
  id: 'PR_1',
  repo: 'acme/orders-api',
  number: 212,
  title: 'Validar el IBAN',
  url: 'https://github.com/acme/orders-api/pull/212',
  state: 'open',
  isDraft: false,
  headRef: 'feature/ABC-142-iban',
  updatedAt: '2026-11-10T10:00:00Z',
  checks: 'failure',
  failingChecks: ['build / checkstyle'],
  reviews: [],
  comments: [],
  ...over,
});

async function setup() {
  const oc = await fakeOpencode();
  const { db } = openDatabase(':memory:');
  const state = { open: [pr(), pr({ id: 'PR_2', number: 7, headRef: 'arreglo-suelto', title: 'Arreglo' })], failures: [checkstyle] as object[] };
  const client = {
    warnings: [],
    myOpenPrs: async () => ({ login: 'jorge', prs: state.open }),
    prsByIds: async () => [],
    checkFailures: async () => ({ checks: 'failure', failures: failuresOf(state.failures as never), passing: ['build / test'], pending: [] }),
  } as unknown as GithubClient;
  const watcher = new PrWatcher(db, client);
  await watcher.check();
  const home = mkdtempSync(join(tmpdir(), 'da-prfix-'));
  const app = await buildApp(db, { prWatcher: watcher, devAssistantHome: home, opencode: new OpencodeApi(createOpencodeConnection({ url: oc.url })) });
  const call = async <T>(method: 'GET' | 'POST', url: string) => {
    const res = await app.inject({ method, url });
    return { status: res.statusCode, body: res.json<T>() };
  };
  return { app, oc, state, call, home };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.app.close();
  ctx?.oc.close();
});

describe('arreglar con opencode', () => {
  it('enseña los fallos de una PR tuya y da 404 con una que no conoce', async () => {
    ctx = await setup();
    const { body } = await ctx.call<PrFailures>('GET', '/api/prs/PR_1/failures');
    expect(body).toMatchObject({ prId: 'PR_1', taskKey: 'ABC-142', checks: 'failure' });
    expect(body.failures[0]!.name).toBe('build / checkstyle');
    expect((await ctx.call('GET', '/api/prs/PR_99/failures')).status).toBe(404);
  });

  it('con tarea, pasa los fallos a la sesión de la tarea', async () => {
    ctx = await setup();
    const { body } = await ctx.call<PrFixResult>('POST', '/api/prs/PR_1/fix');
    expect(body).toEqual({ target: 'task', taskKey: 'ABC-142' });
    const prompt = ctx.oc.calls.find((c) => c.path.endsWith('/prompt_async'))!;
    expect(prompt.directory).toBe(join(ctx.home, 'worktrees', 'ABC-142'));
    const text: string = prompt.body.parts[0].text;
    expect(text).toContain('acme/orders-api #212');
    expect(text).toContain('### build / checkstyle');
    expect(text).toContain('- src/Iban.java:42: Falta el Javadoc. [MissingJavadocMethod]');
    expect(text).toContain('feature/ABC-142-iban');
  });

  it('sin tarea, empieza una conversación del chat general que pregunta dónde está el repo', async () => {
    ctx = await setup();
    const { body } = await ctx.call<PrFixResult>('POST', '/api/prs/PR_2/fix');
    expect(body).toEqual({ target: 'chat', conversationId: 'ses_1' });
    const prompt = ctx.oc.calls.find((c) => c.path.endsWith('/prompt_async'))!;
    expect(prompt.directory).toBe(join(ctx.home, 'chat'));
    expect(prompt.body.parts[0].text).toContain('pregúntame en qué carpeta está el repo');
  });

  it('si ya no hay checks en rojo, lo dice y no molesta a opencode', async () => {
    ctx = await setup();
    ctx.state.failures = [];
    const { status, body } = await ctx.call<{ error: string }>('POST', '/api/prs/PR_1/fix');
    expect(status).toBe(409);
    expect(body.error).toContain('ya no tiene checks en rojo');
    expect(ctx.oc.calls).toEqual([]);
  });
});
