import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalEntry } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { journalEntries, tasks as tasksTable } from '../../db/schema.js';
import { allocate, targetHours, tempoAttributes } from './worklog.js';
import type { JiraIssue } from '../../integrations/jira/client.js';
import { TasksRepository } from '../tasks/repository.js';

const issue = (status: string): JiraIssue => ({
  key: 'ABC-1',
  summary: 'Exportar pedidos',
  description: null,
  status,
  statusCategory: null,
  priority: null,
  issueType: 'Story',
  project: 'ABC',
  updated: null,
  url: 'https://jira.example.com/browse/ABC-1',
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'da-diario-'));
  const { db } = openDatabase(':memory:');
  const app = await buildApp(db, { devAssistantHome: home });
  const journal = async (date: string) => (await app.inject({ method: 'GET', url: `/api/journal?date=${date}` })).json<JournalEntry[]>();
  return { app, db, home, journal };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('diario automático', () => {
  it('apunta una vez cada commit de HISTORIAL.md, con su hora, su tarea y su enlace', async () => {
    ctx = await setup();
    const folder = join(ctx.home, 'worktrees', 'ABC-1');
    mkdirSync(folder, { recursive: true });
    const line1 = '- 2026-10-06 12:31 | orders-api | 4f2a9c1 | https://github.com/acme/orders-api/commit/4f2a9c1 | Tests del exportador CSV\n';
    writeFileSync(join(folder, 'HISTORIAL.md'), line1);

    const first = await ctx.journal('2026-10-06');
    expect(first).toEqual([
      expect.objectContaining({
        source: 'auto',
        origin: 'commit',
        text: 'Commit en orders-api: Tests del exportador CSV',
        taskKey: 'ABC-1',
        url: 'https://github.com/acme/orders-api/commit/4f2a9c1',
        createdAt: new Date('2026-10-06T12:31:00').toISOString(),
      }),
    ]);

    writeFileSync(join(folder, 'HISTORIAL.md'), `${line1}- 2026-10-07 09:05 | orders-api | 9e01ab2 | https://github.com/acme/orders-api/commit/9e01ab2 | Endpoint de exportación\n`);
    expect(await ctx.journal('2026-10-06')).toHaveLength(1);
    expect((await ctx.journal('2026-10-07')).map((e) => e.text)).toEqual(['Commit en orders-api: Endpoint de exportación']);
  });

  it('apunta el análisis validado de una incidencia', async () => {
    ctx = await setup();
    const folder = join(ctx.home, 'worktrees', 'ABC-1');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'HISTORIAL.md'), '- 2026-11-11 12:58 | análisis | - | - | Timeout de lectura corto en la tienda 0412\n');
    const entries = await ctx.journal('2026-11-11');
    expect(entries).toEqual([expect.objectContaining({ text: 'Análisis de ABC-1: Timeout de lectura corto en la tienda 0412', taskKey: 'ABC-1', url: null })]);
    expect(await ctx.journal('2026-11-11')).toHaveLength(1);
  });

  it('apunta los cambios de estado en JIRA, pero no la primera sincronización', async () => {
    ctx = await setup();
    const repo = new TasksRepository(ctx.db);
    const at = '2026-10-06T10:00:00.000Z';
    repo.upsertFromJira([issue('To Do')], at);
    repo.upsertFromJira([issue('To Do')], '2026-10-06T10:05:00.000Z');
    repo.upsertFromJira([issue('In Progress')], '2026-10-06T10:10:00.000Z');

    const day = new Date('2026-10-06T10:10:00.000Z');
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    expect(await ctx.journal(date)).toEqual([expect.objectContaining({ origin: 'jira', text: 'Estado en JIRA: To Do → In Progress', taskKey: 'ABC-1', url: null })]);
  });
});

