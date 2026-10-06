import type { JournalEntry } from '@dev-assistant/shared';
import { ArrowRightLeft, ChevronLeft, ChevronRight, GitCommitHorizontal, PenLine, Sparkles, Trash2, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { primaryButtonClass } from '../../components/fields';
import { addDays, hhmm, localDate, longDay, parseLocalDate } from '../../dates';
import { navigate } from '../../sections';
import { DailySummaryPanel, useDailySummary } from './DailySummaryPanel';
import { JournalAddForm } from './JournalAddForm';
import { useJournal } from './useJournal';

/**
 * Sección "Diario" (diseño: Diario). Ruta `#/diario` u `#/diario/YYYY-MM-DD`;
 * `#/diario/resumen` (botón del panel Hoy) abre hoy y genera el resumen si aún no hay uno.
 */
export function DiarioPage({ params }: { params: string[] }) {
  const today = localDate();
  const date = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : today;
  const day = parseLocalDate(date);
  const { entries, add, remove } = useJournal(date);
  const summary = useDailySummary(date);

  const autoGenerate = params[0] === 'resumen';
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoStarted.current || !summary.summary.isSuccess) return;
    autoStarted.current = true;
    navigate('diario');
    if (!summary.summary.data) summary.generate.mutate();
  }, [autoGenerate, summary.summary.isSuccess, summary.summary.data, summary.generate]);

  const go = (d: Date) => navigate(localDate(d) === today ? 'diario' : `diario/${localDate(d)}`);
  const navButton = 'flex size-8 items-center justify-center rounded-md border border-line-strong text-ink hover:bg-surface-raised';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-display font-semibold">Diario</h1>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Día anterior" onClick={() => go(addDays(day, -1))} className={navButton}>
              <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <span className="min-w-[180px] text-center font-medium">{longDay(day)}</span>
            <button type="button" aria-label="Día siguiente" onClick={() => go(addDays(day, 1))} className={navButton}>
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {date !== today && (
              <button type="button" onClick={() => navigate('diario')} className="h-8 rounded-md border border-line-strong px-2.5 text-[13px] text-ink-muted hover:text-ink">
                Hoy
              </button>
            )}
          </div>
        </div>
        <button type="button" disabled={summary.generate.isPending} onClick={() => summary.generate.mutate()} className={primaryButtonClass}>
          <Sparkles size={16} strokeWidth={2} aria-hidden />
          Resumen para la daily
        </button>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="h-entradas" className="flex min-w-0 flex-[999_1_460px] flex-col gap-3">
          <h2 id="h-entradas" className="m-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase">
            Entradas del día
          </h2>
          <JournalAddForm onAdd={(t) => add.mutateAsync(t)} pending={add.isPending} placeholder="¿Qué has hecho? Ej.: reunión con QA sobre ABC-123" />
          {entries.isError ? (
            <p className="m-0 text-danger">No se pudo cargar el diario.</p>
          ) : entries.data?.length ? (
            <ol className="rounded-lg border border-line bg-surface">
              {entries.data.map((e) => (
                <EntryRow key={e.id} entry={e} onDelete={() => remove.mutate(e.id)} />
              ))}
            </ol>
          ) : (
            entries.data && <p className="m-0 text-ink-muted">{date === today ? 'Aún no hay entradas hoy.' : 'No hay entradas este día.'}</p>
          )}
        </section>

        <DailySummaryPanel date={date} state={summary} />
      </div>
    </div>
  );
}

function EntryRow({ entry: e, onDelete }: { entry: JournalEntry; onDelete: () => void }) {
  const Icon = e.origin === 'commit' ? GitCommitHorizontal : e.origin === 'jira' ? ArrowRightLeft : e.origin === 'auto' ? Zap : PenLine;
  const label = e.origin === 'commit' ? 'Commit de opencode' : e.origin === 'jira' ? 'JIRA' : e.origin === 'auto' ? 'Automática' : 'Manual';
  return (
    <li className="group flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="w-10 shrink-0 font-mono text-small leading-[21px] text-ink-faint">{hhmm(e.createdAt)}</span>
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="break-words">{e.text}</span>
        <span className="text-small text-ink-muted">
          {e.taskKey && (
            <a href={`#/tareas/${e.taskKey}/detalle`} className="font-mono text-info">
              {e.taskKey}
            </a>
          )}
          {e.taskKey && ' · '}
          {e.url ? (
            <a href={e.url} target="_blank" rel="noreferrer" className="text-info">
              {label}
            </a>
          ) : (
            label
          )}
        </span>
      </div>
      {e.source === 'manual' && (
        <button
          type="button"
          aria-label={`Borrar entrada: ${e.text}`}
          onClick={() => window.confirm('¿Borrar esta entrada del diario?') && onDelete()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      )}
    </li>
  );
}
