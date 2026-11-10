import { useQuery } from '@tanstack/react-query';
import type { PrAlert, PrAlertKind, PullRequestInfo } from '@dev-assistant/shared';
import type { TFunction } from 'i18next';
import { CircleCheck, CircleX, GitMerge, LoaderCircle, MessageSquare, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { EmptyState } from '../../components/Card';
import { daysAgo, hhmm, shortDay, timeAgo } from '../../dates';
import { PrFailuresPanel, useFixPr, usePrFailures } from './PrFailures';

export const ALERT_STYLE: Record<PrAlertKind, { icon: LucideIcon; color: string }> = {
  ci_failed: { icon: CircleX, color: 'text-danger' },
  changes_requested: { icon: MessageSquare, color: 'text-accent' },
  comments: { icon: MessageSquare, color: 'text-ink-muted' },
  approved: { icon: CircleCheck, color: 'text-success' },
  merged: { icon: GitMerge, color: 'text-info' },
};

export const repoName = (repo: string) => repo.split('/').pop() ?? repo;

/** Lista de la tarjeta "Avisos de tus PR" de Hoy (diseño aprobado: icono, qué pasó, PR, tarea y hora). */
export function PrAlertsList() {
  const { t } = useTranslation('prs');
  const status = useQuery({ queryKey: queryKeys.prStatus, queryFn: api.prStatus, refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: queryKeys.prAlerts, queryFn: api.listPrAlerts, refetchInterval: 60_000 });

  if (status.data && !status.data.configured) {
    return (
      <EmptyState>
        <Trans t={t} i18nKey="alerts.notConfigured" components={{ code: <code className="font-mono text-code" /> }} />
      </EmptyState>
    );
  }
  const error = status.data?.lastError;
  return (
    <>
      {error && <p className="m-0 text-small text-danger">{error}</p>}
      {!alerts.data?.length ? (
        <EmptyState>{t('alerts.empty')}</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {alerts.data.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </>
  );
}

/** `compact`: sin los fallos de los checks (en la página de la PR ya se ven arriba). */
export function AlertRow({ alert: a, compact = false }: { alert: PrAlert; compact?: boolean }) {
  const { t } = useTranslation('prs');
  const { icon: Icon, color } = ALERT_STYLE[a.kind];
  const strong = a.kind === 'ci_failed' ? 'text-danger' : '';
  return (
    <li className="flex items-start gap-3 border-b border-line py-2 last:border-b-0">
      <Icon size={16} strokeWidth={1.5} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div className="flex min-w-0 grow flex-col">
        <span className="break-words">
          <strong className={`font-medium ${strong}`}>{a.title}</strong> {t('alerts.in')}{' '}
          <a href={a.url} target="_blank" rel="noreferrer" className="font-mono text-code text-ink">
            {repoName(a.repo)} #{a.number}
          </a>
          {a.taskKey && (
            <>
              {' · '}
              <a href={`#/tareas/${a.taskKey}/detalle`} className="font-mono text-code text-info">
                {a.taskKey}
              </a>
            </>
          )}
        </span>
        {a.kind === 'ci_failed' && !compact ? <CiFailedDetail alert={a} /> : a.detail && <span className="text-small text-ink-muted">{a.detail}</span>}
      </div>
      <span className="shrink-0 text-small text-ink-faint">{daysAgo(a.createdAt) === 0 ? hhmm(a.createdAt) : shortDay(a.createdAt)}</span>
    </li>
  );
}

/** En un aviso de CI en rojo: una línea por check con lo que dice GitHub ahora, y los atajos. */
function CiFailedDetail({ alert: a }: { alert: PrAlert }) {
  const { t } = useTranslation('prs');
  const failures = usePrFailures(a.prId);
  const fix = useFixPr(a.prId);
  // Mientras se lee GitHub (o si falla), lo que se guardó con el aviso.
  if (!failures.data) return a.detail ? <span className="text-small text-ink-muted">{a.detail}</span> : null;
  if (!failures.data.failures.length) return <span className="text-small text-ink-muted">{t('failures.none')}</span>;
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {failures.data.failures.map((f) => (
          <li key={f.name} className="flex min-w-0 gap-2 text-small">
            <span className="shrink-0 font-mono text-ink">{f.name}</span>
            <span className="min-w-0 truncate text-ink-muted">{f.title ?? f.annotations[0]?.message ?? ''}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-4 text-small">
        <a className="text-info" href={a.taskKey ? `#/tareas/${a.taskKey}/detalle` : a.url} {...(a.taskKey ? {} : { target: '_blank', rel: 'noreferrer' })}>
          {t('failures.show')}
        </a>
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-info hover:underline disabled:cursor-not-allowed disabled:text-ink-faint" disabled={fix.isPending} onClick={() => fix.mutate()}>
          {fix.isPending ? t('failures.fixing') : t('failures.fix')}
        </button>
      </div>
      {fix.isError && <span className="text-small text-danger">{fix.error.message}</span>}
    </div>
  );
}

export function stateLabel(pr: PullRequestInfo, t: TFunction<'prs'>) {
  if (pr.state === 'merged') return t('state.merged');
  if (pr.state === 'closed') return t('state.closed');
  if (pr.isDraft) return t('state.draft');
  if (pr.approvedBy.length && !pr.changesRequestedBy.length) return t('state.approved');
  return t('state.ready');
}

export function Checks({ pr }: { pr: PullRequestInfo }) {
  const { t } = useTranslation('prs');
  if (pr.checks === 'failure') {
    const n = pr.failingChecks.length;
    return (
      <span className="flex items-center gap-1 text-small text-danger" title={pr.failingChecks.join(', ')}>
        <CircleX size={14} strokeWidth={1.5} aria-hidden />
        {n > 1 ? t('checks.failingMany', { n }) : n === 1 ? t('checks.failingOne', { name: pr.failingChecks[0] }) : t('checks.failing')}
      </span>
    );
  }
  if (pr.checks === 'success')
    return (
      <span className="flex items-center gap-1 text-small text-success">
        <CircleCheck size={14} strokeWidth={1.5} aria-hidden />
        {t('checks.passing')}
      </span>
    );
  if (pr.checks === 'pending')
    return (
      <span className="flex items-center gap-1 text-small text-ink-muted">
        <LoaderCircle size={14} strokeWidth={1.5} aria-hidden />
        {t('checks.pending')}
      </span>
    );
  return <span className="text-small text-ink-faint">{t('checks.none')}</span>;
}

export function Reviews({ pr }: { pr: PullRequestInfo }) {
  const { t } = useTranslation('prs');
  const comments = pr.comments ? t('reviews.comments', { count: pr.comments }) : '';
  const [text, color] = pr.changesRequestedBy.length
    ? [t('reviews.changesRequested', { names: pr.changesRequestedBy.join(', ') }), 'text-accent']
    : pr.approvedBy.length
      ? [t('reviews.approvedBy', { names: pr.approvedBy.join(', ') }), 'text-success']
      : [comments ? '' : t('reviews.none'), 'text-ink-muted'];
  return (
    <span className={`flex items-center gap-1 text-small ${color}`}>
      <MessageSquare size={14} strokeWidth={1.5} aria-hidden />
      {[text, comments].filter(Boolean).join(' · ')}
    </span>
  );
}

/** "Ver fallos / Ocultar fallos" y, abiertos (de entrada), los fallos de los checks en rojo. */
function FailuresToggle({ prId, hasTask }: { prId: string; hasTask: boolean }) {
  const { t } = useTranslation('prs');
  const [open, setOpen] = useState(true);
  const panelId = `fallos-${prId}`;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="h-8 rounded-md border border-line-strong px-2.5 text-code text-ink hover:bg-surface-raised"
      >
        {open ? t('failures.hide') : t('failures.show')}
      </button>
      {open && (
        <div id={panelId} className="w-full border-t border-line pt-3">
          <PrFailuresPanel prId={prId} hasTask={hasTask} />
        </div>
      )}
    </>
  );
}

/** Bloque "Pull requests" del detalle de tarea (diseño aprobado). Solo aparece si GitHub está configurado. */
export function TaskPullRequests({ taskKey, className }: { taskKey: string; className: string }) {
  const { t } = useTranslation(['prs', 'common']);
  const status = useQuery({ queryKey: queryKeys.prStatus, queryFn: api.prStatus, refetchInterval: 60_000 });
  const prs = useQuery({ queryKey: queryKeys.taskPrs(taskKey), queryFn: () => api.getTaskPrs(taskKey), refetchInterval: 60_000 });
  if (!status.data?.configured) return null;

  return (
    <section aria-labelledby="prs-titulo" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="prs-titulo" className="m-0 text-heading font-semibold">
          {t('taskPrs.title')}
        </h2>
        <span className="text-small text-ink-muted">{status.data.lastCheckedAt ? t('taskPrs.fromGithubChecked', { when: timeAgo(status.data.lastCheckedAt) }) : t('taskPrs.fromGithub')}</span>
      </div>
      {!prs.data?.length ? (
        <p className="m-0 text-ink-muted">{prs.isPending ? t('common:status.loading') : t('taskPrs.empty', { taskKey })}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {prs.data.map((pr) => (
            <li key={pr.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-2.5 last:border-b-0">
              <a href={pr.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-[1_1_260px] flex-col no-underline">
                <span className="font-mono text-code text-info">
                  {repoName(pr.repo)} #{pr.number} ↗
                </span>
                <span className="break-words text-ink">{pr.title}</span>
              </a>
              <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-small whitespace-nowrap text-ink-muted">{stateLabel(pr, t)}</span>
              {pr.state === 'open' && <Checks pr={pr} />}
              {pr.state === 'open' && <Reviews pr={pr} />}
              {pr.state === 'open' && pr.checks === 'failure' && <FailuresToggle prId={pr.id} hasTask />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
