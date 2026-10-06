import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalEntry } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
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
