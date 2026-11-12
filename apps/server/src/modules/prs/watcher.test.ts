import { afterEach, describe, expect, it } from 'vitest';
import type { PrAlert, PrDetail, PrList, PullRequestInfo } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { GithubClient, normalizePr, type GhPullRequest } from '../../integrations/github/client.js';
import { TasksRepository } from '../tasks/repository.js';
import { PrWatcher, taskKeyOf } from './watcher.js';

const base = (over: Partial<GhPullRequest> = {}): GhPullRequest => ({
  id: 'PR_1',
  repo: 'acme/orders-api',
  number: 212,
  title: '[ABC-131] Exportar informe de pedidos a CSV',
  url: 'https://github.com/acme/orders-api/pull/212',
  state: 'open',
  isDraft: true,
  headRef: 'feature/ABC-131-exportar-csv',
  updatedAt: '2026-10-06T10:00:00Z',
  checks: 'pending',
  failingChecks: [],
  reviews: [],
  comments: [],
  ...over,
});

/** Cliente falso: devuelve en cada consulta lo que diga `open`, y `byId` para las que ya no están abiertas. */
function fakeClient() {
  const state = { open: [] as GhPullRequest[], others: [] as GhPullRequest[], searchedKeys: [] as string[][], closed: [] as GhPullRequest[], byId: new Map<string, GhPullRequest>() };
  const client = {
    warnings: [] as string[],
    myOpenPrs: async () => ({ login: 'jorge', prs: state.open }),
    openPrsWithKeys: async (keys: string[]) => {
      state.searchedKeys.push(keys);
      return state.others;
    },
    prsByIds: async (ids: string[]) => ids.flatMap((id) => state.byId.get(id) ?? []),
    myClosedPrs: async () => ({ login: 'jorge', prs: state.closed }),
  } as unknown as GithubClient;
  return { client, state };
}

