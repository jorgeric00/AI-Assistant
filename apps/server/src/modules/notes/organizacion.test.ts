import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Note, Reminder, TaskDoc, TaskDocDetail } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';

const COMMIT = { repo: 'checkout-web', sha: 'a3f91c2', url: 'https://github.com/acme/checkout-web/commit/a3f91c2', text: 'Tests de validación del email' };

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'da-docs-'));
  const app = await buildApp(openDatabase(':memory:').db, { devAssistantHome: home });
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    return { status: res.statusCode, body: res.json() as T };
  };
  return { app, home, call };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('notas, enlaces y documentos', () => {
  it('filtra por tipo y por tener tarea', async () => {
    ctx = await setup();
    await ctx.call('POST', '/api/notes', { title: 'Nota suelta' });
    await ctx.call('POST', '/api/notes', { title: 'Nota de tarea', taskKeys: ['ABC-1'] });
    await ctx.call('POST', '/api/notes', { kind: 'link', title: 'MDN', url: 'https://developer.mozilla.org', tags: ['frontend'] });
    await ctx.call('POST', '/api/notes', { kind: 'doc', title: 'Arquitectura de checkout', bodyMd: '# Capas', tags: ['arquitectura'] });

    const titles = async (qs: string) => (await ctx.call<Note[]>('GET', `/api/notes?${qs}`)).body.map((n) => n.title).sort();
    expect(await titles('kind=note')).toEqual(['Nota de tarea', 'Nota suelta']);
    expect(await titles('kind=note&task=con')).toEqual(['Nota de tarea']);
    expect(await titles('kind=note&task=sin')).toEqual(['Nota suelta']);
    expect(await titles('kind=link')).toEqual(['MDN']);
    expect(await titles('kind=doc&q=capas')).toEqual(['Arquitectura de checkout']);
    expect((await ctx.call<{ name: string }[]>('GET', '/api/tags?kind=link')).body.map((t) => t.name)).toEqual(['frontend']);
  });

  it('una nota guarda el commit de su tarea y se puede quitar', async () => {
    ctx = await setup();
    const { body: note } = await ctx.call<Note>('POST', '/api/notes', { title: 'Fallo con tildes', taskKeys: ['ABC-1'], commit: COMMIT });
    expect(note.commit).toEqual(COMMIT);
    expect((await ctx.call<Note>('PATCH', `/api/notes/${note.id}`, { title: 'Fallo con tildes (resuelto)' })).body.commit).toEqual(COMMIT);
    expect((await ctx.call<Note>('PATCH', `/api/notes/${note.id}`, { commit: null })).body.commit).toBeNull();
  });

  it('un recordatorio guarda el commit solo si tiene tarea', async () => {
    ctx = await setup();
    const dueAt = '2030-01-01T09:00:00.000Z';
    const withTask = await ctx.call<Reminder>('POST', '/api/reminders', { title: 'Revisar la PR', dueAt, taskKey: 'ABC-1', commit: COMMIT });
    expect(withTask.body).toMatchObject({ taskKey: 'ABC-1', commit: COMMIT });
    const noTask = await ctx.call<Reminder>('POST', '/api/reminders', { title: 'Suelto', dueAt, commit: COMMIT });
    expect(noTask.body.commit).toBeNull();
    expect((await ctx.call<Reminder>('PATCH', `/api/reminders/${withTask.body.id}`, { taskKey: null })).body).toMatchObject({ taskKey: null, commit: null });
  });
});

describe('documentación de tareas', () => {
  it('lista los RESUMEN.md de las tareas, busca en ellos y devuelve uno', async () => {
    ctx = await setup();
    const write = (key: string, text: string) => {
      mkdirSync(join(ctx.home, 'worktrees', key), { recursive: true });
      writeFileSync(join(ctx.home, 'worktrees', key, 'RESUMEN.md'), text);
    };
    write(
      'SGAR-1024',
      '# SGAR-1024 · Revisión de vulnerabilidades\n\nFecha: 2026-10-06 · Rama: feature/SGAR-1024-security · Repos: checkout-web, `checkout-api`\n\n## PR y commits\n- https://github.com/acme/checkout-web/pull/42\n- https://github.com/acme/checkout-api/pull/17\n',
    );
    write('ABC-1', '# ABC-1 · Validar email\n\n## Qué se hizo\n- Validación con tildes\n');
    mkdirSync(join(ctx.home, 'worktrees', 'ABC-2'), { recursive: true }); // tarea sin resumen todavía

    const all = (await ctx.call<TaskDoc[]>('GET', '/api/task-docs')).body;
    expect(all.map((d) => d.key).sort()).toEqual(['ABC-1', 'SGAR-1024']);
    expect(all.find((d) => d.key === 'SGAR-1024')).toMatchObject({ title: 'Revisión de vulnerabilidades', repos: ['checkout-web', 'checkout-api'], prCount: 2 });
    expect((await ctx.call<TaskDoc[]>('GET', '/api/task-docs?q=tilde')).body.map((d) => d.key)).toEqual(['ABC-1']);

    const doc = await ctx.call<TaskDocDetail>('GET', '/api/task-docs/abc-1');
    expect(doc.body).toMatchObject({ key: 'ABC-1', title: 'Validar email' });
    expect(doc.body.markdown).toContain('Validación con tildes');
    expect((await ctx.call('GET', '/api/task-docs/ABC-2')).status).toBe(404);
  });
});
