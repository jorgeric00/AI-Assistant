import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repo, RepoDetail, RepoInspection } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import type { Llm, LlmRequest } from '../../integrations/opencode/llm.js';
import { githubFromRemote } from './git.js';
import { parseProfile } from './profile-draft.js';

/** Repo git de verdad en una carpeta temporal, con remoto de GitHub y rama develop. */
function gitRepo(name: string, remote = `git@github.com:acme/${name}.git`) {
  const dir = join(mkdtempSync(join(tmpdir(), 'repos-')), name);
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'develop');
  if (remote) git('remote', 'add', 'origin', remote);
  writeFileSync(join(dir, 'README.md'), '# Orders API\nAPI de pedidos en Java 21.');
  writeFileSync(join(dir, 'pom.xml'), '<project><artifactId>orders-api</artifactId></project>');
  mkdirSync(join(dir, 'src', 'main'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
  return dir;
}

const PROFILE_ANSWER = '## Convenciones\n- Java 21\n\n## Tests\n- `mvn test`\n\n## Arquitectura\n- API de pedidos';

async function setup() {
  const { db } = openDatabase(':memory:');
  const prompts: LlmRequest[] = [];
  const llm: Llm = {
    complete: async (req) => {
      prompts.push(req);
      return PROFILE_ANSWER;
    },
  };
  const app = await buildApp(db, { llm });
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
  };
  return { app, call, prompts };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('repositorios', () => {
  it('deduce nombre, GitHub y rama base de una carpeta, y avisa si no es un repo git', async () => {
    ctx = await setup();
    const dir = gitRepo('orders-api');
    expect((await ctx.call<RepoInspection>('POST', '/api/repos/inspect', { localPath: dir })).body).toEqual({
      isGitRepo: true,
      name: 'orders-api',
      github: 'acme/orders-api',
      defaultBranch: 'develop',
    });
    const notRepo = mkdtempSync(join(tmpdir(), 'nada-'));
    expect((await ctx.call<RepoInspection>('POST', '/api/repos/inspect', { localPath: notRepo })).body.isGitRepo).toBe(false);
  });

  it('da de alta, edita la ficha, la lista y la quita', async () => {
    ctx = await setup();
    const dir = gitRepo('orders-api');
    const created = await ctx.call<RepoDetail>('POST', '/api/repos', { name: 'orders-api', localPath: dir, github: 'acme/orders-api', defaultBranch: 'develop', jiraProjectKeys: ['sgarfidin'] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'orders-api', jiraProjectKeys: ['SGARFIDIN'], profileStatus: 'sin_ficha', profile: null, pathOk: true });

    const id = created.body.id;
    const updated = await ctx.call<RepoDetail>('PATCH', `/api/repos/${id}`, {
      defaultBranch: 'main',
      profile: { conventionsMd: '- Java', testCommandsMd: '- `mvn test`', architectureMd: '' },
    });
    expect(updated.body).toMatchObject({ defaultBranch: 'main', profileStatus: 'completa', profile: { conventionsMd: '- Java', aiDraft: false } });

    expect((await ctx.call<Repo[]>('GET', '/api/repos')).body.map((r) => [r.name, r.profileStatus])).toEqual([['orders-api', 'completa']]);
    expect((await ctx.call('DELETE', `/api/repos/${id}`)).status).toBe(204);
    expect((await ctx.call('GET', `/api/repos/${id}`)).status).toBe(404);
  });

  it('rechaza carpetas que no son repos git, nombres repetidos y datos mal escritos', async () => {
    ctx = await setup();
    const dir = gitRepo('orders-api');
    const notRepo = mkdtempSync(join(tmpdir(), 'nada-'));
    expect((await ctx.call('POST', '/api/repos', { name: 'x', localPath: notRepo })).status).toBe(400);
    expect((await ctx.call('POST', '/api/repos', { name: 'orders-api', localPath: dir })).status).toBe(201);
    const dup = await ctx.call<{ error: string }>('POST', '/api/repos', { name: 'orders-api', localPath: dir });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('orders-api');
    expect((await ctx.call('POST', '/api/repos', { name: 'y', localPath: dir, github: 'no-vale' })).status).toBe(400);
    expect((await ctx.call('POST', '/api/repos', { name: 'z', localPath: dir, jiraProjectKeys: ['1ABC'] })).status).toBe(400);
  });

  it('la IA rellena la ficha leyendo el repo y queda por revisar hasta que se guarda', async () => {
    ctx = await setup();
    const dir = gitRepo('orders-api');
    const { body } = await ctx.call<RepoDetail>('POST', '/api/repos', { name: 'orders-api', localPath: dir });
    const drafted = await ctx.call<RepoDetail>('POST', `/api/repos/${body.id}/profile/draft`);
    expect(drafted.body).toMatchObject({
      profileStatus: 'por_revisar',
      profile: { conventionsMd: '- Java 21', testCommandsMd: '- `mvn test`', architectureMd: '- API de pedidos', aiDraft: true },
    });
    const prompt = ctx.prompts[0]!.user;
    expect(prompt).toContain('API de pedidos en Java 21.');
    expect(prompt).toContain('--- pom.xml ---');
    expect(prompt).toContain('src/');
    expect(prompt).not.toContain('node_modules');

    const saved = await ctx.call<RepoDetail>('PATCH', `/api/repos/${body.id}`, { profile: drafted.body.profile! });
    expect(saved.body.profileStatus).toBe('completa');
  });
});

describe('utilidades', () => {
  it('reconoce los remotos de GitHub', () => {
    expect(githubFromRemote('https://github.com/acme/orders-api.git')).toBe('acme/orders-api');
    expect(githubFromRemote('git@github.com:acme/orders-api.git')).toBe('acme/orders-api');
    expect(githubFromRemote('https://github.com/acme/orders.api')).toBe('acme/orders.api');
    expect(githubFromRemote('https://gitlab.com/acme/x.git')).toBe('');
    expect(githubFromRemote(null)).toBe('');
  });

  it('separa la respuesta de la IA en las tres partes de la ficha', () => {
    expect(parseProfile(`Intro ignorada\n${PROFILE_ANSWER}`)).toEqual({ conventionsMd: '- Java 21', testCommandsMd: '- `mvn test`', architectureMd: '- API de pedidos' });
    expect(parseProfile('## Tests\n- npm test')).toEqual({ conventionsMd: '', testCommandsMd: '- npm test', architectureMd: '' });
  });
});