async function setup() {
  const { db } = openDatabase(':memory:');
  const gh = fakeClient();
  const notified: string[] = [];
  const watcher = new PrWatcher(db, gh.client, (title) => {
    notified.push(title);
  });
  const app = await buildApp(db, { prWatcher: watcher });
  const get = async <T>(url: string) => (await app.inject({ method: 'GET', url })).json<T>();
  const put = async (url: string, payload: object) => app.inject({ method: 'PUT', url, payload });
  return { app, db, gh, watcher, notified, get, put };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('avisos de tus PR', () => {
  it('la primera vez solo guarda la PR; después avisa de CI en rojo, comentarios, cambios pedidos, aprobación y merge', async () => {
    ctx = await setup();
    ctx.gh.state.open = [base({ comments: [{ author: 'maria', at: '2026-10-06T09:00:00Z' }] })];
    await ctx.watcher.check();
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toEqual([]);

    ctx.gh.state.open = [
      base({
        checks: 'failure',
        failingChecks: ['test', 'lint'],
        comments: [
          { author: 'maria', at: '2026-10-06T09:00:00Z' },
          { author: 'pedro', at: '2099-01-01T10:00:00Z' },
        ],
        reviews: [{ author: 'maria', at: '2099-01-01T10:05:00Z', state: 'CHANGES_REQUESTED', comments: 2 }],
      }),
    ];
    await ctx.watcher.check();
    const alerts = await ctx.get<PrAlert[]>('/api/pr-alerts');
    expect(alerts.map((a) => [a.kind, a.title, a.detail])).toEqual(
      expect.arrayContaining([
        ['ci_failed', 'CI en rojo', 'Falla test, lint'],
        ['changes_requested', 'Cambios pedidos', 'Por maria'],
        ['comments', '1 comentario nuevo', 'De pedro'],
      ]),
    );
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatchObject({ repo: 'acme/orders-api', number: 212, taskKey: 'ABC-131' });
    expect(ctx.notified).toContain('CI en rojo · orders-api #212');

    // Sin cambios no se repiten los avisos.
    await ctx.watcher.check();
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toHaveLength(3);

    ctx.gh.state.open = [];
    ctx.gh.state.byId.set('PR_1', base({ state: 'merged', checks: 'success', reviews: [{ author: 'maria', at: '2099-01-02T10:00:00Z', state: 'APPROVED', comments: 0 }] }));
    await ctx.watcher.check();
    // Se avisa de que se ha mergeado, pero la PR sale de los avisos de Hoy con todos sus avisos.
    expect(ctx.notified).toEqual(expect.arrayContaining(['Aprobada · orders-api #212', 'Mergeada · orders-api #212']));
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toEqual([]);

    const prs = await ctx.get<PullRequestInfo[]>('/api/tasks/ABC-131/prs');
    expect(prs).toEqual([expect.objectContaining({ number: 212, state: 'merged', checks: 'success', approvedBy: ['maria'], changesRequestedBy: [] })]);
  });

  it('sin GITHUB_TOKEN lo explica', async () => {
    const app = await buildApp(openDatabase(':memory:').db);
    expect((await app.inject({ method: 'GET', url: '/api/prs/status' })).json()).toMatchObject({ configured: false });
    const res = await app.inject({ method: 'POST', url: '/api/prs/check' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('GITHUB_TOKEN');
    await app.close();
  });
});

describe('GitHub', () => {
  it('saca la clave de JIRA de la rama o del título', () => {
    expect(taskKeyOf('feature/SGARFIDIN-1024-security', 'x')).toBe('SGARFIDIN-1024');
    expect(taskKeyOf('fix-login', '[ABC-7] Login')).toBe('ABC-7');
    expect(taskKeyOf('main', 'Sin clave')).toBeNull();
  });

  it('normaliza la PR: checks fallidos y sin tu actividad ni la de bots', () => {
    const pr = normalizePr(
      {
        id: 'PR_1',
        number: 1,
        title: 't',
        url: 'u',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/ABC-1-x',
        updatedAt: '2026-10-06T10:00:00Z',
        repository: { nameWithOwner: 'acme/web' },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: 'FAILURE',
                  contexts: {
                    nodes: [
                      { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },
                      { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE' },
                      { __typename: 'StatusContext', context: 'sonar', state: 'ERROR' },
                    ],
                  },
                },
              },
            },
          ],
        },
        reviews: {
          nodes: [
            { author: { login: 'maria', __typename: 'User' }, state: 'COMMENTED', submittedAt: '2026-10-06T10:00:00Z', body: 'Ojo', comments: { totalCount: 2 } },
            { author: { login: 'Jorge', __typename: 'User' }, state: 'COMMENTED', submittedAt: '2026-10-06T10:01:00Z', body: '', comments: { totalCount: 1 } },
          ],
        },
        comments: { nodes: [{ author: { login: 'sonarbot', __typename: 'Bot' }, createdAt: '2026-10-06T10:02:00Z' }] },
      },
      'jorge',
    );
    expect(pr).toMatchObject({ state: 'open', checks: 'failure', failingChecks: ['test', 'sonar'], comments: [] });
    expect(pr.reviews).toEqual([{ author: 'maria', at: '2026-10-06T10:00:00Z', state: 'COMMENTED', comments: 3 }]);
  });

  it('explica un token sin autorizar para el SSO', async () => {
    const client = new GithubClient({ token: 't' }, async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Resource protected by organization SAML enforcement.' }] }), { status: 200 }),
    );
    await expect(client.myOpenPrs()).rejects.toThrow(/SSO/);
  });
});

