import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailySummary } from '@dev-assistant/shared';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { dayAndTime, longDay, parseLocalDate } from '../../dates';
import i18n from '../../i18n';

/** Resumen guardado del día y la acción de generarlo (la usan el panel y el botón de la cabecera). */
export function useDailySummary(date: string) {
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: queryKeys.dailySummary(date), queryFn: () => api.getDailySummary(date) });
  const generate = useMutation({
    mutationFn: () => api.generateDailySummary(date),
    onSuccess: (data) => queryClient.setQueryData<DailySummary | null>(queryKeys.dailySummary(date), data),
  });
  // Al cambiar de día no se arrastra el error ni el estado del anterior.
  const { reset } = generate;
  useEffect(() => reset(), [date, reset]);
  return { summary, generate };
}

/** "lunes 6 de octubre" en minúscula a mitad de frase; en inglés los días van con mayúscula. */
function sinceLabel(since: string): string {
  const day = longDay(parseLocalDate(since));
  return i18n.language === 'en' ? day : day.toLowerCase();
}

export function DailySummaryPanel({ date, state }: { date: string; state: ReturnType<typeof useDailySummary> }) {
  const { t } = useTranslation(['diary', 'common']);
  const { summary, generate } = state;
  const [copied, setCopied] = useState(false);
  const data = summary.data;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.contentMd);
    setCopied(true);
  };

  return (
    <aside
      aria-labelledby="h-resumen"
      aria-busy={generate.isPending}
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="h-resumen" className="m-0 text-heading font-semibold">
          {t('summary.title')}
        </h2>
        {data && !generate.isPending && (
          <button
            type="button"
            onClick={copy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] text-ink hover:bg-surface-raised"
          >
            {copied ? <Check size={14} className="text-success" aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? t('summary.copied') : t('common:actions.copy')}
          </button>
        )}
      </div>

      {generate.isPending ? (
        <p role="status" className="m-0 text-ink-muted">
          {t('summary.preparing')}
        </p>
      ) : data ? (
        <>
          <Markdown>{data.contentMd}</Markdown>
          <p className="m-0 text-small text-ink-faint">
            {t('summary.footer', { since: sinceLabel(data.since), generated: dayAndTime(data.generatedAt) })}{' '}
            <button type="button" onClick={() => generate.mutate()} className="text-info hover:underline">
              {t('summary.regenerate')}
            </button>
          </p>
        </>
      ) : (
        summary.isSuccess && (
          <p className="m-0 text-ink-muted">
            {t('summary.intro')}
          </p>
        )
      )}

      {generate.isError && (
        <p role="alert" className="m-0 text-danger">
          {generate.error.message}
        </p>
      )}
      {summary.isError && <p className="m-0 text-danger">{t('summary.loadError')}</p>}
    </aside>
  );
}
