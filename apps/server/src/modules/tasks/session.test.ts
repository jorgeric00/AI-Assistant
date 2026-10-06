import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevSession, RepoDetail, SessionOpenResult } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { parsePlanHeader } from './dev-files.js';

/** Clon con un commit en develop, como el de Jorge. */
function clone(name: string) {
  const dir = join(mkdtempSync(join(tmpdir(), 'sesion-')), name);
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'develop');
  writeFileSync(join(dir, 'README.md'), '# repo');
  git('add', '.');
  git('commit', '-q', '-m', 'inicio');
  return { dir, git };
}

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'da-home-'));
  const launched: { folder: string; key: string; prompt: string }[] = [];
  const app = await buildApp(openDatabase(':memory:').db, {
    devAssistantHome: home,
    terminalLauncher: async (folder, key, prompt) => {
      launched.push({ folder, key, prompt });
      return true;
    },
  });
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => (await app.inject({ method, url, payload })).json<T>();
  const addRepo = (name: string, localPath: string, extra: object = {}) =>
    call<RepoDetail>('POST', '/api/repos', { name, localPath, defaultBranch: 'develop', jiraProjectKeys: ['SGAR'], ...extra });
  return { home, app, call, addRepo, launched };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('sesión de desarrollo', () => {
  it('sin plan, sugiere los repos dados de alta para el proyecto de JIRA y enseña su rama actual', async () => {
    ctx = await setup();
    const web = clone('checkout-web');
    await ctx.addRepo('checkout-web', web.dir);
    await ctx.addRepo('otro', clone('otro').dir, { jiraProjectKeys: ['XYZ'] });

    const s = await ctx.call<DevSession>('GET', '/api/tasks/SGAR-7/session');
    expect(s).toMatchObject({ folder: join(ctx.home, 'worktrees', 'SGAR-7'), branch: null, reposConfirmed: false });
    expect(s.repos).toEqual([
      { name: 'checkout-web', localPath: web.dir, defaultBranch: 'develop', pathOk: true, currentBranch: 'develop', dirty: false, commits: null, prUrl: null },
    ]);
    expect(s.command).toContain('opencode --prompt "Desarrolla la tarea SGAR-7');
  });

  it('con el plan, sigue la rama, los repos y las PR que anota opencode', async () => {
    ctx = await setup();
    const web = clone('checkout-web');
    const api = clone('checkout-api');
    await ctx.addRepo('checkout-web', web.dir, { github: 'acme/checkout-web' });
    await ctx.addRepo('checkout-api', api.dir, { github: 'acme/checkout-api' });

    const branch = 'feature/SGAR-7-validar-email';
    web.git('switch', '-q', '-c', branch);
    for (const n of [1, 2]) {
      writeFileSync(join(web.dir, `f${n}.ts`), `${n}`);
      web.git('add', '.');
      web.git('commit', '-q', '-m', `SGAR-7: paso ${n}`);
    }
    writeFileSync(join(api.dir, 'README.md'), '# cambiado');

    const folder = join(ctx.home, 'worktrees', 'SGAR-7');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'PLAN.md'),
      `# SGAR-7 · Validar email\n\nRama: \`${branch}\`\nRepos: checkout-web (${web.dir}, base develop), checkout-api, legacy\nPR: https://github.com/acme/checkout-web/pull/42\n\n## Análisis\n- [x] Leer el ticket\n`,
    );

    const s = await ctx.call<DevSession>('GET', '/api/tasks/SGAR-7/session');
    expect(s).toMatchObject({ branch, reposConfirmed: true });
    expect(s.repos.map((r) => [r.name, r.currentBranch, r.dirty, r.commits, r.prUrl])).toEqual([
      ['checkout-web', branch, false, 2, 'https://github.com/acme/checkout-web/pull/42'],
      ['checkout-api', 'develop', true, null, null],
      ['legacy', null, false, null, null],
    ]);
    expect(s.repos[2]).toMatchObject({ localPath: null, pathOk: false });
  });

  it('al abrir opencode deja en TAREA.md los repos y sus fichas, y lanza la terminal en la carpeta de la tarea', async () => {
    ctx = await setup();
    const web = clone('checkout-web');
    const { id } = await ctx.addRepo('checkout-web', web.dir);
    await ctx.call('PATCH', `/api/repos/${id}`, { profile: { conventionsMd: '- TypeScript estricto', testCommandsMd: '- `pnpm test`', architectureMd: '' } });
    await ctx.addRepo('otro', clone('otro').dir, { jiraProjectKeys: [] });

    const res = await ctx.call<SessionOpenResult>('POST', '/api/tasks/SGAR-7/session/open');
    const folder = join(ctx.home, 'worktrees', 'SGAR-7');
    expect(res.opened).toBe(true);
    expect(ctx.launched).toEqual([{ folder, key: 'SGAR-7', prompt: 'Desarrolla la tarea SGAR-7 con la skill dev-assistant-tarea. Lee primero TAREA.md' }]);

    const context = readFileSync(join(folder, 'TAREA.md'), 'utf8');
    expect(context).toContain(`- **checkout-web**: \`${web.dir}\` · rama base \`develop\``);
    expect(context).toContain('#### Tests\n- `pnpm test`');
    expect(context).toContain('## Otros repositorios dados de alta\n\n- **otro**');
  });
});

describe('cabecera de PLAN.md', () => {
  it('lee la rama, los repos y las PR, e ignora lo que va después de la primera sección', () => {
    expect(parsePlanHeader('# K-1\n\n- **Rama:** `bugfix/K-1-x`\nRepos: a, b (C:\\dev\\b, base main)\nPR: https://github.com/o/a/pull/1 y https://github.com/o/b/pull/2\n\n## Análisis\nRepos: c')).toEqual({
      branch: 'bugfix/K-1-x',
      repos: ['a', 'b'],
      prUrls: ['https://github.com/o/a/pull/1', 'https://github.com/o/b/pull/2'],
    });
    expect(parsePlanHeader('')).toEqual({ branch: null, repos: [], prUrls: [] });
  });
});
