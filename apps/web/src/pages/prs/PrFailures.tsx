import { useMutation, useQuery } from '@tanstack/react-query';
import type { PrCheckFailure } from '@dev-assistant/shared';
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { primaryButtonClass } from '../../components/fields';
import { navigate } from '../../sections';

/** Los fallos se leen de GitHub al verlos; durante un par de minutos se reutilizan. */
export function usePrFailures(prId: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.prFailures(prId), queryFn: () => api.prFailures(prId), enabled, staleTime: 2 * 60_000, retry: false });
}

/** "Arreglar con opencode": manda los fallos a la sesión de la tarea (o a una conversación del Chat) y la abre. */
export function useFixPr(prId: string) {
  return useMutation({
    mutationFn: () => api.fixPr(prId),
    onSuccess: (result) => navigate(result.target === 'task' ? `tareas/${result.taskKey}/sesion` : `chat/${result.conversationId}`),
  });
}

/** Cada check en rojo con lo que publica en GitHub, y el botón para que opencode lo arregle. */
export function PrFailuresPanel({ prId, hasTask }: { prId: string; hasTask: boolean }) {
  const { t } = useTranslation('prs');
  const failures = usePrFailures(prId);
  const fix = useFixPr(prId);
  if (failures.isPending) return <p className="m-0 text-small text-ink-muted">{t('failures.loading')}</p>;
  if (failures.isError)
    return (
      <p role="alert" className="m-0 text-small text-danger">
        {failures.error.message}
      </p>
    );
  if (!failures.data.failures.length) return <p className="m-0 text-small text-ink-muted">{t('failures.none')}</p>;
  return (
    <div className="flex flex-col gap-3">
      {failures.data.failures.map((f) => (
        <FailureCard key={f.name} failure={f} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButtonClass} disabled={fix.isPending} onClick={() => fix.mutate()}>
          <Wrench size={16} strokeWidth={1.5} aria-hidden />
          {fix.isPending ? t('failures.fixing') : t('failures.fix')}
        </button>
        <span className="min-w-[220px] flex-1 text-small text-ink-muted">{hasTask ? t('failures.fixHint') : t('failures.fixHintChat')}</span>
      </div>
      {fix.isError && (
        <p role="alert" className="m-0 text-small text-danger">
          {fix.error.message}
        </p>
      )}
    </div>
  );
}

function FailureCard({ failure: f }: { failure: PrCheckFailure }) {
  const { t } = useTranslation('prs');
  const more = f.annotationsTotal - f.annotations.length;
  const empty = !f.title && !f.summary && !f.annotations.length;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-l-[3px] border-line border-l-danger px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="min-w-0 font-mono text-code font-medium break-all">{f.name}</span>
        {f.url && (
          <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 text-small">
            {t('failures.viewOnGithub')}
          </a>
        )}
      </div>
      {f.title && <span className="font-medium break-words">{f.title}</span>}
      {f.summary && (
        <div className="max-h-72 min-w-0 overflow-auto text-ink-muted">
          <Markdown>{f.summary}</Markdown>
        </div>
      )}
      {f.annotations.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-2 p-0">
          {f.annotations.map((a, i) => (
            <li key={i} className="flex min-w-0 flex-col gap-0.5">
              <span className={`font-mono text-small break-all ${a.level === 'failure' ? 'text-ink-muted' : 'text-ink-faint'}`}>
                {a.path}
                {a.line ? `:${a.line}` : ''}
              </span>
              <span className="break-words whitespace-pre-wrap text-ink-muted">{[a.title, a.message].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 &&
        (f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer" className="w-fit text-small">
            {t('failures.more', { count: more })}
          </a>
        ) : (
          <span className="text-small text-ink-muted">{t('failures.more', { count: more })}</span>
        ))}
      {empty && <span className="text-small text-ink-faint">{t('failures.noDetail')}</span>}
    </div>
  );
}
