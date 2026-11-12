import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AskResponse, DailySummary } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { tasks } from '../../db/schema.js';
import { LlmUnavailableError, type Llm, type LlmRequest } from '../../integrations/opencode/llm.js';
import { toRelatedFtsQuery } from '../notes/repository.js';
import { previousWorkday } from './daily-summary.js';

/** Modelo falso: guarda lo que recibe y responde lo que le digamos. */
function fakeLlm(reply: string | ((req: LlmRequest) => string)) {
  const calls: LlmRequest[] = [];
  const llm: Llm = {
    complete: async (req) => {
      calls.push(req);
      return typeof reply === 'string' ? reply : reply(req);
    },
  };
  return { llm, calls };
}

async function setup(llm?: Llm) {
  const { db } = openDatabase(':memory:');
  const app = await buildApp(db, { llm });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  return { app, post };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('previousWorkday', () => {
  it('salta el fin de semana', () => {
    expect(previousWorkday('2026-10-12')).toBe('2026-10-09'); // lunes → viernes
    expect(previousWorkday('2026-10-07')).toBe('2026-10-06');
    expect(previousWorkday('2026-10-11')).toBe('2026-10-09'); // domingo → viernes
  });
});

describe('resumen para la daily', () => {
  it('resume desde el viernes, incluye los recordatorios del día y guarda el resultado', async () => {
    const { llm, calls } = fakeLlm('## Ayer\n- Terminé el login\n## Hoy\n- Revisar PR\n## Bloqueos\n- Nada');
    ctx = await setup(llm);
    await ctx.post('/api/journal', { date: '2026-10-08', text: 'Esto es del jueves' });
    await ctx.post('/api/journal', { date: '2026-10-09', text: 'Terminé el login' });
    await ctx.post('/api/journal', { date: '2026-10-12', text: 'Empiezo con la revisión' });
    await ctx.post('/api/reminders', { title: 'Revisar PR de Ana', dueAt: new Date(2026, 9, 12, 11, 0).toISOString() });
    await ctx.post('/api/reminders', { title: 'Otro día', dueAt: new Date(2026, 9, 13, 11, 0).toISOString() });

    expect((await ctx.app.inject({ method: 'GET', url: '/api/daily-summary?date=2026-10-12' })).json()).toBeNull();

    const res = await ctx.post('/api/daily-summary', { date: '2026-10-12' });
    expect(res.statusCode, res.body).toBe(201);
    const summary = res.json() as DailySummary;
    expect(summary).toMatchObject({ date: '2026-10-12', since: '2026-10-09', contentMd: expect.stringContaining('## Ayer') });

    const prompt = calls[0]!.user;
    expect(prompt).toContain('- (a mano) Terminé el login');
    expect(calls[0]!.system).toContain('va en su propia viñeta');
    expect(prompt).toContain('Empiezo con la revisión');
    expect(prompt).toContain('11:00 Revisar PR de Ana');
    expect(prompt).not.toContain('jueves');
    expect(prompt).not.toContain('Otro día');

    const latest = (await ctx.app.inject({ method: 'GET', url: '/api/daily-summary?date=2026-10-12' })).json() as DailySummary;
    expect(latest.id).toBe(summary.id);
  });

  it('sin nada que resumir avisa y no llama a la IA', async () => {
    const { llm, calls } = fakeLlm('x');
    ctx = await setup(llm);
    const res = await ctx.post('/api/daily-summary', { date: '2026-10-12' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('No hay entradas');
    expect(calls).toHaveLength(0);
  });

  it('si opencode no está disponible responde 503 con el motivo', async () => {
    ctx = await setup({
      complete: async () => {
        throw new LlmUnavailableError('No se pudo arrancar opencode.');
      },
    });
    await ctx.post('/api/journal', { date: '2026-10-09', text: 'Algo' });
    const res = await ctx.post('/api/daily-summary', { date: '2026-10-12' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'No se pudo arrancar opencode.' });
  });
});

describe('Pregunta sobre todo', () => {
  it('construye la consulta con OR y sin palabras vacías', () => {
    expect(toRelatedFtsQuery('¿Dónde apunté el comando para desplegar en pre?')).toBe('"coman"* OR "desple"* OR "pre"*');
    expect(toRelatedFtsQuery('¿qué?')).toBeNull();
  });

  it('pasa las notas relacionadas al modelo y enlaza las citas', async () => {
    // Cita la nota "Comandos útiles" con el número que le haya tocado en el prompt.
    const { llm, calls } = fakeLlm((req) => `Se despliega con \`make deploy-pre\` [${/\[(\d+)\] Nota: Comandos útiles/.exec(req.user)![1]}].`);
    ctx = await setup(llm);
    const create = async (payload: object) => (await ctx.post('/api/notes', payload)).json() as { id: number };
    await create({ title: 'Comida con el equipo', bodyMd: 'El jueves' });
    const a = await create({ title: 'Despliegue a producción', bodyMd: 'Pedir ventana', tags: ['deploy'] });
    const b = await create({ title: 'Comandos útiles', bodyMd: 'Para desplegar en pre: make deploy-pre' });
    await create({ title: 'Despliegue viejo', bodyMd: 'desplegar a mano', archived: true });

    const res = await ctx.post('/api/search/ask', { question: '¿Cómo se despliega en pre?' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as AskResponse;

    expect(calls[0]!.user).toContain('Pregunta: ¿Cómo se despliega en pre?');
    expect(calls[0]!.user).not.toContain('Comida');
    expect(calls[0]!.user).not.toContain('Despliegue viejo');
    const refB = body.sources.find((s) => s.href === `#/notas/${b.id}`)!.ref;
    expect(body.answer).toBe(`Se despliega con \`make deploy-pre\` [[${refB}]](#/notas/${b.id}).`);
    expect(body.sources[0]).toMatchObject({ href: `#/notas/${b.id}`, type: 'notes', title: 'Comandos útiles', cited: true });
    expect(body.sources.map((s) => s.href).sort()).toEqual([`#/notas/${a.id}`, `#/notas/${b.id}`].sort());
  });

  it('sin notas relacionadas responde sin llamar a la IA', async () => {
    const { llm, calls } = fakeLlm('x');
    ctx = await setup(llm);
    await ctx.post('/api/notes', { title: 'Comida con el equipo' });
    const res = await ctx.post('/api/search/ask', { question: '¿Cuál es la contraseña de la VPN?' });
    expect(res.json()).toEqual({ answer: 'No he encontrado nada en la app relacionado con la pregunta.', sources: [] });
    expect(calls).toHaveLength(0);
  });

  it('busca también en enlaces, documentación, tareas de JIRA y diario, y respeta los filtros', async () => {
    const { db } = openDatabase(':memory:');
    const home = mkdtempSync(join(tmpdir(), 'dev-assistant-'));
    mkdirSync(join(home, 'worktrees', 'ABC-131'), { recursive: true });
    writeFileSync(join(home, 'worktrees', 'ABC-131', 'RESUMEN.md'), '# ABC-131 · Exportar pedidos\n\nEl CSV usa punto y coma como separador.');
    db.insert(tasks).values({ jiraKey: 'ABC-131', summary: 'Exportar informe de pedidos a CSV', status: 'En curso', descriptionMd: 'Columnas id, fecha, importe' }).run();
    db.insert(tasks).values({ jiraKey: 'ABC-200', summary: 'Login único', status: 'Por hacer' }).run();
    const { llm, calls } = fakeLlm('Se usa punto y coma [2].');
    const app = await buildApp(db, { llm, devAssistantHome: home });
    ctx = { app, post: (url: string, payload: object) => app.inject({ method: 'POST', url, payload }) };
    await ctx.post('/api/notes', { kind: 'link', title: 'RFC 4180 formato CSV', url: 'https://www.rfc-editor.org/rfc/rfc4180' });
    await ctx.post('/api/journal', { date: '2026-10-03', text: 'Reunión con negocio: el separador decimal del CSV sigue pendiente' });
    await ctx.post('/api/journal', { date: '2026-10-04', text: 'Comida de equipo' });

    const all = (await ctx.post('/api/search/ask', { question: '¿Qué separador usa el CSV?' })).json() as AskResponse;
    expect(all.sources.map((s) => s.type).sort()).toEqual(['diary', 'docs', 'links', 'tasks']);
    expect(all.sources.find((s) => s.type === 'tasks')).toMatchObject({ title: 'ABC-131 Exportar informe de pedidos a CSV', href: '#/tareas/ABC-131/detalle' });
    expect(all.sources.find((s) => s.type === 'diary')).toMatchObject({ href: '#/diario/2026-10-03', date: '2026-10-03' });
    expect(all.sources.find((s) => s.type === 'docs')).toMatchObject({ href: '#/documentacion/tareas/ABC-131' });
    expect(all.sources[0]!.cited).toBe(true);
    expect(calls[0]!.user).not.toContain('Comida');
    expect(calls[0]!.user).not.toContain('Login');

    const onlyDiary = (await ctx.post('/api/search/ask', { question: '¿Qué separador usa el CSV?', sources: ['diary'] })).json() as AskResponse;
    expect(onlyDiary.sources.map((s) => s.type)).toEqual(['diary']);
    expect((await ctx.post('/api/search/ask', { question: '¿Qué separador usa el CSV?', sources: [] })).statusCode).toBe(400);
  });
});

describe('Mejorar con IA', () => {
  it('redacta el texto sin enviarle más que el texto y quita el bloque de código que lo envuelva', async () => {
    const { llm, calls } = fakeLlm('```markdown\n## Desplegar\n\n1. Merge a `release`.\n```');
    ctx = await setup(llm);
    const res = await ctx.post('/api/ai/rewrite', { text: '  para desplegar hacer merge a release  ' });
    expect(res.json()).toEqual({ text: '## Desplegar\n\n1. Merge a `release`.' });
    expect(calls[0]!.user).toBe('para desplegar hacer merge a release');
    expect(calls[0]!.system).toContain('SOLO con el texto ya redactado');
  });

  it('con el texto vacío no llama a la IA', async () => {
    const { llm, calls } = fakeLlm('x');
    ctx = await setup(llm);
    expect((await ctx.post('/api/ai/rewrite', { text: '   ' })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
