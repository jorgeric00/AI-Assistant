import { useQuery } from '@tanstack/react-query';
import type { DevPlan, HistoryEntry, TaskDetail } from '@dev-assistant/shared';
import { BookOpen, Check, ExternalLink, FileText, Link2, SquareTerminal } from 'lucide-react';
import { api, queryKeys } from '../../api';
import { noteHref } from '../../sections';
import { primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { dayAndTime, timeAgo } from '../../dates';
import { TaskPullRequests } from '../prs/PrWidgets';
import { ActualizarJiraButton, JiraUpdatesList } from './ActualizarJira';

const card = 'flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4';
const caption = 'text-small text-ink-muted';
const subheading = 'm-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase';

/** Página "Detalle de tarea" (`#/tareas/:clave/detalle`): JIRA, plan de desarrollo e histórico de cambios. */
export function TareaDetallePage({ taskKey }: { taskKey: string }) {
  const task = useQuery({ queryKey: queryKeys.task(taskKey), queryFn: () => api.getTask(taskKey), retry: false });
  // opencode actualiza PLAN.md e HISTORIAL.md mientras trabaja: se releen cada 15 s.
  const dev = useQuery({ queryKey: queryKeys.taskDev(taskKey), queryFn: () => api.getTaskDev(taskKey), refetchInterval: 15_000 });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Ruta" className={caption}>
        <a href={`#/tareas/${taskKey}`} className="text-ink-muted">
          Tareas de JIRA
        </a>{' '}
        / <span className="font-mono">{taskKey}</span>
      </nav>

      {task.isError ? (
        <p className="m-0 text-ink-muted">{task.error.message}</p>
      ) : !task.data ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : (
        <>
          <Header task={task.data} />
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
              <TaskPullRequests taskKey={taskKey} className={`${card} gap-3`} />
              <PlanCard plan={dev.data?.plan ?? null} loading={dev.isPending} />
              <HistoryCard history={dev.data?.history ?? []} loading={dev.isPending} />
              {dev.data && (
                <p className="m-0 text-small text-ink-faint">
                  opencode escribe estos ficheros en <code className="font-mono">{dev.data.folder}</code>
                </p>
              )}
            </div>
            <JiraCard task={task.data} />
          </div>
        </>
      )}
    </div>
  );
}

function Header({ task }: { task: TaskDetail }) {
  const meta = task.synced
    ? [task.priority && `Prioridad ${task.priority}`, task.issueType, task.project, task.updatedAt && `Actualizada ${dayAndTime(task.updatedAt)}`].filter(Boolean)
    : ['Aún sin sincronizar con JIRA'];
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-2">
        {task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start font-mono text-code text-info">
            {task.key}
            <ExternalLink size={12} strokeWidth={1.5} aria-label="(abre JIRA)" />
          </a>
        ) : (
          <span className="font-mono text-code text-ink-muted">{task.key}</span>
        )}
        <h1 className="m-0 text-display font-semibold break-words">{task.summary}</h1>
        <div className={`flex flex-wrap items-center gap-2 ${caption}`}>
          {task.synced && <span className="rounded-sm border border-line-strong px-1.5 py-0.5 whitespace-nowrap">{task.status}</span>}
          {meta.map((m, i) => (
            <span key={i}>
              {i > 0 && '· '}
              {m}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`#/tareas/${task.key}/sesion`} className={`${secondaryButtonClass} no-underline`}>
          <SquareTerminal size={16} strokeWidth={1.5} aria-hidden />
          Sesión de desarrollo
        </a>
        <ActualizarJiraButton task={task} className={primaryButtonClass} />
      </div>
    </header>
  );
}