describe('imputación de horas', () => {
  it('9 horas de lunes a jueves, 6 el viernes y los fines de semana fuera', () => {
    expect(['2026-11-09', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map(targetHours)).toEqual([9, 9, 6, 0, 0]);
  });

  it('reparte proporcional en medias horas, suma justo y nadie se queda a cero', () => {
    expect(allocate([1], 9)).toEqual([9]);
    expect(allocate([1, 1], 9)).toEqual([4.5, 4.5]);
    expect(allocate([3, 1, 1], 6)).toEqual([3.5, 1.5, 1]);
    for (const w of [[1, 1, 1], [5, 1], [7, 3, 2, 1]]) expect(allocate(w, 9).reduce((a, b) => a + b, 0)).toBe(9);
    expect(allocate([100, 1], 6).every((h) => h > 0)).toBe(true);
    expect(allocate([], 6)).toEqual([]);
  });

  it('Type of Work: incidencias, bugs y baus son Support; historias y tareas New Functionality; Order siempre Services', () => {
    expect(['Bug', 'Incidencia', 'Incident', 'BAU'].map((t) => tempoAttributes(t)['Type of Work'])).toEqual(['Support', 'Support', 'Support', 'Support']);
    expect(['Story', 'Historia', 'Task', 'Tarea', null].map((t) => tempoAttributes(t)['Type of Work'])).toEqual(Array(5).fill('New Functionality'));
    expect(tempoAttributes('Bug').Order).toBe('Services');
  });

  it('propone por día con la actividad del diario, marca los días sin actividad y no repite lo ya imputado', async () => {
    const { db } = openDatabase(':memory:');
    const logged: [string, string, number, Record<string, string>][] = [];
    const jira = { logWork: async (k: string, date: string, s: number, a: Record<string, string>) => void logged.push([k, date, s, a]) } as never;
    const app = await buildApp(db, { devAssistantHome: mkdtempSync(join(tmpdir(), 'da-wl-')), jiraClient: jira });
    const repo = new TasksRepository(db);
    repo.upsertFromJira([issue('In Progress'), { ...issue('To Do'), key: 'ABC-2', summary: 'Otra' }], '2026-11-09T08:00:00Z');
    const ids = db.select().from(tasksTable).all();
    const idOf = (k: string) => ids.find((t) => t.jiraKey === k)!.id;
    for (const [d, k] of [['2026-11-09', 'ABC-1'], ['2026-11-09', 'ABC-1'], ['2026-11-09', 'ABC-1'], ['2026-11-09', 'ABC-2'], ['2026-11-13', 'ABC-2']] as const) {
      db.insert(journalEntries).values({ date: d, source: 'manual', taskId: idOf(k), text: 'x' }).run();
    }
    const url = '/api/journal/worklog?from=2026-11-09&to=2026-11-15';
    const days = (await app.inject({ method: 'GET', url })).json<{ date: string; target: number; status: string; lines: { key: string; hours: number }[] }[]>();
    expect(days.map((d) => [d.date, d.target, d.status])).toEqual([
      ['2026-11-09', 9, 'pendiente'],
      ['2026-11-10', 9, 'sin_actividad'],
      ['2026-11-11', 9, 'sin_actividad'],
      ['2026-11-12', 9, 'sin_actividad'],
      ['2026-11-13', 6, 'pendiente'],
    ]);
    expect(days[0]!.lines.map((l) => [l.key, l.hours])).toEqual([['ABC-1', 7], ['ABC-2', 2]]);

    const send = (entries: unknown[]) => app.inject({ method: 'POST', url: '/api/journal/worklog', payload: { entries } });
    const r = (await send([{ date: '2026-11-09', key: 'ABC-1', hours: 7 }, { date: '2026-11-09', key: 'ABC-2', hours: 2 }])).json();
    expect(r).toEqual({ done: 2, failed: [] });
    const story = { 'Type of Work': 'New Functionality', Order: 'Services' };
    expect(logged).toEqual([['ABC-1', '2026-11-09', 25200, story], ['ABC-2', '2026-11-09', 7200, story]]);
    const again = (await send([{ date: '2026-11-09', key: 'ABC-1', hours: 7 }])).json<{ done: number; failed: unknown[] }>();
    expect([again.done, again.failed.length]).toEqual([0, 1]);
    expect((await app.inject({ method: 'GET', url })).json<{ status: string }[]>()[0]!.status).toBe('imputado');
  });
});
