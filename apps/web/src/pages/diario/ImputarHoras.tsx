import { useMutation } from '@tanstack/react-query';
import type { WorklogDay, WorklogLine, WorklogSubmitResult } from '@dev-assistant/shared';
import { CircleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { addDays, localDate, longDay, parseLocalDate } from '../../dates';

interface DayState extends WorklogDay {
  skipped: boolean;
}

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const sumOf = (lines: WorklogLine[]) => lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);

/** Lunes de la semana de hoy: intervalo inicial de la imputación. */
function monday() {
  const now = new Date();
  return localDate(addDays(now, -((now.getDay() + 6) % 7)));
}

/** Imputación de horas en JIRA: intervalo, propuesta por día editable y envío con confirmación. */
export function ImputarHoras() {
  const { t } = useTranslation('diary');
  const [from, setFrom] = useState(monday);
  const [to, setTo] = useState(() => localDate());
  const [days, setDays] = useState<DayState[] | null>(null);
  const [result, setResult] = useState<WorklogSubmitResult | null>(null);

  const calc = useMutation({
    mutationFn: () => api.previewWorklog(from, to),
    onSuccess: (data) => setDays(data.map((d) => ({ ...d, skipped: false }))),
  });
  const entries = (days ?? [])
    .filter((d) => d.status !== 'imputado' && !d.skipped)
    .flatMap((d) => d.lines.filter((l) => Number(l.hours) > 0).map((l) => ({ date: d.date, key: l.key, hours: Number(l.hours) })));
  const total = entries.reduce((s, e) => s + e.hours, 0);
  const submit = useMutation({
    mutationFn: () => api.submitWorklog({ entries }),
    onSuccess: (res) => {
      setResult(res);
      calc.mutate();
    },
  });

  const patch = (date: string, fn: (d: DayState) => DayState) => setDays((all) => all && all.map((d) => (d.date === date ? fn(d) : d)));
  const setHours = (date: string, key: string, hours: string) =>
    patch(date, (d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, hours: hours === '' ? 0 : Number(hours) } : l)) }));

  return (
    <section aria-labelledby="h-imputar" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 id="h-imputar" className="m-0 text-title font-semibold">
          {t('worklog.title')}
        </h2>
        <p className="m-0 text-small text-ink-muted">{t('worklog.intro')}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          calc.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5 text-small text-ink-muted">
          {t('worklog.from')}
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required className={`${inputClass} [color-scheme:dark]`} />
        </label>
        <label className="flex flex-col gap-1.5 text-small text-ink-muted">
          {t('worklog.to')}
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required className={`${inputClass} [color-scheme:dark]`} />
        </label>
        <button type="submit" disabled={calc.isPending || !from || !to || from > to} className={secondaryButtonClass}>
          {calc.isPending ? t('worklog.calculating') : t('worklog.calc')}
        </button>
      </form>
      {calc.isError && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {t('worklog.error', { message: calc.error.message })}
        </p>
      )}

      {days && !days.length && <p className="m-0 text-ink-muted">{t('worklog.noDays')}</p>}
      {!!days?.length && (
        <ol className="m-0 flex list-none flex-col p-0">
          {days.map((d) => (
            <DayRow key={d.date} day={d} onSkip={() => patch(d.date, (x) => ({ ...x, skipped: !x.skipped }))} onHours={(k, h) => setHours(d.date, k, h)} onRemove={(k) => patch(d.date, (x) => ({ ...x, lines: x.lines.filter((l) => l.key !== k) }))} onAdd={(k) => patch(d.date, (x) => (x.lines.some((l) => l.key === k) ? x : { ...x, lines: [...x.lines, { key: k, summary: '', hours: Math.max(0.5, x.target - sumOf(x.lines)) }] }))} />
          ))}
        </ol>
      )}

      {result && (
        <div role="status" className="flex flex-col gap-1 text-small">
          <span className="text-success">{t('worklog.result', { done: result.done })}</span>
          {!!result.failed.length && (
            <>
              <span className="text-danger">{t('worklog.failed', { count: result.failed.length })}</span>
              <ul className="m-0 pl-5 text-danger">
                {result.failed.map((f) => (
                  <li key={`${f.date}${f.key}`}>
                    {f.date} · {f.key}: {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {submit.isError && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {submit.error.message}
        </p>
      )}
      {!!days?.length && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!entries.length && <span className="text-small text-ink-muted">{t('worklog.nothing')}</span>}
          <button
            type="button"
            disabled={!entries.length || submit.isPending}
            onClick={() => window.confirm(t('worklog.confirm', { count: entries.length, hours: total })) && submit.mutate()}
            className={primaryButtonClass}
          >
            {submit.isPending ? t('worklog.submitting') : t('worklog.submit')}
          </button>
        </div>
      )}
    </section>
  );
}

function DayRow({ day: d, onSkip, onHours, onRemove, onAdd }: { day: DayState; onSkip: () => void; onHours: (key: string, hours: string) => void; onRemove: (key: string) => void; onAdd: (key: string) => void }) {
  const { t } = useTranslation('diary');
  const [key, setKey] = useState('');
  const sum = sumOf(d.lines);
  const editable = d.status !== 'imputado' && !d.skipped;
  const bad = editable && Math.abs(sum - d.target) > 0.001;
  const needsTask = editable && !d.lines.length;
  return (
    <li className={`flex flex-col gap-2 border-b border-line py-3 last:border-b-0 ${needsTask ? 'border-l-2 border-l-danger pl-3' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{longDay(parseLocalDate(d.date))}</span>
        <span className="flex items-center gap-3 text-small">
          {d.status === 'imputado' ? (
            <span className="text-success">{t('worklog.imputed')}</span>
          ) : d.skipped ? (
            <span className="text-ink-muted">{t('worklog.skipped')}</span>
          ) : (
            <span className={bad ? 'text-danger' : 'text-ink-muted'} title={bad ? t('worklog.diff') : undefined}>
              {t('worklog.total', { sum, target: d.target })}
            </span>
          )}
          {d.status !== 'imputado' && (
            <button type="button" onClick={onSkip} className="text-info hover:underline">
              {d.skipped ? t('worklog.unskip') : t('worklog.skip')}
            </button>
          )}
        </span>
      </div>
      {needsTask && <p className="m-0 text-small text-danger">{t('worklog.noActivity')}</p>}
      {editable && (
        <>
          {!!d.lines.length && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {d.lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    value={l.hours}
                    aria-label={t('worklog.hoursOf', { key: l.key })}
                    onChange={(e) => onHours(l.key, e.target.value)}
                    className={`${inputClass} w-20`}
                  />
                  <span className="shrink-0 font-mono text-small">{l.key}</span>
                  <span className="min-w-0 truncate text-small text-ink-muted">{l.summary}</span>
                  <button type="button" aria-label={t('worklog.remove', { key: l.key })} onClick={() => onRemove(l.key)} className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint hover:text-danger">
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const k = key.trim().toUpperCase();
              if (KEY_RE.test(k)) {
                onAdd(k);
                setKey('');
              }
            }}
          >
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('worklog.addKey')} aria-label={t('worklog.addKey')} className={`${inputClass} w-48 font-mono`} />
            <button type="submit" disabled={!KEY_RE.test(key.trim().toUpperCase())} className={secondaryButtonClass}>
              {t('worklog.add')}
            </button>
          </form>
        </>
      )}
    </li>
  );
}
