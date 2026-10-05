import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { openDatabase } from './db/client.js';

describe('app', () => {
  it('responde al health check y aplica migraciones', async () => {
    const { db, sqlite } = openDatabase(':memory:');
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', version: '0.1.0', db: 'ok' });

    const tables = sqlite
      .prepare("select name from sqlite_master where type in ('table') order by name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['notes', 'notes_fts', 'reminders', 'tasks', 'pending_actions', 'changelog']));
    await app.close();
  });

  it('el índice FTS se mantiene sincronizado con las notas', async () => {
    const { sqlite } = openDatabase(':memory:');
    sqlite.prepare("insert into notes (title, body_md) values ('Despliegue', 'Pasos para desplegar en preproducción')").run();
    const hits = sqlite.prepare("select rowid from notes_fts where notes_fts match 'desplegar'").all();
    expect(hits).toHaveLength(1);
    sqlite.prepare("update notes set body_md = 'otra cosa' where id = 1").run();
    expect(sqlite.prepare("select rowid from notes_fts where notes_fts match 'desplegar'").all()).toHaveLength(0);
  });
});
