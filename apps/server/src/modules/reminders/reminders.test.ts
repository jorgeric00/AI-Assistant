import { afterEach, describe, expect, it } from 'vitest';
import type { Reminder, ReminderAlert } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { RemindersRepository } from './repository.js';
import { localDay } from '../journal/feed.js';

const local = (y: number, m: number, d: number, h = 9, min = 30) => new Date(y, m - 1, d, h, min);

async function setup() {
  const { db } = openDatabase(':memory:');
  const app = await buildApp(db);
  const repo = new RemindersRepository(db);
  const post = async (body: object) => {
    const res = await app.inject({ method: 'POST', url: '/api/reminders', payload: body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Reminder;
  };
  const alerts = async () => (await app.inject({ method: 'GET', url: '/api/reminder-alerts' })).json() as ReminderAlert[];
  return { app, repo, post, alerts };
}

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.app.close());

describe('recordatorios', () => {
  it('crea un puntual vinculado a una tarea y lo valida', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'Enviar estimación', dueAt: local(2026, 10, 5, 17).toISOString(), taskKey: 'abc-131' });
    expect(r).toMatchObject({ repeat: { kind: 'none' }, status: 'pending', taskKey: 'ABC-131', nextFireAt: r.dueAt });

    const bad = await ctx.app.inject({ method: 'POST', url: '/api/reminders', payload: { title: '', dueAt: 'mañana' } });
    expect(bad.statusCode).toBe(400);
    const noDays = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      payload: { title: 'x', dueAt: new Date().toISOString(), repeat: { kind: 'weekly', days: [] } },
    });
    expect(noDays.json().error).toContain('Elige al menos un día');
  });

  it('un recurrente de lunes a viernes creado en sábado empieza el lunes', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'Daily', dueAt: local(2026, 10, 10).toISOString(), repeat: { kind: 'weekdays' } });
    expect(new Date(r.dueAt)).toEqual(local(2026, 10, 12));
  });

  it('dispara un puntual y queda atrasado hasta marcarlo como hecho', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'Revisar PR', dueAt: local(2026, 10, 5, 12, 0).toISOString() });
    expect(ctx.repo.fireDue(local(2026, 10, 5, 11, 59))).toHaveLength(0);

    const fired = ctx.repo.fireDue(local(2026, 10, 5, 12, 0));
    expect(fired).toMatchObject([{ reminder: { id: r.id, nextFireAt: null, status: 'pending' }, late: false }]);
    expect(ctx.repo.fireDue(local(2026, 10, 5, 12, 1))).toHaveLength(0); // no se repite
    expect(await ctx.alerts()).toMatchObject([{ reminderId: r.id, title: 'Revisar PR', late: false }]);

    const done = await ctx.app.inject({ method: 'POST', url: `/api/reminders/${r.id}/done` });
    expect(done.json()).toMatchObject({ status: 'done' });
    // Queda apuntado en el diario del día en que se marca.
    const today = localDay(new Date());
    const journal = (await ctx.app.inject({ method: 'GET', url: `/api/journal?date=${today}` })).json() as { text: string; source: string }[];
    expect(journal).toMatchObject([{ text: 'Hecho: Revisar PR', source: 'auto' }]);
    expect(await ctx.alerts()).toEqual([]);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/reminders' })).json()).toEqual([]);
  });

  it('un recurrente avisa una vez aunque el ordenador estuviera apagado varios días', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'Daily', dueAt: local(2026, 10, 1).toISOString(), repeat: { kind: 'daily' } });
    const [fired] = ctx.repo.fireDue(local(2026, 10, 5, 12));
    expect(fired!.late).toBe(true);
    expect(new Date(fired!.reminder.dueAt)).toEqual(local(2026, 10, 6));
    expect(fired!.reminder.nextFireAt).toBe(fired!.reminder.dueAt);
    expect(await ctx.alerts()).toMatchObject([{ reminderId: r.id, late: true }]);

    // El aviso de mañana sustituye al de hoy si no lo atendiste.
    ctx.repo.fireDue(local(2026, 10, 6, 9, 30));
    expect(await ctx.alerts()).toHaveLength(1);
  });

  it('posponer vuelve a avisar y un recurrente sigue con su serie', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'Daily', dueAt: local(2026, 10, 5).toISOString(), repeat: { kind: 'daily' } });
    ctx.repo.fireDue(local(2026, 10, 5, 9, 30));
    const snoozed = ctx.repo.snooze(r.id, '10m', local(2026, 10, 5, 9, 31))!;
    expect(snoozed).toMatchObject({ status: 'snoozed' });
    expect(new Date(snoozed.nextFireAt!)).toEqual(local(2026, 10, 5, 9, 41));
    expect(await ctx.alerts()).toEqual([]);

    const [again] = ctx.repo.fireDue(local(2026, 10, 5, 9, 41));
    expect(again!.reminder).toMatchObject({ status: 'pending', snoozedUntil: null });
    expect(new Date(again!.reminder.nextFireAt!)).toEqual(local(2026, 10, 6));
  });

  it('editar la hora reprograma; borrar elimina', async () => {
    ctx = await setup();
    const r = await ctx.post({ title: 'A', dueAt: local(2026, 10, 5, 12).toISOString() });
    ctx.repo.fireDue(local(2026, 10, 5, 12, 30));
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/reminders/${r.id}`,
      payload: { title: 'B', dueAt: local(2026, 10, 6, 10).toISOString(), repeat: { kind: 'weekly', days: [2] } },
    });
    expect(res.json()).toMatchObject({ title: 'B', repeat: { kind: 'weekly', days: [2] }, status: 'pending' });
    expect(new Date((res.json() as Reminder).nextFireAt!)).toEqual(local(2026, 10, 6, 10));

    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/reminders/${r.id}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: `/api/reminders/${r.id}/done` })).statusCode).toBe(404);
  });
});

describe('diario', () => {
  it('añade, lista por día y borra entradas manuales', async () => {
    ctx = await setup();
    const add = (text: string, date = '2026-10-05') => ctx.app.inject({ method: 'POST', url: '/api/journal', payload: { date, text } });
    expect((await add('Reunión con QA')).statusCode).toBe(201);
    await add('Bloqueado: preproducción caída');
    await add('Otro día', '2026-10-04');
    expect((await add('  ')).statusCode).toBe(400);

    const list = (await ctx.app.inject({ method: 'GET', url: '/api/journal?date=2026-10-05' })).json();
    expect(list.map((e: { text: string }) => e.text)).toEqual(['Bloqueado: preproducción caída', 'Reunión con QA']);
    expect(list[0]).toMatchObject({ source: 'manual', date: '2026-10-05' });

    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/journal/${list[0].id}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/journal?date=2026-10-05' })).json()).toHaveLength(1);
  });
});
