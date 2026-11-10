import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PR_LIST_FILTERS, type PrListFilter, type PullRequestInfo } from '@dev-assistant/shared';
import { Check, Eye, EyeOff, LoaderCircle, RefreshCw } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { EmptyState } from '../../components/Card';
import { inputClass, secondaryButtonClass } from '../../components/fields';
import { timeAgo, whenLabel } from '../../dates';
import { useRemembered } from '../../useRemembered';
import { PrFailuresPanel, usePrFailures } from './PrFailures';
import { AlertRow, Checks, Reviews, repoName, stateLabel } from './PrWidgets';

const card = 'flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4';

/** Sección "Pull requests": `#/prs` (lista) y `#/prs/:id` (una PR). */
export function PrsPage({ params }: { params: string[] }) {
  return params[0] ? <PrPage prId={params[0]} /> : <PrListPage />;
}

/** Observar o no una PR: sin observar no avisa en Hoy ni notifica. */
function useWatch(pr: PullRequestInfo) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.watchPr(pr.id, !pr.watched),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prs'] });
      // Los avisos de Hoy también, aunque no estén en pantalla: al volver no se enseña la foto anterior.
      void queryClient.invalidateQueries({ queryKey: queryKeys.prAlerts, refetchType: 'all' });
    },
  });
}

