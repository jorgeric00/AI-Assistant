import { useQuery } from '@tanstack/react-query';
import type { CommitRef } from '@dev-assistant/shared';
import { api, queryKeys } from '../api';
import { TASK_KEY_RE, inputClass } from './fields';

const commitId = (c: { repo: string; sha: string }) => `${c.repo}@${c.sha}`;

/** Sugerencias para los campos de tarea: las tareas abiertas sincronizadas de JIRA. */
export function TaskOptions({ id }: { id: string }) {
  const tasks = useQuery({ queryKey: queryKeys.taskList(false), queryFn: () => api.listTasks(false) });
  return (
    <datalist id={id}>
      {tasks.data?.map((t) => (
        <option key={t.key} value={t.key}>
          {t.summary}
        </option>
      ))}
    </datalist>
  );
}

/**
 * Commit de la tarea (opcional): los que opencode ha anotado en su HISTORIAL.md.
 * Sin tarea válida no hay commits que elegir.
 */
export function CommitSelect({ id, taskKey, value, onChange }: { id: string; taskKey: string | null; value: CommitRef | null; onChange: (commit: CommitRef | null) => void }) {
  const key = taskKey && TASK_KEY_RE.test(taskKey) ? taskKey : null;
  const dev = useQuery({ queryKey: queryKeys.taskDev(key ?? ''), queryFn: () => api.getTaskDev(key!), enabled: !!key });
  const options: CommitRef[] = (dev.data?.history ?? []).map((h) => ({ repo: h.repo, sha: h.sha, url: h.url, text: h.text }));
  if (value && !options.some((o) => commitId(o) === commitId(value))) options.unshift(value);

  return (
    <select
      id={id}
      value={value ? commitId(value) : ''}
      disabled={!key || !options.length}
      onChange={(e) => onChange(options.find((o) => commitId(o) === e.target.value) ?? null)}
      className={`${inputClass} min-w-0 disabled:text-ink-faint`}
    >
      <option value="">{!key ? 'Elige antes una tarea' : dev.isPending ? 'Cargando…' : options.length ? 'Sin commit' : 'La tarea aún no tiene commits'}</option>
      {options.map((o) => (
        <option key={commitId(o)} value={commitId(o)}>
          {commitId(o)} · {o.text}
        </option>
      ))}
    </select>
  );
}

/** "checkout-web@a3f91c2", enlazado al commit en GitHub si se conoce la URL. */
export function CommitLink({ commit }: { commit: CommitRef }) {
  const label = <code className="font-mono">{commitId(commit)}</code>;
  return commit.url ? (
    <a href={commit.url} target="_blank" rel="noreferrer" className="text-info" title={commit.text}>
      {label}
    </a>
  ) : (
    <span className="text-info" title={commit.text}>
      {label}
    </span>
  );
}
