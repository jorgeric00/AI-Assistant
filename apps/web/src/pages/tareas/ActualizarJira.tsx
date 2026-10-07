import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JiraUpdateEntry, TaskDetail } from '@dev-assistant/shared';
import { ArrowRight, CircleAlert, Info, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Modal } from '../../components/Modal';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { dayAndTime, hhmm, shortDay } from '../../dates';
import i18n from '../../i18n';

const hint = 'text-small text-ink-faint';
const checkbox = 'size-[18px] accent-accent';

/** Diálogo "Actualizar JIRA" (R3): comentario y/o cambio de estado que se envían solo al confirmar. */
export function ActualizarJiraDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation(['tasks', 'common']);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.jiraStatus, queryFn: api.jiraStatus });
  const transitions = useQuery({ queryKey: queryKeys.jiraTransitions(task.key), queryFn: () => api.jiraTransitions(task.key), staleTime: 0, retry: false });

  const [comentar, setComentar] = useState(true);
  const [comment, setComment] = useState('');
  const [cambiar, setCambiar] = useState(true);
  const [transitionId, setTransitionId] = useState<string>();

  const options = transitions.data ?? [];
  const selected = options.find((o) => o.id === transitionId) ?? options[0];
  const canChange = cambiar && !!selected;
  const sendsComment = comentar && comment.trim() !== '';

  const draft = useMutation({
    mutationFn: () => api.draftJiraComment(task.key, { targetStatus: canChange ? selected.to : undefined }),
    onSuccess: (d) => setComment(d.comment),
  });
  const send = useMutation({
    mutationFn: () => api.updateJira(task.key, { comment: sendsComment ? comment.trim() : undefined, transitionId: canChange ? selected.id : undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      onClose();
    },
    // Si falla a medias (comentario enviado, estado no) la ficha ya lo muestra registrado.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.key) }),
  });

  const writeProblem = status.data?.writeProblem;
  let summary = t('updateJira.nothingToSend');
  if (sendsComment && canChange) summary = t('updateJira.willSendBoth', { status: selected.to });
  else if (sendsComment) summary = t('updateJira.willSendComment');
  else if (canChange) summary = t('updateJira.willChangeStatus', { status: selected.to });
  else if (comentar && !comment.trim()) summary = t('updateJira.writeOrDraft');
  const nothing = !sendsComment && !canChange;

  const askDraft = () => {
    if (comment.trim() && !window.confirm(t('updateJira.confirmReplace'))) return;
    draft.mutate();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nothing && !writeProblem && !send.isPending) send.mutate();
  };

  return (
    <Modal labelledBy="actualizar-jira-titulo" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 id="actualizar-jira-titulo" className="m-0 text-title font-semibold">
            {t('updateJira.title')}
          </h1>
          <p className="m-0 text-ink-muted">
            <span className="font-mono text-code text-info">{task.key}</span> · {task.summary}
          </p>
        </div>

        {writeProblem && (
          <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-line p-3 text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t('updateJira.cannotWrite', { problem: writeProblem })}</span>
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input type="checkbox" checked={comentar} onChange={(e) => setComentar(e.target.checked)} className={checkbox} />
              {t('updateJira.addComment')}
            </label>
            <button type="button" onClick={askDraft} disabled={!comentar || draft.isPending} className={`${secondaryButtonClass} h-8 px-3 text-small`}>
              <Sparkles size={14} strokeWidth={1.5} className="text-accent" aria-hidden />
              {draft.isPending ? t('updateJira.drafting') : t('updateJira.draftWithAi')}
            </button>
          </div>
          <label htmlFor="jira-comentario" className="sr-only">
            {t('updateJira.comment')}
          </label>
          <textarea
            id="jira-comentario"
            rows={9}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={!comentar || draft.isPending}
            placeholder={t('updateJira.placeholder')}
            className={`${inputClass} h-auto resize-y py-2.5 leading-[21px] disabled:text-ink-faint`}
          />
          {draft.isError ? (
            <p role="alert" className="m-0 text-small text-danger">
              {draft.error.message}
            </p>
          ) : (
            <span className={hint}>
              {draft.data?.since
                ? t('updateJira.draftedSince', { when: dayAndTime(draft.data.since) })
                : t('updateJira.draftHint')}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 self-start font-medium">
            <input type="checkbox" checked={cambiar} onChange={(e) => setCambiar(e.target.checked)} className={checkbox} />
            {t('updateJira.changeStatus')}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-small whitespace-nowrap text-ink-muted">{task.status}</span>
            <ArrowRight size={16} strokeWidth={1.5} className="text-ink-muted" aria-hidden />
            <label htmlFor="jira-estado" className="sr-only">
              {t('updateJira.newStatus')}
            </label>
            <select
              id="jira-estado"
              value={selected?.id ?? ''}
              onChange={(e) => setTransitionId(e.target.value)}
              disabled={!cambiar || !options.length}
              className={`${inputClass} min-w-[200px] [color-scheme:dark] disabled:text-ink-faint`}
            >
              {transitions.isPending && <option value="">{t('common:status.loading')}</option>}
              {transitions.isSuccess && !options.length && <option value="">{t('updateJira.noneAvailable')}</option>}
              {transitions.isError && <option value="">{t('updateJira.notAvailable')}</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.to}
                  {o.name !== o.to ? ` (${o.name})` : ''}
                </option>
              ))}
            </select>
          </div>
          {transitions.isError ? (
            <p role="alert" className="m-0 text-small text-danger">
              {t('updateJira.transitionsError', { message: transitions.error.message })}
            </p>
          ) : (
            <span className={hint}>{t('updateJira.transitionsHint')}</span>
          )}
        </div>

        <p className="m-0 flex items-start gap-2 rounded-md border border-line bg-bg p-3">
          <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span aria-live="polite">{summary}</span>
        </p>

        {send.isError && (
          <p role="alert" className="m-0 flex items-start gap-2 text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {send.error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={hint}>
            <Trans t={t} i18nKey="updateJira.shortcuts" components={{ kbd: <kbd className="font-mono" /> }} />
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              {t('common:actions.cancel')}
            </button>
            <button type="submit" disabled={nothing || !!writeProblem || send.isPending || draft.isPending} className={primaryButtonClass}>
              {send.isPending ? t('updateJira.sending') : t('updateJira.send')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Botón que abre el diálogo; las tareas sin sincronizar no existen en JIRA y no se pueden actualizar. */
export function ActualizarJiraButton({ task, className }: { task: TaskDetail; className: string }) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!task.synced}
        title={task.synced ? undefined : t('updateJira.notFoundInJira')}
        className={className}
      >
        {t('updateJira.button')}
      </button>
      {open && <ActualizarJiraDialog task={task} onClose={() => setOpen(false)} />}
    </>
  );
}

function updateLabel(u: JiraUpdateEntry) {
  if (u.comment && u.transition) return i18n.t('tasks:updateJira.labelBoth');
  if (u.comment) return i18n.t('tasks:updateJira.labelComment');
  return i18n.t('tasks:updateJira.labelStatus');
}

/** Registro "Enviado a JIRA" de la ficha de la tarea. */
export function JiraUpdatesList({ updates, headingClass }: { updates: JiraUpdateEntry[]; headingClass: string }) {
  const { t } = useTranslation(['tasks', 'common']);
  if (!updates.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className={headingClass}>{t('updateJira.sentTitle')}</h3>
      <ul className="flex flex-col gap-2">
        {updates.map((u, i) => (
          <li key={`${u.at}-${i}`} className="flex gap-3">
            <span className="w-[76px] shrink-0 font-mono text-code text-ink-faint">
              {shortDay(u.at)} {hhmm(u.at)}
            </span>
            <div className="min-w-0 flex-1">
              <span>
                {updateLabel(u)}
                {u.transition && (
                  <span className="text-ink-muted">
                    {' '}
                    {u.transition.from} → {u.transition.to}
                  </span>
                )}
              </span>
              {u.comment && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-small text-info">{t('updateJira.viewComment')}</summary>
                  <p className="mt-1 mb-0 whitespace-pre-wrap break-words text-ink-muted">{u.comment}</p>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
