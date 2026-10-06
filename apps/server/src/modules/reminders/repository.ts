import { and, asc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';
import {
  ReminderInput,
  ReminderUpdate,
  type Reminder,
  type ReminderAlert,
  type Repeat,
  type SnoozeInput,
} from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { reminderFires, reminders, tasks } from '../../db/schema.js';
import { ensureTaskId } from '../tasks/ensure-task.js';
import { advancePast, firstOccurrence, repeatToRrule, rruleToRepeat, snoozeUntil } from './recurrence.js';

/** Retraso a partir del cual un aviso se marca como "atrasado". */
const LATE_AFTER_MS = 2 * 60_000;

type Row = typeof reminders.$inferSelect;

export interface FiredReminder {
  reminder: Reminder;
  late: boolean;
}

export class RemindersRepository {
  constructor(private readonly db: Db) {}

  /** Recordatorios activos (pendientes o pospuestos), por fecha. */
  list(): Reminder[] {
    return this.query(inArray(reminders.status, ['pending', 'snoozed']));
  }

  get(id: number): Reminder | undefined {
    return this.query(eq(reminders.id, id))[0];
  }

  create(input: ReminderInput): Reminder {
    const data = ReminderInput.parse(input);
    const dueAt = firstOccurrence(data.repeat, new Date(data.dueAt)).toISOString();
    const row = this.db
      .insert(reminders)
      .values({
        title: data.title,
        body: data.body ?? null,
        dueAt,
        rrule: repeatToRrule(data.repeat),
        nextFireAt: dueAt,
        taskId: data.taskKey ? ensureTaskId(this.db, data.taskKey) : null,
        commitJson: data.taskKey ? (data.commit ?? null) : null,
      })
      .returning({ id: reminders.id })
      .get();
    return this.get(row.id)!;
  }

  update(id: number, input: ReminderUpdate): Reminder | undefined {
    const data = ReminderUpdate.parse(input);
    const current = this.db.select().from(reminders).where(eq(reminders.id, id)).get();
    if (!current) return undefined;

    const set: Partial<Row> = {};
    if (data.title !== undefined) set.title = data.title;
    if (data.body !== undefined) set.body = data.body ?? null;
    if (data.taskKey !== undefined) set.taskId = data.taskKey ? ensureTaskId(this.db, data.taskKey) : null;
    // El commit es de la tarea: sin tarea no hay commit.
    if (data.commit !== undefined) set.commitJson = data.commit ?? null;
    if (data.taskKey === null) set.commitJson = null;
    if (data.dueAt !== undefined || data.repeat !== undefined) {
      // Cambiar cuándo avisa reprograma el recordatorio desde cero.
      const repeat = data.repeat ?? rruleToRepeat(current.rrule);
      const dueAt = firstOccurrence(repeat, new Date(data.dueAt ?? current.dueAt)).toISOString();
      Object.assign(set, { dueAt, rrule: repeatToRrule(repeat), nextFireAt: dueAt, snoozedUntil: null, status: 'pending' });
    }
    if (Object.keys(set).length) this.db.update(reminders).set(set).where(eq(reminders.id, id)).run();
    return this.get(id);
  }

  delete(id: number): boolean {
    return !!this.db.delete(reminders).where(eq(reminders.id, id)).returning({ id: reminders.id }).get();
  }

  /** Marcar como hecho: un puntual se cierra; en un recurrente solo se atiende el aviso (la serie sigue). */
  complete(id: number): Reminder | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    this.db.transaction((tx) => {
      if (current.repeat.kind === 'none') {
        tx.update(reminders).set({ status: 'done', nextFireAt: null, snoozedUntil: null }).where(eq(reminders.id, id)).run();
      }
      this.markAlertsSeen(tx, id);
    });
    return this.get(id);
  }

  snooze(id: number, option: SnoozeInput['until'], now = new Date()): Reminder | undefined {
    if (!this.get(id)) return undefined;
    const until = snoozeUntil(option, now).toISOString();
    this.db.transaction((tx) => {
      tx.update(reminders).set({ status: 'snoozed', snoozedUntil: until, nextFireAt: until }).where(eq(reminders.id, id)).run();
      this.markAlertsSeen(tx, id);
    });
    return this.get(id);
  }

  /** Avisos disparados que aún no has atendido, del más reciente al más antiguo. */
  alerts(): ReminderAlert[] {
    return this.db
      .select({ fire: reminderFires, title: reminders.title, rrule: reminders.rrule })
      .from(reminderFires)
      .innerJoin(reminders, eq(reminders.id, reminderFires.reminderId))
      .where(isNull(reminderFires.seenAt))
      .orderBy(asc(reminderFires.firedAt))
      .all()
      .map(({ fire, title, rrule }) => ({
        id: fire.id,
        reminderId: fire.reminderId,
        title,
        repeat: rruleToRepeat(rrule),
        firedAt: fire.firedAt,
        scheduledFor: fire.scheduledFor,
        late: !!fire.scheduledFor && Date.parse(fire.firedAt) - Date.parse(fire.scheduledFor) > LATE_AFTER_MS,
      }));
  }

  markAlertSeen(alertId: number): boolean {
    const res = this.db
      .update(reminderFires)
      .set({ seenAt: new Date().toISOString() })
      .where(eq(reminderFires.id, alertId))
      .returning({ id: reminderFires.id })
      .get();
    return !!res;
  }

  /**
   * Dispara los recordatorios vencidos. Un puntual queda pendiente (atrasado) hasta que lo marques
   * como hecho; un recurrente pasa a su siguiente repetición futura, sin acumular las que se perdieron
   * con el ordenador apagado.
   */
  fireDue(now = new Date()): FiredReminder[] {
    const nowIso = now.toISOString();
    const due = this.db
      .select()
      .from(reminders)
      .where(and(inArray(reminders.status, ['pending', 'snoozed']), lte(reminders.nextFireAt, nowIso)))
      .all();

    return due.map((row) => {
      const repeat = rruleToRepeat(row.rrule);
      const scheduledFor = row.nextFireAt!;
      this.db.transaction((tx) => {
        this.markAlertsSeen(tx, row.id); // un aviso nuevo sustituye al anterior sin atender
        tx.insert(reminderFires).values({ reminderId: row.id, firedAt: nowIso, scheduledFor, channel: 'app', ok: true }).run();
        const nextDue = repeat.kind === 'none' ? null : advancePast(repeat, new Date(row.dueAt), now).toISOString();
        tx.update(reminders)
          .set({ status: 'pending', snoozedUntil: null, dueAt: nextDue ?? row.dueAt, nextFireAt: nextDue })
          .where(eq(reminders.id, row.id))
          .run();
      });
      return { reminder: this.get(row.id)!, late: now.getTime() - Date.parse(scheduledFor) > LATE_AFTER_MS };
    });
  }

  private markAlertsSeen(tx: Pick<Db, 'update'>, reminderId: number) {
    tx.update(reminderFires)
      .set({ seenAt: new Date().toISOString() })
      .where(and(eq(reminderFires.reminderId, reminderId), isNull(reminderFires.seenAt)))
      .run();
  }

  private query(where: ReturnType<typeof eq>): Reminder[] {
    return this.db
      .select({ r: reminders, taskKey: tasks.jiraKey })
      .from(reminders)
      .leftJoin(tasks, eq(tasks.id, reminders.taskId))
      .where(and(where, ne(reminders.status, 'cancelled')))
      .orderBy(asc(reminders.dueAt), asc(reminders.id))
      .all()
      .map(({ r, taskKey }) => toReminder(r, taskKey));
  }
}

function toReminder(r: Row, taskKey: string | null): Reminder {
  const repeat: Repeat = rruleToRepeat(r.rrule);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    dueAt: r.dueAt,
    repeat,
    status: r.status,
    nextFireAt: r.nextFireAt,
    snoozedUntil: r.snoozedUntil,
    taskKey,
    commit: r.commitJson ?? null,
    createdAt: r.createdAt,
  };
}
