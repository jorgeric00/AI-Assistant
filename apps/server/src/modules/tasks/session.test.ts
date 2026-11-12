import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevSession, RepoDetail, SessionOpenResult } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { parsePlanHeader } from './dev-files.js';
import type { JiraClient, JiraTicketExtras } from '../../integrations/jira/client.js';
import { openPrompt, taskAgents, taskContext } from './session.js';

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

async function setup(extra: Partial<Parameters<typeof buildApp>[1]> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'da-home-'));
  const launched: { folder: string; key: string; prompt: string }[] = [];
  const skills = join(home, 'skills');
  const app = await buildApp(openDatabase(':memory:').db, {
    devAssistantHome: home,
    opencodeSkillsDir: skills,
    terminalLauncher: async (folder, key, prompt) => {
      launched.push({ folder, key, prompt });
      return true;
    },
    ...extra,
  });
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => (await app.inject({ method, url, payload })).json<T>();
  const addRepo = (name: string, localPath: string, extra: object = {}) =>
    call<RepoDetail>('POST', '/api/repos', { name, localPath, defaultBranch: 'develop', jiraProjectKeys: ['SGAR'], ...extra });
  return { home, skills, app, call, addRepo, launched };
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
    await ctx.call('PATCH', `/api/repos/${id}`, { profile: { conventionsMd: '- TypeScript estricto', testCommandsMd: '- `pnpm test`', architectureMd: '', userNotesMd: 'Las configuraciones de lectores van en acme/reader-config' } });
    await ctx.addRepo('otro', clone('otro').dir, { jiraProjectKeys: [] });

    const res = await ctx.call<SessionOpenResult>('POST', '/api/tasks/SGAR-7/session/open');
    const folder = join(ctx.home, 'worktrees', 'SGAR-7');
    expect(res.opened).toBe(true);
    expect(ctx.launched).toEqual([{ folder, key: 'SGAR-7', prompt: `Desarrolla la tarea SGAR-7 con la skill dev-assistant-tarea, que está en ${join(ctx.skills, 'dev-assistant-tarea', 'SKILL.md')}. Lee primero TAREA.md` }]);
    // La skill se instala al empezar si falta, en la ruta que se le da a opencode.
    expect(readFileSync(join(ctx.skills, 'dev-assistant-tarea', 'SKILL.md'), 'utf8')).toContain('name: dev-assistant-tarea');

    const context = readFileSync(join(folder, 'TAREA.md'), 'utf8');
    expect(context).toContain(`- **checkout-web**: \`${web.dir}\` · rama base \`develop\``);
    expect(context).toContain('#### Tests\n- `pnpm test`');
    expect(context).toContain('#### Comentarios del usuario (repos relacionados, configuraciones, etc.)\nLas configuraciones de lectores van en acme/reader-config');
    expect(context).toContain('## Otros repositorios dados de alta\n\n- **otro**');
    expect(context).toContain('Idioma del usuario: castellano. Contéstale siempre en ese idioma.');

    // AGENTS.md: opencode sabe de qué tarea se trata aunque no se empiece con el mensaje de «Empezar la tarea».
    const agents = readFileSync(join(folder, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# Tarea de JIRA SGAR-7');
    expect(agents).toContain('lee TAREA.md');
    expect(agents).toContain(`skill dev-assistant-tarea, que está en ${join(ctx.skills, 'dev-assistant-tarea', 'SKILL.md')}`);
  });

  it('TAREA.md y AGENTS.md llevan el título y la descripción del ticket', () => {
    const task = { key: 'SGAR-7', summary: 'Validar email', description: 'Los clientes notifican altas con emails mal formados.', url: 'https://jira/browse/SGAR-7' } as never;
    const context = taskContext('SGAR-7', task, [], []);
    expect(context).toContain('# SGAR-7 · Validar email');
    expect(context).toContain('## Descripción del ticket\nLos clientes notifican altas con emails mal formados.');
    expect(taskAgents('SGAR-7', task, '/skills/x/SKILL.md')).toContain('# Tarea de JIRA SGAR-7 · Validar email');
    expect(taskContext('SGAR-7', null, [], [])).not.toContain('Descripción del ticket');
  });
});