function WatchButton({ pr, large = false }: { pr: PullRequestInfo; large?: boolean }) {
  const { t } = useTranslation('prs');
  const watch = useWatch(pr);
  const Icon = pr.watched ? Eye : EyeOff;
  return (
    <button
      type="button"
      aria-pressed={pr.watched}
      disabled={watch.isPending}
      onClick={() => watch.mutate()}
      title={t('page.watchTitle')}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 ${large ? 'h-10 px-3.5' : 'h-8 min-w-[128px] text-code'} ${
        pr.watched ? 'border-accent text-accent' : 'border-line-strong text-ink-muted'
      } hover:bg-surface-raised disabled:cursor-not-allowed`}
    >
      <Icon size={large ? 16 : 14} strokeWidth={1.5} aria-hidden />
      {pr.watched ? t('page.watching') : t('page.notWatching')}
    </button>
  );
}

function PrListPage() {
  const { t } = useTranslation(['prs', 'common']);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useRemembered<PrListFilter>('prs.filter', 'open');
  const [query, setQuery] = useRemembered('prs.query', '');
  const status = useQuery({ queryKey: queryKeys.prStatus, queryFn: api.prStatus, refetchInterval: 60_000 });
  const list = useQuery({ queryKey: queryKeys.prList(filter), queryFn: () => api.listPrs(filter), refetchInterval: filter === 'open' ? 60_000 : false });
  const check = useMutation({ mutationFn: api.checkPrs, onSettled: () => void queryClient.invalidateQueries({ queryKey: ['prs'] }) });

  if (status.data && !status.data.configured) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="m-0 text-display font-semibold">{t('page.title')}</h1>
        <EmptyState>
          <Trans t={t} i18nKey="alerts.notConfigured" components={{ code: <code className="font-mono text-code" /> }} />
        </EmptyState>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const prs = (list.data?.prs ?? []).filter((pr) => !q || `${pr.repo} #${pr.number} ${pr.number} ${pr.taskKey ?? ''} ${pr.title}`.toLowerCase().includes(q));
  const error = check.error?.message ?? list.data?.error ?? status.data?.lastError;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-display font-semibold">{t('page.title')}</h1>
          <span className="text-small text-ink-muted">
            {status.data?.lastCheckedAt ? t('page.subtitleChecked', { when: timeAgo(status.data.lastCheckedAt) }) : t('page.subtitle')}
          </span>
        </div>
        <button type="button" className={secondaryButtonClass} disabled={check.isPending} onClick={() => check.mutate()}>
          <RefreshCw size={16} strokeWidth={1.5} className={check.isPending ? 'animate-spin' : undefined} aria-hidden />
          {check.isPending ? t('page.checking') : t('page.checkNow')}
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t('page.filterLabel')} className="flex overflow-hidden rounded-md border border-line-strong">
          {PR_LIST_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
              className={`h-10 px-3.5 ${f === filter ? 'bg-accent font-semibold text-on-accent' : 'text-ink hover:bg-surface-raised'}`}
            >
              {t(`page.filter.${f}`)}
            </button>
          ))}
        </div>
        <label htmlFor="prs-buscar" className="sr-only">
          {t('page.searchLabel')}
        </label>
        <input
          id="prs-buscar"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('page.searchPlaceholder')}
          className={`${inputClass} min-w-0 flex-[1_1_300px]`}
        />
      </div>

      {error && (
        <p role="alert" className="m-0 text-small text-danger">
          {error}
        </p>
      )}

      {list.isPending ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : !prs.length ? (
        <EmptyState>{list.data?.prs.length ? t('page.noMatch') : t(`page.empty.${filter}`)}</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col rounded-lg border border-line bg-surface p-0">
          {prs.map((pr) => (
            <li
              key={pr.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 ${pr.state === 'open' && !pr.watched ? 'opacity-70' : ''}`}
            >
              <a href={`#/prs/${pr.id}`} className="flex min-w-0 flex-[1_1_340px] flex-col text-ink no-underline">
                <span className="font-mono text-code text-info">
                  {repoName(pr.repo)} #{pr.number}
                  <span className="text-ink-muted"> · {pr.taskKey ?? t('page.noTask')}</span>
                </span>
                <span className="break-words">{pr.title}</span>
              </a>
              <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-small whitespace-nowrap text-ink-muted">{stateLabel(pr, t)}</span>
              <Checks pr={pr} />
              <Reviews pr={pr} />
              <span className="min-w-[84px] text-small whitespace-nowrap text-ink-faint">{whenLabel(pr.updatedAt)}</span>
              {pr.state === 'open' && <WatchButton pr={pr} />}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-small text-ink-faint">{t('page.help')}</p>
    </div>
  );
}

function PrPage({ prId }: { prId: string }) {
  const { t } = useTranslation(['prs', 'common']);
  const pr = useQuery({ queryKey: queryKeys.pr(prId), queryFn: () => api.getPr(prId), retry: false, refetchInterval: 60_000 });
  const crumbs = (
    <nav aria-label={t('page.breadcrumb')} className="text-small text-ink-muted">
      <a href="#/prs" className="text-ink-muted">
        {t('page.title')}
      </a>
      {pr.data && (
        <>
          {' / '}
          <span className="font-mono">
            {repoName(pr.data.repo)} #{pr.data.number}
          </span>
        </>
      )}
    </nav>
  );
  if (!pr.data) {
    return (
      <div className="flex flex-col gap-4">
        {crumbs}
        <p className="m-0 text-ink-muted">{pr.isError ? pr.error.message || t('page.notFound') : t('common:status.loading')}</p>
      </div>
    );
  }
  const data = pr.data;
  return (
    <div className="flex flex-col gap-5">
      {crumbs}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-1.5">
          <h1 className="m-0 text-display font-semibold break-words">
            <a href={data.url} target="_blank" rel="noreferrer" className="mr-2 font-mono font-normal text-info">
              {repoName(data.repo)} #{data.number} ↗
            </a>
            {data.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-small text-ink-muted">
            <span className="rounded-sm border border-line-strong px-1.5 py-0.5">{stateLabel(data, t)}</span>
            <span>
              {t('page.branch')} <span className="font-mono text-ink">{data.headRef}</span>
            </span>
            {data.taskKey && (
              <span>
                {t('page.task')}{' '}
                <a href={`#/tareas/${data.taskKey}/detalle`} className="font-mono">
                  {data.taskKey}
                </a>
              </span>
            )}
            <span>{t('page.updated', { when: whenLabel(data.updatedAt) })}</span>
          </div>
        </div>
        {data.state === 'open' && (
          <div className="flex flex-col items-end gap-1">
            <WatchButton pr={data} large />
            <span className="text-small text-ink-faint">{data.watched ? t('page.watchHelpOn') : t('page.watchHelpOff')}</span>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <ChecksCard pr={data} />
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <section aria-labelledby="pr-revisiones" className={card}>
            <h2 id="pr-revisiones" className="m-0 text-heading font-semibold">
              {t('page.reviewsTitle')}
            </h2>
            {!data.approvedBy.length && !data.changesRequestedBy.length ? (
              <p className="m-0 text-ink-muted">{t('page.noReviews')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.changesRequestedBy.map((name) => (
                  <li key={`c-${name}`} className="flex justify-between gap-2">
                    <span>{name}</span>
                    <span className="text-accent">{t('page.changes')}</span>
                  </li>
                ))}
                {data.approvedBy.map((name) => (
                  <li key={`a-${name}`} className="flex justify-between gap-2">
                    <span>{name}</span>
                    <span className="text-success">{t('page.approved')}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.comments > 0 && (
              <span className="text-small text-ink-muted">
                {t('reviews.comments', { count: data.comments })} ·{' '}
                <a href={data.url} target="_blank" rel="noreferrer">
                  {t('page.commentsLink')}
                </a>
              </span>
            )}
          </section>
          <section aria-labelledby="pr-avisos" className={card}>
            <h2 id="pr-avisos" className="m-0 text-heading font-semibold">
              {t('page.alertsTitle')}
            </h2>
            {!data.alerts.length ? (
              <p className="m-0 text-ink-muted">{t('page.noAlerts')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {data.alerts.map((a) => (
                  <AlertRow key={a.id} alert={a} compact />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Los checks del último commit: los fallos como en el detalle de la tarea y, debajo, los que van bien. */
function ChecksCard({ pr }: { pr: PullRequestInfo }) {
  const { t } = useTranslation('prs');
  const failures = usePrFailures(pr.id);
  const data = failures.data;
  const failing = data?.failures.length ?? 0;
  return (
    <section aria-labelledby="pr-checks" className={`${card} flex-[999_1_560px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pr-checks" className="m-0 text-heading font-semibold">
          {t('page.checksTitle')}
        </h2>
        {data && (failing || data.passing.length || data.pending.length) ? (
          <span className={`text-small ${failing ? 'text-danger' : 'text-ink-muted'}`}>
            {t('page.checksCount', { failing, passing: data.passing.length })}
            {data.pending.length ? ` · ${t('page.checksPending', { count: data.pending.length })}` : ''}
          </span>
        ) : null}
      </div>
      {data && !failing && !data.passing.length && !data.pending.length ? (
        <p className="m-0 text-ink-muted">{t('page.noChecks')}</p>
      ) : (
        (failing > 0 || !data) && <PrFailuresPanel prId={pr.id} hasTask={!!pr.taskKey} />
      )}
      {data && (data.passing.length > 0 || data.pending.length > 0) && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-code text-ink-muted">
          {data.pending.map((name) => (
            <li key={`p-${name}`} className="flex items-center gap-2">
              <LoaderCircle size={14} strokeWidth={1.5} className="text-ink-faint" aria-hidden />
              {name}
            </li>
          ))}
          {data.passing.map((name) => (
            <li key={`ok-${name}`} className="flex items-center gap-2">
              <Check size={14} strokeWidth={2} className="text-success" aria-hidden />
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
