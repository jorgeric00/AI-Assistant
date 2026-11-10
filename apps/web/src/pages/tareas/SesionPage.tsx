import { useQuery } from '@tanstack/react-query';
import type { DevPlan, DevSession, SessionRepo, TaskDetail } from '@dev-assistant/shared';
import { AlertTriangle, Check, Circle, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { secondaryButtonClass } from '../../components/fields';
import { ActualizarJiraButton } from './ActualizarJira';
import { SesionChat } from './SesionChat';
import { HistoryCard, PlanCard } from './TareaDetallePage';

const card = 'flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4';
const caption = 'text-small text-ink-muted';

/** Página "Sesión de desarrollo" (`#/tareas/:clave/sesion`): se habla con opencode aquí (o en la terminal) y se ve cómo va la tarea. */
export function SesionPage({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation(['tasks', 'common']);
  const task = useQuery({ queryKey: queryKeys.task(taskKey), queryFn: () => api.getTask(taskKey), retry: false });
  // opencode cambia PLAN.md, HISTORIAL.md y los clones mientras trabaja: se relee cada 15 s.
  const session = useQuery({ queryKey: queryKeys.taskSession(taskKey), queryFn: () => api.getTaskSession(taskKey), refetchInterval: 15_000 });
  const dev = useQuery({ queryKey: queryKeys.taskDev(taskKey), queryFn: () => api.getTaskDev(taskKey), refetchInterval: 15_000 });

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('breadcrumb.label')} className={caption}>
        <a href={`#/tareas/${taskKey}`} className="text-ink-muted">
          {t('breadcrumb.tasks')}
        </a>{' '}
        /{' '}
        <a href={`#/tareas/${taskKey}/detalle`} className="font-mono text-ink-muted">
          {taskKey}
        </a>{' '}
        / {t('breadcrumb.session')}
      </nav>

      <Header taskKey={taskKey} task={task.data ?? null} />
      <Steps session={session.data ?? null} plan={dev.data?.plan ?? null} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <SesionChat taskKey={taskKey} session={session.data ?? null} />
          <ReposCard session={session.data ?? null} error={session.error?.message ?? null} />
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <PlanCard plan={dev.data?.plan ?? null} loading={dev.isPending} />
          <HistoryCard history={dev.data?.history ?? []} loading={dev.isPending} />
        </div>
      </div>
    </div>
  );
}

function Header({ taskKey, task }: { taskKey: string; task: TaskDetail | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="m-0 min-w-0 flex-[1_1_480px] text-display font-semibold break-words">
        {task?.url ? (
          <a href={task.url} target="_blank" rel="noreferrer" className="mr-2 font-mono font-normal text-info">
            {taskKey}
          </a>
        ) : (
          <span className="mr-2 font-mono font-normal text-ink-muted">{taskKey}</span>
        )}
        {task?.summary ?? ''}
      </h1>
      {task && <ActualizarJiraButton task={task} className={secondaryButtonClass} />}
    </header>
  );
}

function phaseDone(plan: DevPlan | null, name: string) {
  const phase = plan?.phases.find((p) => p.name === name);
  return !!phase && phase.total > 0 && phase.done === phase.total;
}

/** Las cuatro fases de la sesión (skill dev-assistant-tarea), sacadas de PLAN.md. */
function Steps({ session, plan }: { session: DevSession | null; plan: DevPlan | null }) {
  const { t } = useTranslation(['tasks', 'common']);
  // Las fases se buscan por su nombre en castellano, que es como las escribe opencode en PLAN.md.
  const steps = [
    { label: t('session.stepRepos'), done: !!session?.reposConfirmed },
    { label: t('session.stepPlan'), done: phaseDone(plan, 'Plan aprobado') },
    { label: t('session.stepDev'), done: phaseDone(plan, 'Implementación') },
    { label: t('session.stepDelivery'), done: phaseDone(plan, 'Pruebas y PR') },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol aria-label={t('session.progress')} className="m-0 flex list-none flex-wrap gap-2 p-0 text-small">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={i === current ? 'step' : undefined}
          className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 ${
            i === current ? 'border-accent font-medium text-ink' : s.done ? 'border-line text-ink-muted' : 'border-line text-ink-faint'
          }`}
        >
          {s.done ? (
            <Check size={14} strokeWidth={2} className="text-success" aria-hidden />
          ) : i === current ? (
            <Circle size={14} strokeWidth={2} className="text-accent" aria-hidden />
          ) : null}
          {s.label}
          <span className="sr-only">
            {' '}
            {s.done ? t('shared.srDone') : i === current ? t('shared.srInProgress') : t('shared.srPending')}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReposCard({ session, error }: { session: DevSession | null; error: string | null }) {
  const { t } = useTranslation(['tasks', 'common']);
  const anyDirty = session?.repos.some((r) => r.dirty);
  return (
    <section aria-labelledby="repos-titulo" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="repos-titulo" className="m-0 text-heading font-semibold">
          {t('session.reposTitle')}
        </h2>
        {session && !session.reposConfirmed && session.repos.length > 0 && <span className={caption}>{t('session.reposSuggested')}</span>}
      </div>
      {error ? (
        <p className="m-0 text-ink-muted">{error}</p>
      ) : !session ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : !session.repos.length ? (
        <p className="m-0 text-ink-muted">
          <Trans t={t} i18nKey="session.noRepos" components={{ link: <a href="#/repositorios" /> }} />
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[620px] border-collapse text-code">
              <thead>
                <tr className="text-left text-small text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('session.colRepo')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('session.colBranch')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('session.colCommits')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('session.colPr')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {session.repos.map((r) => (
                  <RepoRow key={r.name} repo={r} branch={session.branch} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-small text-ink-muted">
            {anyDirty ? t('session.ownCloneDirty') : t('session.ownClone')}
          </p>
        </>
      )}
    </section>
  );
}

function RepoRow({ repo, branch }: { repo: SessionRepo; branch: string | null }) {
  const { t } = useTranslation(['tasks', 'common']);
  const onTaskBranch = !!branch && repo.currentBranch === branch;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2.5">
        <div className="font-mono">{repo.name}</div>
        <div className="text-small break-all text-ink-faint">{repo.localPath ?? <a href="#/repositorios">{t('session.notInRepos')}</a>}</div>
      </td>
      <td className="px-3 py-2.5">
        {!repo.localPath ? (
          <span className="text-ink-faint">—</span>
        ) : !repo.pathOk ? (
          <Warning>{t('session.repoNotFound')}</Warning>
        ) : (
          <>
            <div className={`font-mono text-small ${onTaskBranch ? 'text-ink' : 'text-ink-muted'}`}>{repo.currentBranch ?? t('session.noBranch')}</div>
            {repo.dirty && <Warning>{onTaskBranch ? t('session.dirty') : t('session.dirtyOtherBranch')}</Warning>}
          </>
        )}
      </td>
      <td className="px-3 py-2.5">{repo.commits ?? <span className="text-ink-faint">—</span>}</td>
      <td className="px-3 py-2.5">
        {repo.prUrl ? (
          <a href={repo.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 whitespace-nowrap text-info">
            {t('session.prNumber', { number: repo.prUrl.split('/').pop() })}
            <ExternalLink size={12} strokeWidth={1.5} aria-label={t('shared.opensGithub')} />
          </a>
        ) : (
          <span className="text-ink-faint">{t('session.noPr')}</span>
        )}
      </td>
    </tr>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-small text-accent">
      <AlertTriangle size={12} strokeWidth={2} aria-hidden />
      {children}
    </div>
  );
}
