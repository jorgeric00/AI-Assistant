import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommitRef, Reminder, Repeat } from '@dev-assistant/shared';
import { Bell, CircleAlert } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { TASK_KEY_RE, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { CommitSelect, TaskOptions } from '../../components/TaskFields';
import { localDate, parseLocalDate } from '../../dates';
import { repeatSummary, weekdays } from './repeat';

type RepeatKind = Repeat['kind'];

const REPEAT_OPTIONS: RepeatKind[] = ['none', 'daily', 'weekdays', 'weekly'];

function defaultStart(): Date {
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
}

function isoWeekday(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

interface Props {
  reminder?: Reminder;
  onSaved: (reminder: Reminder) => void;
  onCancel: () => void;
  /** Muestra "Eliminar" al editar. */
  onDeleted?: () => void;
}

/** Formulario de recordatorio (diseño: "Nuevo recordatorio"). Lo usan el diálogo y la captura rápida. */
export function ReminderForm({ reminder, onSaved, onCancel, onDeleted }: Props) {
  const { t } = useTranslation(['reminders', 'common']);
  const queryClient = useQueryClient();
  const ids = useId();
  const start = reminder ? new Date(reminder.dueAt) : defaultStart();

  const [title, setTitle] = useState(reminder?.title ?? '');
  const [date, setDate] = useState(localDate(start));
  const [time, setTime] = useState(start.toTimeString().slice(0, 5));
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(reminder?.repeat.kind ?? 'none');
  const [days, setDays] = useState<number[]>(reminder?.repeat.kind === 'weekly' ? reminder.repeat.days : [isoWeekday(start)]);
  const [taskKey, setTaskKey] = useState(reminder?.taskKey ?? '');
  // El commit se elige para una tarea concreta: si cambia la tarea, deja de valer.
  const [commitPick, setCommitPick] = useState<{ task: string | null; commit: CommitRef | null }>({ task: reminder?.taskKey ?? null, commit: reminder?.commit ?? null });
  const task = taskKey.trim() ? taskKey.trim().toUpperCase() : null;
  const commit = task && commitPick.task === task ? commitPick.commit : null;
  const [error, setError] = useState<string | null>(null);

  const repeat: Repeat = repeatKind === 'weekly' ? { kind: 'weekly', days } : { kind: repeatKind };
  const startAt = (() => {
    const d = parseLocalDate(date);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d;
  })();
  const validStart = !Number.isNaN(startAt.getTime()) && !!date && !!time;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
  const save = useMutation({
    mutationFn: () => {
      const input = { title: title.trim(), dueAt: startAt.toISOString(), repeat, taskKey: task, commit };
      return reminder ? api.updateReminder(reminder.id, input) : api.createReminder(input);
    },
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved);
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteReminder(reminder!.id),
    onSuccess: async () => {
      await refresh();
      onDeleted?.();
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError(t('form.errors.title'));
    if (!validStart) return setError(t('form.errors.start'));
    if (repeatKind === 'weekly' && !days.length) return setError(t('form.errors.days'));
    if (taskKey.trim() && !TASK_KEY_RE.test(taskKey.trim().toUpperCase())) return setError(t('form.errors.taskKey', { key: taskKey }));
    setError(null);
    save.mutate();
  };

  const toggleDay = (day: number) => setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-title`} className={labelClass}>
          {t('form.what')}
        </label>
        <input id={`${ids}-title`} type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor={`${ids}-date`} className={labelClass}>
            {repeatKind === 'none' ? t('form.date') : t('form.startsOn')}
          </label>
          <input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-[1_1_140px] flex-col gap-1.5">
          <label htmlFor={`${ids}-time`} className={labelClass}>
            {t('form.time')}
          </label>
          <input id={`${ids}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={`${ids}-repeat`} className={labelClass}>
          {t('form.repeat')}
        </span>
        <div role="group" aria-labelledby={`${ids}-repeat`} className="flex flex-wrap gap-1 self-start rounded-md border border-line bg-bg p-1">
          {REPEAT_OPTIONS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={repeatKind === kind}
              onClick={() => setRepeatKind(kind)}
              className={`h-8 rounded-sm px-3 text-[13px] ${repeatKind === kind ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              {t(`repeatOptions.${kind}`)}
            </button>
          ))}
        </div>
        {repeatKind === 'weekly' && (
          <div role="group" aria-label={t('form.weekdays')} className="flex flex-wrap gap-1.5 pt-1">
            {weekdays().map((w) => (
              <button
                key={w.day}
                type="button"
                aria-pressed={days.includes(w.day)}
                aria-label={w.name}
                onClick={() => toggleDay(w.day)}
                className={`size-10 rounded-md border text-[13px] text-ink ${days.includes(w.day) ? 'border-accent bg-line' : 'border-line-strong hover:border-ink-muted'}`}
              >
                {w.short}
              </button>
            ))}
          </div>
        )}
        {validStart && <span className="text-small text-ink-muted">{repeatSummary(repeat, startAt)}</span>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor={`${ids}-task`} className={labelClass}>
            {t('form.task')}
          </label>
          <input
            id={`${ids}-task`}
            type="text"
            list={`${ids}-tasks`}
            value={taskKey}
            placeholder="ABC-123"
            onChange={(e) => setTaskKey(e.target.value)}
            className={`${inputClass} font-mono text-code text-info`}
          />
          <TaskOptions id={`${ids}-tasks`} />
        </div>
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor={`${ids}-commit`} className={labelClass}>
            {t('form.commit')}
          </label>
          <CommitSelect id={`${ids}-commit`} taskKey={task} value={commit} onChange={(c) => setCommitPick({ task, commit: c })} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <span className={labelClass}>{t('form.notice')}</span>
          <span className="flex h-10 items-center gap-2">
            <Bell size={16} strokeWidth={1.5} className="text-ink-muted" aria-hidden />
            {t('form.noticeValue')}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-ink-faint">
          <Trans t={t} i18nKey="form.shortcuts" components={{ kbd: <kbd className="font-mono" /> }} />
        </span>
        <div className="flex gap-2">
          {reminder && onDeleted && (
            <button
              type="button"
              onClick={() => window.confirm(t('form.confirmDelete', { title: reminder.title })) && remove.mutate()}
              className="h-10 rounded-md px-3 text-danger hover:bg-surface-raised"
            >
              {t('form.delete')}
            </button>
          )}
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common:actions.cancel')}
          </button>
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
