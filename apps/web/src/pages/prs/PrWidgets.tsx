import { useQuery } from '@tanstack/react-query';
import type { PrAlert, PrAlertKind, PullRequestInfo } from '@dev-assistant/shared';
import { CircleCheck, CircleX, GitMerge, LoaderCircle, MessageSquare, type LucideIcon } from 'lucide-react';
import { api, queryKeys } from '../../api';
import { EmptyState } from '../../components/Card';
import { daysAgo, hhmm, shortDay, timeAgo } from '../../dates';

const ALERT_STYLE: Record<PrAlertKind, { icon: LucideIcon; color: string }> = {
  ci_failed: { icon: CircleX, color: 'text-danger' },
  changes_requested: { icon: MessageSquare, color: 'text-accent' },
  comments: { icon: MessageSquare, color: 'text-ink-muted' },
  approved: { icon: CircleCheck, color: 'text-success' },
  merged: { icon: GitMerge, color: 'text-info' },
};

const repoName = (repo: string) => repo.split('/').pop() ?? repo;

/** Lista de la tarjeta "Avisos de tus PR" de Hoy (diseño aprobado: icono, qué pasó, PR, tarea y hora). */
export function PrAlertsList() {
  const status = useQuery({ queryKey: queryKeys.prStatus, queryFn: api.prStatus, refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: queryKeys.prAlerts, queryFn: api.listPrAlerts, refetchInterval: 60_000 });

  if (status.data && !status.data.configured) {
    return (
      <EmptyState>
        Añade <code className="font-mono text-code">GITHUB_TOKEN</code> al fichero .env y reinicia la app para ver aquí CI en rojo y comentarios nuevos.
      </EmptyState>
    );
  }
  const error = status.data?.lastError;
  return (
    <>
      {error && <p className="m-0 text-small text-danger">{error}</p>}
      {!alerts.data?.length ? (
        <EmptyState>Sin avisos. Aquí verás CI en rojo y comentarios nuevos.</EmptyState>
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

function AlertRow({ alert: a }: { alert: PrAlert }) {
  const { icon: Icon, color } = ALERT_STYLE[a.kind];
  const strong = a.kind === 'ci_failed' ? 'text-danger' : '';
  return (
    <li className="flex items-start gap-3 border-b border-line py-2 last:border-b-0">
      <Icon size={16} strokeWidth={1.5} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div className="flex min-w-0 grow flex-col">
        <span className="break-words">
          <strong className={`font-medium ${strong}`}>{a.title}</strong> en{' '}
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
        {a.detail && <span className="text-small text-ink-muted">{a.detail}</span>}
      </div>
      <span className="shrink-0 text-small text-ink-faint">{daysAgo(a.createdAt) === 0 ? hhmm(a.createdAt) : shortDay(a.createdAt)}</span>
    </li>
  );
}

function stateLabel(pr: PullRequestInfo) {
  if (pr.state === 'merged') return 'Mergeada';
  if (pr.state === 'closed') return 'Cerrada';
  if (pr.isDraft) return 'Borrador';
  if (pr.approvedBy.length && !pr.changesRequestedBy.length) return 'Aprobada';
  return 'Lista para revisar';
}

function Checks({ pr }: { pr: PullRequestInfo }) {
  if (pr.checks === 'failure') {
    const n = pr.failingChecks.length;
    return (
      <span className="flex items-center gap-1 text-small text-danger" title={pr.failingChecks.join(', ')}>
        <CircleX size={14} strokeWidth={1.5} aria-hidden />
        {n > 1 ? `${n} checks en rojo` : n === 1 ? `${pr.failingChecks[0]} en rojo` : 'Checks en rojo'}
      </span>
    );
  }
  if (pr.checks === 'success')
    return (
      <span className="flex items-center gap-1 text-small text-success">
        <CircleCheck size={14} strokeWidth={1.5} aria-hidden />
        Checks en verde
      </span>
    );
  if (pr.checks === 'pending')
    return (
      <span className="flex items-center gap-1 text-small text-ink-muted">
        <LoaderCircle size={14} strokeWidth={1.5} aria-hidden />
        Checks en curso
      </span>
    );
  return <span className="text-small text-ink-faint">Sin checks</span>;
}

function Reviews({ pr }: { pr: PullRequestInfo }) {
  const comments = pr.comments ? `${pr.comments} comentario${pr.comments === 1 ? '' : 's'}` : '';
  const [text, color] = pr.changesRequestedBy.length
    ? [`Cambios pedidos por ${pr.changesRequestedBy.join(', ')}`, 'text-accent']
    : pr.approvedBy.length
      ? [`Aprobada por ${pr.approvedBy.join(', ')}`, 'text-success']
      : [comments ? '' : 'Sin revisiones', 'text-ink-muted'];
  return (
    <span className={`flex items-center gap-1 text-small ${color}`}>
      <MessageSquare size={14} strokeWidth={1.5} aria-hidden />
      {[text, comments].filter(Boolean).join(' · ')}
    </span>
  );
}

/** Bloque "Pull requests" del detalle de tarea (diseño aprobado). Solo aparece si GitHub está configurado. */
export function TaskPullRequests({ taskKey, className }: { taskKey: string; className: string }) {
  const status = useQuery({ queryKey: queryKeys.prStatus, queryFn: api.prStatus, refetchInterval: 60_000 });
  const prs = useQuery({ queryKey: queryKeys.taskPrs(taskKey), queryFn: () => api.getTaskPrs(taskKey), refetchInterval: 60_000 });
  if (!status.data?.configured) return null;

  return (
    <section aria-labelledby="prs-titulo" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="prs-titulo" className="m-0 text-heading font-semibold">
          Pull requests
        </h2>
        <span className="text-small text-ink-muted">De GitHub{status.data.lastCheckedAt ? ` · comprobado ${timeAgo(status.data.lastCheckedAt)}` : ''}</span>
      </div>
      {!prs.data?.length ? (
        <p className="m-0 text-ink-muted">{prs.isPending ? 'Cargando…' : `Aún no hay PR con ${taskKey} en la rama o el título.`}</p>
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
              <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-small whitespace-nowrap text-ink-muted">{stateLabel(pr)}</span>
              {pr.state === 'open' && <Checks pr={pr} />}
              {pr.state === 'open' && <Reviews pr={pr} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
