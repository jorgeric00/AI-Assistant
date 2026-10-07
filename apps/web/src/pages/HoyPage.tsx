import { useQuery } from '@tanstack/react-query';
import { Clock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { Card, EmptyState } from '../components/Card';
import { capitalize, daysAgo, hhmm, localDate } from '../dates';
import { JournalAddForm } from './diario/JournalAddForm';
import { PrAlertsList } from './prs/PrWidgets';
import { useJournal } from './diario/useJournal';
import { useJiraSync, useTaskList } from './tareas/useTasks';
import { dueLabel, isDue } from './recordatorios/RecordatoriosPage';
import { locale } from '../i18n';

export function HoyPage() {
  const { t } = useTranslation('hoy');
  const dateFormatter = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-display font-semibold">{t('title')}</h1>
          <p className="mt-1 mb-0 text-ink-muted">{capitalize(dateFormatter.format(new Date()))}</p>
        </div>
        <a
          href="#/diario/resumen"
          className="flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-4 font-medium text-ink no-underline hover:border-accent"
        >
          <Sparkles size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
          {t('dailySummary')}
        </a>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
        <Card title={t('cards.reminders')} action={<a href="#/recordatorios" className="text-small text-info">{t('cards.seeAll')}</a>}>
          <TodayReminders />
        </Card>
        <Card title={t('cards.tasks')} action={<a href="#/tareas" className="text-small text-info">{t('cards.seeTasks')}</a>}>
          <TasksInProgress />
        </Card>
        <Card title={t('cards.prAlerts')}>
          <PrAlertsList />
        </Card>
        <Card title={t('cards.journal')} action={<a href="#/diario" className="text-small text-info">{t('cards.seeJournal')}</a>}>
          <TodayJournal />
        </Card>
      </div>
    </div>
  );
}

/** Recordatorios que tocan hoy (y los atrasados sin atender). */
function TodayReminders() {
  const { t } = useTranslation('hoy');
  const reminders = useQuery({ queryKey: queryKeys.reminderList, queryFn: api.listReminders, refetchInterval: 30_000 });
  const today = (reminders.data ?? []).filter((r) => daysAgo(r.dueAt) >= 0 || (r.status === 'snoozed' && r.snoozedUntil && daysAgo(r.snoozedUntil) === 0));
  if (!today.length) return <EmptyState>{t('reminders.empty')}</EmptyState>;
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
                {label.urgent ? (label.overdue ? t('reminders.overdue') : t('reminders.now')) : label.text}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Tareas de JIRA en curso (categoría de estado "en curso"). */
function TasksInProgress() {
  const { t } = useTranslation('hoy');
  const { status } = useJiraSync();
  const tasks = useTaskList(false);
  if (status.data?.configured === false) return <EmptyState>{t('tasks.connectJira')}</EmptyState>;
  const inProgress = (tasks.data ?? []).filter((task) => task.statusCategory === 'indeterminate').slice(0, 6);
  if (!inProgress.length) return <EmptyState>{t('tasks.empty')}</EmptyState>;
  return (
    <ul className="flex flex-col">
      {inProgress.map((task) => (
        <li key={task.key} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
          <a href={`#/tareas/${task.key}`} className="shrink-0 font-mono text-code text-info">
            {task.key}
          </a>
          <span className="min-w-0 grow truncate">{task.summary}</span>
          <span className="shrink-0 text-small text-ink-muted">{task.status}</span>
        </li>
      ))}
    </ul>
  );
}

function TodayJournal() {
  const { t } = useTranslation('hoy');
  const { entries, add } = useJournal(localDate());
  return (
    <>
      {entries.data?.length ? (
        <ul className="flex flex-col">
          {entries.data.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-line py-2 last:border-b-0">
              <span className="w-11 shrink-0 font-mono text-code text-ink-faint">{hhmm(e.createdAt)}</span>
              <span className="min-w-0 grow break-words">{e.text}</span>
              <span className="shrink-0 text-small text-ink-faint">{e.source === 'auto' ? t('journal.auto') : t('journal.manual')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>{t('journal.empty')}</EmptyState>
      )}
      <JournalAddForm onAdd={(text) => add.mutateAsync(text)} pending={add.isPending} placeholder={t('journal.addPlaceholder')} />
    </>
  );
}
