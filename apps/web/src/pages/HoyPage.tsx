import { useQuery } from '@tanstack/react-query';
import { Clock, Sparkles } from 'lucide-react';
import { api, queryKeys } from '../api';
import { Card, EmptyState } from '../components/Card';
import { capitalize, daysAgo, hhmm, localDate } from '../dates';
import { JournalAddForm } from './diario/JournalAddForm';
import { useJournal } from './diario/useJournal';
import { dueLabel, isDue } from './recordatorios/RecordatoriosPage';

const dateFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

export function HoyPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-display font-semibold">Hoy</h1>
          <p className="mt-1 mb-0 text-ink-muted">{capitalize(dateFormatter.format(new Date()))}</p>
        </div>
        <a
          href="#/diario/resumen"
          className="flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-4 font-medium text-ink no-underline hover:border-accent"
        >
          <Sparkles size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
          Resumen para la daily
        </a>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
        <Card title="Recordatorios de hoy" action={<a href="#/recordatorios" className="text-small text-info">Ver todos</a>}>
          <TodayReminders />
        </Card>
        <Card title="Tareas en curso" action={<a href="#/tareas" className="text-small text-info">Ver tareas</a>}>
          <EmptyState>Conecta JIRA para ver tus tareas.</EmptyState>
        </Card>
        <Card title="Avisos de tus PR">
          <EmptyState>Sin avisos. Aquí verás CI en rojo y comentarios nuevos.</EmptyState>
        </Card>
        <Card title="Diario de hoy" action={<a href="#/diario" className="text-small text-info">Ver diario</a>}>
          <TodayJournal />
        </Card>
      </div>
    </div>
  );
}

/** Recordatorios que tocan hoy (y los atrasados sin atender). */
function TodayReminders() {
  const reminders = useQuery({ queryKey: queryKeys.reminderList, queryFn: api.listReminders, refetchInterval: 30_000 });
  const today = (reminders.data ?? []).filter((r) => daysAgo(r.dueAt) >= 0 || (r.status === 'snoozed' && r.snoozedUntil && daysAgo(r.snoozedUntil) === 0));
  if (!today.length) return <EmptyState>No tienes recordatorios para hoy.</EmptyState>;
  return (
    <ul className="flex flex-col">
      {today.map((r) => {
        const due = isDue(r);
        const label = dueLabel(r);
        return (
          <li key={r.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
            <span className={`w-11 shrink-0 font-mono text-code ${due ? 'text-accent' : 'text-ink-faint'}`}>{hhmm(r.dueAt)}</span>
            <a href="#/recordatorios" className="min-w-0 grow text-ink no-underline hover:underline">
              {r.title}
              {r.taskKey && <code className="ml-2 font-mono text-code text-info">{r.taskKey}</code>}
            </a>
            {due && (
              <span className={`flex shrink-0 items-center gap-1 text-small ${label.urgent ? 'text-accent' : 'text-ink-muted'}`}>
                {label.urgent && <Clock size={14} strokeWidth={1.5} aria-hidden />}
                {label.urgent ? (label.text.startsWith('Atrasado') ? 'Atrasado' : 'Ahora') : label.text}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TodayJournal() {
  const { entries, add } = useJournal(localDate());
  return (
    <>
      {entries.data?.length ? (
        <ul className="flex flex-col">
          {entries.data.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-line py-2 last:border-b-0">
              <span className="w-11 shrink-0 font-mono text-code text-ink-faint">{hhmm(e.createdAt)}</span>
              <span className="min-w-0 grow break-words">{e.text}</span>
              <span className="shrink-0 text-small text-ink-faint">{e.source === 'auto' ? 'Auto' : 'Manual'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Aún no hay entradas hoy.</EmptyState>
      )}
      <JournalAddForm onAdd={(t) => add.mutateAsync(t)} pending={add.isPending} placeholder="Añadir una entrada al diario" />
    </>
  );
}