export function PlanCard({ plan, loading }: { plan: DevPlan | null; loading: boolean }) {
  return (
    <section aria-labelledby="plan-titulo" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="plan-titulo" className="m-0 text-heading font-semibold">
          Plan de desarrollo
        </h2>
        <span className={caption}>PLAN.md de opencode{plan && ` · actualizado ${timeAgo(plan.updatedAt)}`}</span>
      </div>
      {loading ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : !plan ? (
        <p className="m-0 text-ink-muted">Aún no hay plan. Lo escribirá opencode cuando empiece a desarrollar la tarea, y aquí verás en qué fase está.</p>
      ) : (
        <>
          <PlanProgress plan={plan} />
          <div className="flex flex-col gap-3">
            {plan.sections.map((section) => (
              <div key={section.title} className="flex flex-col gap-1.5">
                <h3 className={`${subheading} flex justify-between`}>
                  <span>{section.title}</span>
                  <span>
                    {section.steps.filter((s) => s.done).length} de {section.steps.length}
                  </span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {section.steps.map((step, i) => (
                    <li key={i} className={`flex items-start gap-2 ${step.done ? 'text-ink-muted' : 'text-ink'}`}>
                      <span
                        aria-hidden
                        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${step.done ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'}`}
                      >
                        {step.done && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span>{step.text}</span>
                      <span className="sr-only">{step.done ? '(hecho)' : '(pendiente)'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PlanProgress({ plan }: { plan: DevPlan }) {
  const percent = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
  const currentIndex = plan.phases.findIndex((p) => p.name === plan.currentPhase);
  return (
    <div className="flex flex-col gap-2">
      <div className={`flex justify-between ${caption}`}>
        <span className="font-medium text-ink">
          {plan.currentPhase ? `Fase ${currentIndex + 1} de ${plan.phases.length} · ${plan.currentPhase}` : 'Plan completado'}
        </span>
        <span>
          {plan.done} de {plan.total} pasos
        </span>
      </div>
      <div role="progressbar" aria-label="Progreso del plan" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-sm bg-line">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <ol aria-label="Fases" className="mt-1 flex flex-wrap gap-2">
        {plan.phases.map((phase) => {
          const state = phase.done === phase.total ? 'done' : phase.name === plan.currentPhase ? 'now' : 'todo';
          return (
            <li key={phase.name} className="flex min-w-[120px] flex-1 flex-col gap-1">
              <div className={`h-1 rounded-sm ${state === 'done' ? 'bg-accent' : state === 'now' ? 'bg-accent/50' : 'bg-line'}`} />
              <span className={`text-small ${state === 'todo' ? 'text-ink-faint' : 'text-ink'}`}>
                {phase.name}
                <span className="sr-only">{state === 'done' ? ' (hecha)' : state === 'now' ? ' (en curso)' : ' (pendiente)'}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function HistoryCard({ history, loading }: { history: HistoryEntry[]; loading: boolean }) {
  return (
    <section aria-labelledby="historico-titulo" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="historico-titulo" className="m-0 text-heading font-semibold">
          Histórico de cambios
        </h2>
        <span className={caption}>Lo anota opencode en cada commit</span>
      </div>
      {loading ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : !history.length ? (
        <p className="m-0 text-ink-muted">Sin cambios todavía. Cada commit de opencode añadirá aquí una línea con su fecha, su enlace de GitHub y una explicación breve.</p>
      ) : (
        <ol className="flex flex-col">
          {history.map((h, i) => (
            <li key={`${h.sha}-${i}`} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-b-0">
              <span className="w-36 shrink-0 font-mono text-code text-ink-faint">{h.date}</span>
              {h.url ? (
                <a href={h.url} target="_blank" rel="noreferrer" className="w-44 shrink-0 truncate font-mono text-code text-info">
                  {h.repo}@{h.sha}
                </a>
              ) : (
                <span className="w-44 shrink-0 truncate font-mono text-code text-ink-muted" title="Aún no está en GitHub">
                  {h.repo}@{h.sha}
                </span>
              )}
              <span className="min-w-0 flex-[1_1_240px] break-words">{h.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function JiraCard({ task }: { task: TaskDetail }) {
  const doc = useQuery({ queryKey: queryKeys.taskDoc(task.key), queryFn: () => api.getTaskDoc(task.key), retry: false });
  return (
    <aside aria-labelledby="jira-titulo" className={`${card} flex-[1_1_320px]`}>
      <h2 id="jira-titulo" className="m-0 text-heading font-semibold">
        En JIRA
      </h2>
      {task.description ? (
        <p className="m-0 max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words text-ink-muted">{task.description}</p>
      ) : (
        <p className="m-0 text-ink-faint">{task.synced ? 'Sin descripción.' : 'Aún sin sincronizar con JIRA.'}</p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className={subheading}>Documentación</h3>
        {doc.data ? (
          <a href={`#/documentacion/tareas/${task.key}`} className="flex items-center gap-2 text-ink no-underline hover:underline">
            <BookOpen size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 truncate">Resumen de la tarea</span>
          </a>
        ) : (
          <p className="m-0 text-ink-faint">opencode escribe el resumen al cerrar la tarea.</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className={subheading}>Notas vinculadas</h3>
        {task.notes.length ? (
          <ul className="flex flex-col gap-1">
            {task.notes.map((n) => {
              const Icon = n.kind === 'link' ? Link2 : FileText;
              return (
                <li key={n.id}>
                  <a href={noteHref(n)} className="flex items-center gap-2 text-ink no-underline hover:underline">
                    <Icon size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 truncate">{n.title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-ink-faint">Ninguna. Escribe {task.key} en una nota para vincularla.</p>
        )}
      </div>
      <JiraUpdatesList updates={task.jiraUpdates} headingClass={subheading} />
    </aside>
  );
}
