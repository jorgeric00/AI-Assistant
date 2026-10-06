import { useMutation, useQuery } from '@tanstack/react-query';
import type { DevPlan, DevSession, SessionRepo, TaskDetail } from '@dev-assistant/shared';
import { AlertTriangle, Check, Circle, Copy, ExternalLink, SquareTerminal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, queryKeys } from '../../api';
import { primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { ActualizarJiraButton } from './ActualizarJira';
import { HistoryCard, PlanCard } from './TareaDetallePage';

const card = 'flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4';
const caption = 'text-small text-ink-muted';

/** Página "Sesión de desarrollo" (`#/tareas/:clave/sesion`): opencode trabaja en la terminal y aquí se ve cómo va. */
export function SesionPage({ taskKey }: { taskKey: string }) {
  const task = useQuery({ queryKey: queryKeys.task(taskKey), queryFn: () => api.getTask(taskKey), retry: false });
  // opencode cambia PLAN.md, HISTORIAL.md y los clones mientras trabaja: se relee cada 15 s.
  const session = useQuery({ queryKey: queryKeys.taskSession(taskKey), queryFn: () => api.getTaskSession(taskKey), refetchInterval: 15_000 });
  const dev = useQuery({ queryKey: queryKeys.taskDev(taskKey), queryFn: () => api.getTaskDev(taskKey), refetchInterval: 15_000 });

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Ruta" className={caption}>
        <a href={`#/tareas/${taskKey}`} className="text-ink-muted">
          Tareas de JIRA
        </a>{' '}
        /{' '}
        <a href={`#/tareas/${taskKey}/detalle`} className="font-mono text-ink-muted">
          {taskKey}
        </a>{' '}
        / Sesión de desarrollo
      </nav>

      <Header taskKey={taskKey} task={task.data ?? null} />
      <Steps session={session.data ?? null} plan={dev.data?.plan ?? null} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <OpencodeCard taskKey={taskKey} session={session.data ?? null} />
          <ReposCard session={session.data ?? null} error={session.error?.message ?? null} />
          <PlanCard plan={dev.data?.plan ?? null} loading={dev.isPending} />
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col">
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
  const steps = [
    { label: '1 · Repos', done: !!session?.reposConfirmed },
    { label: '2 · Plan aprobado', done: phaseDone(plan, 'Plan aprobado') },
    { label: '3 · Desarrollo', done: phaseDone(plan, 'Implementación') },
    { label: '4 · Entrega (push y PR)', done: phaseDone(plan, 'Pruebas y PR') },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol aria-label="Progreso" className="m-0 flex list-none flex-wrap gap-2 p-0 text-small">
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
          <span className="sr-only">{s.done ? ' (hecho)' : i === current ? ' (en curso)' : ' (pendiente)'}</span>
        </li>
      ))}
    </ol>
  );
}

function OpencodeCard({ taskKey, session }: { taskKey: string; session: DevSession | null }) {
  const [copied, setCopied] = useState(false);
  const open = useMutation({ mutationFn: () => api.openTaskSession(taskKey) });
  const command = open.data?.command ?? session?.command ?? '';
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section aria-labelledby="opencode-titulo" className={`${card} border-accent`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="opencode-titulo" className="m-0 text-heading font-semibold">
          opencode en tu terminal
        </h2>
        {open.data?.opened && (
          <span className="flex items-center gap-1.5 text-small text-success">
            <Circle size={12} strokeWidth={2} aria-hidden />
            Abierto
          </span>
        )}
      </div>
      <p className="m-0 text-ink-muted">
        Hablas con opencode en la terminal. Te propone cada commit y no hace push ni abre PR sin que se lo confirmes. Esta página se actualiza sola con el plan y los commits.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryButtonClass} disabled={open.isPending} onClick={() => open.mutate()}>
          <SquareTerminal size={16} strokeWidth={1.5} aria-hidden />
          {open.isPending ? 'Abriendo…' : 'Abrir opencode'}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={!command} onClick={copy}>
          <Copy size={16} strokeWidth={1.5} aria-hidden />
          {copied ? 'Copiado' : 'Copiar comando'}
        </button>
        {session && <code className="min-w-0 truncate font-mono text-code text-ink-faint">{session.folder}</code>}
      </div>
      <p role="status" className="m-0 text-small text-ink-muted empty:hidden">
        {open.isError
          ? open.error.message
          : open.data && !open.data.opened
            ? 'Aquí la app no puede abrir la terminal. Copia el comando y pégalo en una terminal.'
            : open.data?.opened
              ? 'Se ha abierto una ventana con opencode en la carpeta de la tarea.'
              : ''}
      </p>
    </section>
  );
}

function ReposCard({ session, error }: { session: DevSession | null; error: string | null }) {
  const anyDirty = session?.repos.some((r) => r.dirty);
  return (
    <section aria-labelledby="repos-titulo" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="repos-titulo" className="m-0 text-heading font-semibold">
          Repositorios de la tarea
        </h2>
        {session && !session.reposConfirmed && session.repos.length > 0 && <span className={caption}>Sugeridos por el proyecto de JIRA, hasta que opencode los fije en el plan</span>}
      </div>
      {error ? (
        <p className="m-0 text-ink-muted">{error}</p>
      ) : !session ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : !session.repos.length ? (
        <p className="m-0 text-ink-muted">
          Aún no hay repos. opencode te propondrá cuáles tocar; si das de alta los del proyecto en <a href="#/repositorios">Repositorios</a>, se los sugerirá él.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[620px] border-collapse text-code">
              <thead>
                <tr className="text-left text-small text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Repo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Rama en tu clon
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Commits
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    PR
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
            Se trabaja en tu clon de siempre{anyDirty ? '. Guarda o aparca tus cambios: opencode no cambia de rama con cambios sin guardar.' : '.'}
          </p>
        </>
      )}
    </section>
  );
}

function RepoRow({ repo, branch }: { repo: SessionRepo; branch: string | null }) {
  const onTaskBranch = !!branch && repo.currentBranch === branch;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2.5">
        <div className="font-mono">{repo.name}</div>
        <div className="text-small break-all text-ink-faint">{repo.localPath ?? <a href="#/repositorios">No está en Repositorios</a>}</div>
      </td>
      <td className="px-3 py-2.5">
        {!repo.localPath ? (
          <span className="text-ink-faint">—</span>
        ) : !repo.pathOk ? (
          <Warning>No se encuentra el repo en esa carpeta</Warning>
        ) : (
          <>
            <div className={`font-mono text-small ${onTaskBranch ? 'text-ink' : 'text-ink-muted'}`}>{repo.currentBranch ?? '(sin rama)'}</div>
            {repo.dirty && <Warning>{onTaskBranch ? 'Cambios sin guardar' : 'Tienes cambios sin guardar: no se cambia de rama'}</Warning>}
          </>
        )}
      </td>
      <td className="px-3 py-2.5">{repo.commits ?? <span className="text-ink-faint">—</span>}</td>
      <td className="px-3 py-2.5">
        {repo.prUrl ? (
          <a href={repo.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 whitespace-nowrap text-info">
            PR #{repo.prUrl.split('/').pop()}
            <ExternalLink size={12} strokeWidth={1.5} aria-label="(abre GitHub)" />
          </a>
        ) : (
          <span className="text-ink-faint">Sin PR</span>
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
