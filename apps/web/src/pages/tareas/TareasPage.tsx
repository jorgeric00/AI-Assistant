import { useQuery } from '@tanstack/react-query';
import type { Task, TaskDetail } from '@dev-assistant/shared';
import { ExternalLink, FileText, Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, queryKeys } from '../../api';
import { primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { timeAgo } from '../../dates';
import { ActualizarJiraButton, JiraUpdatesList } from './ActualizarJira';
import { SesionPage } from './SesionPage';
import { TareaDetallePage } from './TareaDetallePage';
import { useJiraSync, useTaskList } from './useTasks';

/** Sección "Tareas de JIRA": `#/tareas`, `#/tareas/:clave` (ficha a la derecha), `#/tareas/:clave/detalle` y `#/tareas/:clave/sesion`. */
export function TareasPage({ params }: { params: string[] }) {
  const selectedKey = params[0]?.toUpperCase();
  if (selectedKey && params[1] === 'detalle') return <TareaDetallePage taskKey={selectedKey} />;
  if (selectedKey && params[1] === 'sesion') return <SesionPage taskKey={selectedKey} />;
  return <TaskBrowser selectedKey={selectedKey} />;
}

function TaskBrowser({ selectedKey }: { selectedKey?: string }) {
  const [showDone, setShowDone] = useState(false);
  const { status, sync } = useJiraSync();
  const tasks = useTaskList(showDone);

  const list = tasks.data ?? [];
  const current = selectedKey ?? list[0]?.key;
  const configured = status.data?.configured;
  const lastSyncedAt = status.data?.lastSyncedAt;
  const user = status.data?.user;
  const syncing = sync.isPending || status.data?.syncing;
  const error = sync.error?.message ?? status.data?.lastError;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-display font-semibold">Tareas de JIRA</h1>
          <p className="mt-1 mb-0 text-ink-muted">
            {user ? `Asignadas a ${user}` : 'Asignadas a ti'}
            {lastSyncedAt ? ` · sincronizado ${timeAgo(lastSyncedAt)}` : configured ? ' · aún sin sincronizar' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-[18px] accent-accent" />
            Mostrar terminadas
          </label>
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={!configured || syncing}
            className={`${secondaryButtonClass} bg-surface-raised font-medium`}
          >
            <RefreshCw size={16} strokeWidth={1.5} className={syncing ? 'animate-spin' : undefined} aria-hidden />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
      </header>

      {configured === false && <NotConfigured />}
      {configured && error && (
        <p role="alert" className="m-0 rounded-lg border border-line bg-surface p-4 text-danger">
          {error}
        </p>
      )}

      {tasks.isError ? (
        <p className="m-0 text-danger">No se pudieron cargar las tareas.</p>
      ) : tasks.isPending ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : list.length === 0 ? (
        configured && (
          <p className="m-0 py-2 text-ink-muted">
            {syncing
              ? 'Sincronizando con JIRA…'
              : status.data?.lastCount === 0
                ? 'JIRA no devolvió ninguna tarea asignada a ti.'
                : lastSyncedAt
                  ? showDone
                    ? 'No tienes tareas asignadas.'
                    : 'No tienes tareas pendientes.'
                  : 'Pulsa "Sincronizar" para traer tus tareas.'}
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <TaskTable tasks={list} current={current} />
          {current && <TaskPanel taskKey={current} />}
        </div>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <section aria-labelledby="jira-config" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 id="jira-config" className="m-0 text-heading font-semibold">
        Conecta JIRA
      </h2>
      <p className="m-0 text-ink-muted">
        Añade al fichero <code className="font-mono text-code">.env</code> de la app la URL de JIRA y tu token personal, y reinicia la app:
      </p>
      <pre className="m-0 overflow-x-auto rounded-md bg-bg p-3 font-mono text-code text-ink">
        {'JIRA_URL=https://jira.tuempresa.com\nJIRA_TOKEN=tu-token-personal'}
      </pre>
      <p className="m-0 text-small text-ink-faint">En JIRA Cloud (*.atlassian.net) añade también JIRA_EMAIL con tu email.</p>
    </section>
  );
}

function StatusBadge({ task }: { task: Task }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-small whitespace-nowrap ${task.synced ? 'border-line-strong text-ink-muted' : 'border-dashed border-line-strong text-ink-faint'}`}
      title={task.synced ? undefined : 'Creada desde una nota; no se ha encontrado en JIRA'}
    >
      {task.synced ? task.status : 'Sin sincronizar'}
    </span>
  );
}

function TaskTable({ tasks, current }: { tasks: Task[]; current?: string }) {
  const th = 'border-b border-line py-3 font-medium';
  return (
    <div className="max-w-full min-w-0 flex-[999_1_520px] overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[480px] border-collapse">
        <thead>
          <tr className="text-left text-small text-ink-muted">
            <th scope="col" className={`${th} px-4`}>
              Clave
            </th>
            <th scope="col" className={`${th} px-2`}>
              Resumen
            </th>
            <th scope="col" className={`${th} pr-4 pl-2`}>
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const active = t.key === current;
            return (
              <tr key={t.key} className={`border-b border-line last:border-b-0 ${active ? 'bg-surface-raised' : ''}`}>
                <td className="px-4 py-3">
                  <a href={`#/tareas/${t.key}`} aria-current={active ? 'true' : undefined} className="font-mono text-code text-info">
                    {t.key}
                  </a>
                </td>
                <td className="px-2 py-3">{t.summary === t.key ? <span className="text-ink-faint">Sin resumen</span> : t.summary}</td>
                <td className="py-3 pr-4 pl-2">
                  <StatusBadge task={t} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskPanel({ taskKey }: { taskKey: string }) {
  const task = useQuery({ queryKey: queryKeys.task(taskKey), queryFn: () => api.getTask(taskKey) });
  const shell = 'flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-4 rounded-lg border border-line bg-surface p-4';
  if (task.isError) return <p className={`${shell} m-0 text-ink-muted`}>{task.error.message}</p>;
  if (!task.data) return <p className={`${shell} m-0 text-ink-muted`}>Cargando…</p>;
  return <TaskDetailView task={task.data} className={shell} />;
}

function TaskDetailView({ task, className }: { task: TaskDetail; className: string }) {
  const meta = task.synced
    ? [task.status, task.priority && `Prioridad ${task.priority}`, task.issueType, task.project].filter(Boolean)
    : ['Aún sin sincronizar con JIRA'];
  const heading = 'm-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase';
  return (
    <aside aria-labelledby="tarea-titulo" className={className}>
      <div className="flex flex-col gap-1">
        {task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start font-mono text-code text-info">
            {task.key}
            <ExternalLink size={12} strokeWidth={1.5} aria-label="(abre JIRA)" />
          </a>
        ) : (
          <span className="font-mono text-code text-ink-muted">{task.key}</span>
        )}
        <h2 id="tarea-titulo" className="m-0 text-title font-semibold break-words">
          {task.summary}
        </h2>
        <p className="m-0 text-small text-ink-muted">{meta.join(' · ')}</p>
      </div>

      {task.description ? (
        <p className="m-0 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-ink-muted">{task.description}</p>
      ) : (
        task.synced && <p className="m-0 text-ink-faint">Sin descripción.</p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={heading}>Notas vinculadas</h3>
        {task.notes.length ? (
          <ul className="flex flex-col gap-1">
            {task.notes.map((n) => {
              const Icon = n.kind === 'link' ? Link2 : FileText;
              return (
                <li key={n.id}>
                  <a href={`#/notas/${n.id}`} className="flex items-center gap-2 text-ink no-underline hover:underline">
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

      <JiraUpdatesList updates={task.jiraUpdates} headingClass={heading} />

      <div className="flex flex-wrap gap-2">
        <a href={`#/tareas/${task.key}/detalle`} className={`${secondaryButtonClass} no-underline`}>
          Ver detalle
        </a>
        <a href={`#/tareas/${task.key}/sesion`} className={`${secondaryButtonClass} no-underline`}>
          Sesión de desarrollo
        </a>
        <ActualizarJiraButton task={task} className={primaryButtonClass} />
      </div>
    </aside>
  );
}
