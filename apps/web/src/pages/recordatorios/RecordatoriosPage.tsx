import { useQuery } from '@tanstack/react-query';
import type { Reminder } from '@dev-assistant/shared';
import { AlarmClock, Clock, Plus, Repeat as RepeatIcon } from 'lucide-react';
import { useState } from 'react';
import { api, queryKeys } from '../../api';
import { SnoozeMenu } from '../../components/SnoozeMenu';
import { primaryButtonClass } from '../../components/fields';
import { daysAgo, hhmm, whenLabel } from '../../dates';
import { ReminderDialog } from './ReminderDialog';
import { repeatLabel } from './repeat';
import { useReminderActions } from './useReminderActions';

/** Un recordatorio ya ha vencido (o se pospuso) y espera que lo atiendas. */
export function isDue(r: Reminder, now = new Date()): boolean {
  return r.status === 'snoozed' || (r.repeat.kind === 'none' && Date.parse(r.dueAt) <= now.getTime());
}

/** "12:00 · Ahora", "Atrasado · Lun 4 · 12:00", "Pospuesto hasta 12:10" o la hora. */
export function dueLabel(r: Reminder, now = new Date()): { text: string; urgent: boolean } {
  if (r.status === 'snoozed' && r.snoozedUntil) return { text: `Pospuesto hasta ${whenLabel(r.snoozedUntil, now)}`, urgent: false };
  if (r.repeat.kind !== 'none') return { text: repeatLabel(r.repeat, r.dueAt), urgent: false };
  if (Date.parse(r.dueAt) <= now.getTime()) {
    return daysAgo(r.dueAt, now) > 0 ? { text: `Atrasado · ${whenLabel(r.dueAt, now)}`, urgent: true } : { text: `${hhmm(r.dueAt)} · Ahora`, urgent: true };
  }
  return { text: whenLabel(r.dueAt, now), urgent: false };
}

export function RecordatoriosPage() {
  const reminders = useQuery({ queryKey: queryKeys.reminderList, queryFn: api.listReminders, refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);

  const list = reminders.data ?? [];
  const oneOff = list.filter((r) => r.repeat.kind === 'none');
  const groups = [
    { id: 'hoy', title: 'Hoy', items: oneOff.filter((r) => daysAgo(r.dueAt) >= 0) },
    { id: 'semana', title: 'Esta semana', items: oneOff.filter((r) => daysAgo(r.dueAt) < 0 && daysAgo(r.dueAt) >= -6) },
    { id: 'despues', title: 'Más adelante', items: oneOff.filter((r) => daysAgo(r.dueAt) < -6) },
    { id: 'recurrentes', title: 'Recurrentes', items: list.filter((r) => r.repeat.kind !== 'none') },
  ].filter((g) => g.items.length);

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">Recordatorios</h1>
        <button type="button" onClick={() => setEditing('new')} className={primaryButtonClass}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          Nuevo recordatorio
        </button>
      </header>

      {reminders.isError ? (
        <p className="m-0 text-danger">No se pudieron cargar los recordatorios.</p>
      ) : reminders.isPending ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="m-0 text-ink-muted">No tienes recordatorios. Crea uno con "Nuevo recordatorio" o con Alt+N.</p>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`g-${g.id}`} className="flex flex-col gap-2">
            <h2 id={`g-${g.id}`} className="m-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase">
              {g.title}
            </h2>
            <ul className="rounded-lg border border-line bg-surface">
              {g.items.map((r) => (
                <ReminderRow key={r.id} reminder={r} onEdit={() => setEditing(r)} />
              ))}
            </ul>
          </section>
        ))
      )}

      {editing && <ReminderDialog reminder={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReminderRow({ reminder: r, onEdit }: { reminder: Reminder; onEdit: () => void }) {
  const { complete, snooze } = useReminderActions();
  const recurring = r.repeat.kind !== 'none';
  const label = dueLabel(r);
  const next = recurring && r.status !== 'snoozed' ? `Próximo: ${whenLabel(r.dueAt)}` : null;

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      {recurring ? (
        <RepeatIcon size={16} strokeWidth={1.5} className="text-ink-muted" aria-hidden />
      ) : (
        <input type="checkbox" aria-label={`Marcar como hecho: ${r.title}`} onChange={() => complete(r.id)} className="size-[18px] accent-accent" />
      )}
      <button type="button" onClick={onEdit} className="min-w-[200px] grow text-left text-ink hover:underline">
        {r.title}
        {r.taskKey && <code className="ml-2 font-mono text-code text-info">{r.taskKey}</code>}
      </button>
      <span className={`flex items-center gap-1 text-small ${label.urgent ? 'text-accent' : 'text-ink-muted'}`}>
        {label.urgent && <Clock size={14} strokeWidth={1.5} aria-hidden />}
        {r.status === 'snoozed' && <AlarmClock size={14} strokeWidth={1.5} aria-hidden />}
        {label.text}
      </span>
      {next && <span className="text-small text-ink-faint">{next}</span>}
      <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-small text-ink-muted">App</span>
      {isDue(r) && <SnoozeMenu onSnooze={(until) => snooze(r.id, until)} />}
    </li>
  );
}
