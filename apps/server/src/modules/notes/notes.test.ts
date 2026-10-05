import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { extractTitle } from './link-title.js';
import { toFtsQuery } from './repository.js';

async function setup() {
  const { db, sqlite } = openDatabase(':memory:');
  const app = await buildApp(db, { fetchTitle: async (url) => (url.includes('mdn') ? 'Validación de formularios - MDN' : null) });
  const post = async (body: object) => {
    const res = await app.inject({ method: 'POST', url: '/api/notes', payload: body });
    expect(res.statusCode).toBe(201);
    return res.json() as Note;
  };
  const list = async (qs = '') => (await app.inject({ method: 'GET', url: `/api/notes${qs}` })).json() as Note[];
  return { app, sqlite, post, list };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('notas', () => {
  it('crea una nota con etiquetas normalizadas y la devuelve completa', async () => {
    ctx = await setup();
    const note = await ctx.post({ title: 'Desplegar', bodyMd: 'Pasos', tags: ['Despliegue', 'backend', 'despliegue'] });
    expect(note).toMatchObject({ id: 1, kind: 'note', title: 'Desplegar', pinned: false, archived: false, tags: ['backend', 'despliegue'] });
    const got = await ctx.app.inject({ method: 'GET', url: '/api/notes/1' });
    expect(got.json()).toEqual(note);
  });

  it('vincula claves de JIRA aunque la tarea aún no esté sincronizada', async () => {
    ctx = await setup();
    const note = await ctx.post({ title: 'Validar email', taskKeys: ['abc-123'] });
    expect(note.tasks).toEqual([{ key: 'ABC-123', summary: 'ABC-123', synced: false }]);

    // Cuando la sincronización de JIRA rellena la tarea, el vínculo pasa a sincronizado.
    ctx.sqlite.prepare("update tasks set summary = 'Validar email en el alta', status = 'En curso' where jira_key = 'ABC-123'").run();
    const again = (await ctx.app.inject({ method: 'GET', url: `/api/notes/${note.id}` })).json() as Note;
    expect(again.tasks).toEqual([{ key: 'ABC-123', summary: 'Validar email en el alta', synced: true }]);
  });

  it('rechaza datos no válidos con 400', async () => {
    ctx = await setup();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/notes', payload: { title: ' ', taskKeys: ['no-es-clave'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('El título es obligatorio');
  });

  it('actualiza solo los campos enviados y limpia etiquetas sin uso', async () => {
    ctx = await setup();
    const note = await ctx.post({ title: 'A', bodyMd: 'cuerpo', tags: ['x'], pinned: true });
    const res = await ctx.app.inject({ method: 'PATCH', url: `/api/notes/${note.id}`, payload: { title: 'B', tags: ['y'] } });
    const updated = res.json() as Note;
    expect(updated).toMatchObject({ title: 'B', bodyMd: 'cuerpo', pinned: true, tags: ['y'] });
    expect(updated.updatedAt >= note.updatedAt).toBe(true);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tags' })).json()).toEqual([{ name: 'y', count: 1 }]);
  });

  it('lista fijadas primero, oculta archivadas y filtra por etiqueta', async () => {
    ctx = await setup();
    await ctx.post({ title: 'Vieja', tags: ['testing'] });
    await ctx.post({ title: 'Fijada', pinned: true });
    await ctx.post({ title: 'Archivada', archived: true, tags: ['testing'] });
    await ctx.post({ title: 'Nueva', tags: ['testing'] });

    expect((await ctx.list()).map((n) => n.title)).toEqual(['Fijada', 'Nueva', 'Vieja']);
    expect((await ctx.list('?archived=true')).map((n) => n.title)).toEqual(['Archivada']);
    expect((await ctx.list('?tag=Testing')).map((n) => n.title)).toEqual(['Nueva', 'Vieja']);
  });

  it('busca por texto sin distinguir acentos y por prefijo', async () => {
    ctx = await setup();
    await ctx.post({ title: 'Desplegar checkout-web en preproducción', bodyMd: 'Lanzar el pipeline' });
    await ctx.post({ kind: 'link', title: 'Guía de validación', url: 'https://developer.mozilla.org/es/docs/forms' });
    await ctx.post({ title: 'Tests de integración', bodyMd: 'Levantar Docker' });

    expect((await ctx.list('?q=preproduccion')).map((n) => n.title)).toEqual(['Desplegar checkout-web en preproducción']);
    expect((await ctx.list('?q=valid')).map((n) => n.title)).toEqual(['Guía de validación']);
    expect((await ctx.list('?q=mozilla')).map((n) => n.kind)).toEqual(['link']);
    expect((await ctx.list('?q=docker integracion')).map((n) => n.title)).toEqual(['Tests de integración']);
    expect(await ctx.list('?q="(*')).toEqual([]);
  });

  it('borra una nota', async () => {
    ctx = await setup();
    const note = await ctx.post({ title: 'Temporal', tags: ['tmp'] });
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/notes/${note.id}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/notes/${note.id}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tags' })).json()).toEqual([]);
  });

  it('obtiene el título de un enlace', async () => {
    ctx = await setup();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/link-title?url=https://developer.mozilla.org/mdn' });
    expect(res.json()).toEqual({ title: 'Validación de formularios - MDN' });
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/link-title?url=file:///etc/passwd' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('utilidades', () => {
  it('construye consultas FTS seguras', () => {
    expect(toFtsQuery('desp "web" OR x')).toBe('"desp"* "web"* "OR"* "x"*');
    expect(toFtsQuery('  ¿?  ')).toBeNull();
  });

  it('extrae el título de una página', () => {
    expect(extractTitle('<html><head><title>\n Hola &amp; adiós </title></head>')).toBe('Hola & adiós');
    expect(extractTitle('<meta property="og:title" content="Título OG"><title>Otro</title>')).toBe('Título OG');
    expect(extractTitle('<html></html>')).toBeNull();
  });
});