describe('PR de otras personas con la clave de una tarea', () => {
  const boss = () => base({ id: 'PR_B', number: 1130, repo: 'acme/lib-orders', title: '[ABC-131] Algoritmo en la librería', headRef: 'feature/algoritmo', author: 'jefe', checks: 'failure', failingChecks: ['build'] });

  it('salen en su tarea, pero no en tus PR y no avisan', async () => {
    ctx = await setup();
    new TasksRepository(ctx.db).upsertFromJira(
      [{ key: 'ABC-131', summary: 'Exportar', description: null, status: 'En curso', statusCategory: 'indeterminate', priority: null, issueType: null, project: null, updated: null, url: 'u' }],
      '2026-10-06T10:00:00Z',
    );
    ctx.gh.state.open = [base()];
    ctx.gh.state.others = [boss()];
    await ctx.watcher.check();
    ctx.gh.state.others = [boss()];
    await ctx.watcher.check();

    // Se buscó por la clave de la tarea abierta.
    expect(ctx.gh.state.searchedKeys[0]).toEqual(['ABC-131']);
    const forTask = await ctx.get<PullRequestInfo[]>('/api/tasks/ABC-131/prs');
    expect(forTask.map((p) => [p.number, p.mine, p.author])).toEqual(expect.arrayContaining([[1130, false, 'jefe'], [212, true, null]]));
    expect((await ctx.get<PrList>('/api/prs')).prs.map((p) => p.number)).toEqual([212]);
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toEqual([]);
    expect(ctx.notified).toEqual([]);

    // Cuando se mergea se actualiza, aunque ya no salga en la búsqueda de abiertas.
    ctx.gh.state.others = [];
    ctx.gh.state.byId.set('PR_B', { ...boss(), state: 'merged' });
    await ctx.watcher.check();
    expect((await ctx.get<PullRequestInfo[]>('/api/tasks/ABC-131/prs')).find((p) => p.number === 1130)).toMatchObject({ state: 'merged', mine: false });
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toEqual([]);
  });

  it('si la búsqueda falla, sigue con tus PR y deja el motivo', async () => {
    ctx = await setup();
    new TasksRepository(ctx.db).upsertFromJira(
      [{ key: 'ABC-131', summary: 'Exportar', description: null, status: 'En curso', statusCategory: 'indeterminate', priority: null, issueType: null, project: null, updated: null, url: 'u' }],
      '2026-10-06T10:00:00Z',
    );
    ctx.gh.state.open = [base()];
    (ctx.gh.client as unknown as { openPrsWithKeys: () => Promise<never> }).openPrsWithKeys = async () => Promise.reject(new Error('rate limit'));
    await ctx.watcher.check();
    expect((await ctx.get<PrList>('/api/prs')).prs).toHaveLength(1);
    expect(ctx.watcher.status().lastError).toBe('rate limit');
  });

  it('la búsqueda en GitHub va de 5 en 5 claves y descarta las que no llevan la clave exacta en el título', async () => {
    const queries: string[] = [];
    const node = (n: number, title: string) => ({
      id: `PR_${n}`, number: n, title, url: `u${n}`, state: 'OPEN', isDraft: false, headRefName: 'x', updatedAt: '2026-10-06T10:00:00Z', author: { login: 'jefe' },
      repository: { nameWithOwner: 'acme/lib' }, commits: { nodes: [] }, reviews: { nodes: [] }, comments: { nodes: [] },
    });
    const client = new GithubClient({ token: 't' }, async (_url, init) => {
      const q = (JSON.parse(String(init?.body)) as { variables: { q: string } }).variables.q;
      queries.push(q);
      return new Response(JSON.stringify({ data: { search: { nodes: q.includes('"A-1"') ? [node(1, '[A-1] bien'), node(2, '[A-10] otra tarea'), null, {}] : [] } } }), { status: 200 });
    });
    const prs = await client.openPrsWithKeys(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'], 'jorge');
    expect(queries).toEqual(['is:pr is:open in:title ("A-1" OR "A-2" OR "A-3" OR "A-4" OR "A-5")', 'is:pr is:open in:title ("A-6")']);
    expect(prs.map((p) => [p.number, p.author])).toEqual([[1, 'jefe']]);
  });
});

describe('sección Pull requests', () => {
  it('por defecto lista las abiertas; las mergeadas y cerradas las pide a GitHub', async () => {
    ctx = await setup();
    ctx.gh.state.open = [base()];
    await ctx.watcher.check();
    ctx.gh.state.closed = [base({ id: 'PR_9', number: 198, state: 'merged', headRef: 'feature/ABC-120-x', updatedAt: '2026-10-01T10:00:00Z' })];
    const open = await ctx.get<PrList>('/api/prs');
    expect(open.prs.map((p) => [p.number, p.watched])).toEqual([[212, true]]);
    expect((await ctx.get<PrList>('/api/prs?state=merged')).prs.map((p) => [p.number, p.taskKey])).toEqual([[198, 'ABC-120']]);
    expect((await ctx.get<PrList>('/api/prs?state=all')).prs.map((p) => p.number)).toEqual([212, 198]);
    expect((await ctx.get<PrList>('/api/prs?state=closed')).prs).toEqual([]);
  });

  it('sin observar, la PR no avisa en Hoy ni notifica, y al volver a observarla salen sus avisos', async () => {
    ctx = await setup();
    ctx.gh.state.open = [base()];
    await ctx.watcher.check();
    expect((await ctx.put('/api/prs/PR_1/watch', { watched: false })).json<PullRequestInfo>().watched).toBe(false);
    ctx.gh.state.open = [base({ checks: 'failure', failingChecks: ['lint'] })];
    await ctx.watcher.check();
    expect(await ctx.get<PrAlert[]>('/api/pr-alerts')).toEqual([]);
    expect(ctx.notified).toEqual([]);
    // En su página sí se ven.
    expect((await ctx.get<PrDetail>('/api/prs/PR_1')).alerts.map((a) => a.kind)).toEqual(['ci_failed']);
    await ctx.put('/api/prs/PR_1/watch', { watched: true });
    expect((await ctx.get<PrAlert[]>('/api/pr-alerts')).map((a) => a.kind)).toEqual(['ci_failed']);
    expect((await ctx.put('/api/prs/PR_404/watch', { watched: true })).statusCode).toBe(404);
  });
});