describe('comentarios y adjuntos del ticket', () => {
  it('se bajan a la carpeta de la tarea y se listan en TAREA.md', async () => {
    const downloads: string[] = [];
    const extras: JiraTicketExtras = {
      comments: [
        { author: 'Ana', created: '2026-11-10T09:00:00.000+0100', body: 'Falla en la tienda 0412' },
        { author: 'Luis', created: '2026-11-10T10:30:00.000+0100', body: 'Adjunto el log' },
      ],
      attachments: [
        { id: '1', filename: 'server.log', size: 5, mimeType: 'text/plain', url: 'https://jira/att/1', created: '' },
        { id: '2', filename: '../raro?.txt', size: 2, mimeType: 'text/plain', url: 'https://jira/att/2', created: '' },
        { id: '3', filename: 'enorme.zip', size: 100 * 1024 * 1024, mimeType: 'application/zip', url: 'https://jira/att/3', created: '' },
      ],
    };
    const jira = {
      ticketExtras: async () => extras,
      downloadAttachment: async (url: string) => {
        downloads.push(url);
        return Buffer.from(url.endsWith('1') ? 'hola!' : 'ok');
      },
    } as unknown as JiraClient;
    ctx = await setup({ jiraClient: jira });

    await ctx.call('POST', '/api/tasks/SGAR-7/session/open');
    const folder = join(ctx.home, 'worktrees', 'SGAR-7');
    expect(readFileSync(join(folder, 'adjuntos', 'server.log'), 'utf8')).toBe('hola!');
    expect(readFileSync(join(folder, 'adjuntos', '__raro_.txt'), 'utf8')).toBe('ok');
    expect(downloads).toEqual(['https://jira/att/1', 'https://jira/att/2']);

    const context = readFileSync(join(folder, 'TAREA.md'), 'utf8');
    expect(context).toContain('## Comentarios del ticket\n\n### Ana · 2026-11-10 09:00\nFalla en la tienda 0412\n\n### Luis · 2026-11-10 10:30\nAdjunto el log');
    expect(context).toContain('- `adjuntos/server.log` (1 KB)');
    expect(context).toContain('- enorme.zip (100.0 MB): no descargado, es demasiado grande.');
  });

  it('si JIRA falla, TAREA.md lo dice y la sesión se abre igual', async () => {
    const jira = { ticketExtras: async () => Promise.reject(new Error('JIRA respondió 401')) } as unknown as JiraClient;
    ctx = await setup({ jiraClient: jira });
    const res = await ctx.call<SessionOpenResult>('POST', '/api/tasks/SGAR-7/session/open');
    expect(res.opened).toBe(true);
    expect(readFileSync(join(ctx.home, 'worktrees', 'SGAR-7', 'TAREA.md'), 'utf8')).toContain('No se pudieron leer de JIRA (JIRA respondió 401)');
  });

  it('el mensaje de empezar cambia si es un análisis', () => {
    expect(openPrompt('SGAR-7', '/s/SKILL.md', 'analysis')).toBe(
      'Analiza la incidencia SGAR-7 con la skill dev-assistant-tarea, que está en /s/SKILL.md, siguiendo su flujo de solo análisis. Lee primero TAREA.md',
    );
  });
});

describe('cabecera de PLAN.md', () => {
  it('lee la rama, los repos y las PR, e ignora lo que va después de la primera sección', () => {
    expect(parsePlanHeader('# K-1\n\n- **Rama:** `bugfix/K-1-x`\nRepos: a, b (C:\\dev\\b, base main)\nPR: https://github.com/o/a/pull/1 y https://github.com/o/b/pull/2\n\n## Análisis\nRepos: c')).toEqual({
      branch: 'bugfix/K-1-x',
      repos: ['a', 'b'],
      prUrls: ['https://github.com/o/a/pull/1', 'https://github.com/o/b/pull/2'],
      analysis: false,
    });
    expect(parsePlanHeader('')).toEqual({ branch: null, repos: [], prUrls: [], analysis: false });
    expect(parsePlanHeader('# K-1\n\nTipo: análisis\n').analysis).toBe(true);
  });
});
