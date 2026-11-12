import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskImportPreview } from '@dev-assistant/shared';
import { CircleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { navigate } from '../../sections';

/** Pestaña «Importar de JIRA» de Nueva tarea: se pega el ID o el enlace, se mira la tarea y se importa. */
export function ImportarTarea({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('tasks');
  const queryClient = useQueryClient();
  const [ref, setRef] = useState('');
  const [found, setFound] = useState<TaskImportPreview | null>(null);

  const look = useMutation({
    mutationFn: () => api.previewTaskImport(ref.trim()),
    onSuccess: setFound,
    onError: () => setFound(null),
  });
  const run = useMutation({
    mutationFn: () => api.importTask(ref.trim()),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      onClose();
      navigate(`tareas/${task.key}/detalle`);
    },
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (ref.trim() && !look.isPending) look.mutate();
  };
  const error = look.error ?? run.error;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={search} className="flex flex-col gap-1.5">
        <label htmlFor="imp-ref" className="font-medium">
          {t('import.ref')}
        </label>
        <div className="flex gap-2">
          <input
            id="imp-ref"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setFound(null);
              look.reset();
              run.reset();
            }}
            placeholder={t('import.placeholder')}
            autoFocus
            className={`${inputClass} min-w-0 flex-1 font-mono text-code`}
          />
          <button type="submit" disabled={!ref.trim() || look.isPending} className={`${secondaryButtonClass} h-10`}>
            {look.isPending ? t('import.searching') : t('import.search')}
          </button>
        </div>
        <span className="text-small text-ink-faint">{t('import.hint')}</span>
      </form>

      {error && (
        <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-line p-3 text-danger">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error.message}</span>
        </p>
      )}

      {found && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-info bg-bg p-3.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="font-mono text-code text-ink-muted">{found.key}</span>
            {found.issueType && <span className="rounded-sm border border-line px-1.5 text-small text-ink-muted">{found.issueType}</span>}
            <span className="rounded-sm border border-line px-1.5 text-small text-ink-muted">{found.status}</span>
          </div>
          <strong className="font-semibold">{found.summary}</strong>
          <span className="text-small text-ink-muted">
            {[found.assignee ? t('import.assignedTo', { name: found.assignee }) : t('import.unassigned'), found.project && t('import.project', { project: found.project })]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {found.inApp ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`tareas/${found.key}/detalle`);
                }}
                className={`${primaryButtonClass} h-10`}
              >
                {t('import.open')}
              </button>
              <span className="text-small text-ink-muted">{t('import.inApp')}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className={`${primaryButtonClass} h-10`}>
                {run.isPending ? t('import.importing') : t('import.run')}
              </button>
              <span className="text-small text-ink-muted">{t('import.noChanges')}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={onClose} className={`${secondaryButtonClass} h-10`}>
          {t('import.close')}
        </button>
      </div>
    </div>
  );
}

/** Etiqueta «Importada · de Luis Pérez» de las tareas que se trajeron de otra persona. */
export function ImportedBadge({ assignee }: { assignee: string | null }) {
  const { t } = useTranslation('tasks');
  return (
    <span className="rounded-sm border border-info px-1.5 py-0.5 text-small whitespace-nowrap text-info">
      {assignee ? t('import.badgeFrom', { name: assignee }) : t('import.badge')}
    </span>
  );
}

/** Quita de la app una tarea importada (no toca nada en JIRA). */
export function RemoveImportedButton({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation('tasks');
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.removeTask(taskKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      navigate('tareas');
    },
  });
  return (
    <button
      type="button"
      disabled={remove.isPending}
      title={remove.isError ? remove.error.message : t('import.removeHint')}
      onClick={() => window.confirm(t('import.confirmRemove', { key: taskKey })) && remove.mutate()}
      className={secondaryButtonClass}
    >
      {t('import.remove')}
    </button>
  );
}
