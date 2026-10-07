import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommitRef, Note, NoteKind } from '@dev-assistant/shared';
import { CircleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { LinkTitleHint } from '../pages/notas/NoteEditor';
import { isHttpUrl, useLinkTitle } from '../pages/notas/useLinkTitle';
import { ReminderForm } from '../pages/recordatorios/ReminderForm';
import { Modal } from './Modal';
import { TagInput } from './TagInput';
import { CommitSelect, TaskOptions } from './TaskFields';
import { noteHref } from '../sections';
import { TASK_KEY_RE, inputClass, labelClass, parseTaskKeys, primaryButtonClass, secondaryButtonClass } from './fields';

export interface Saved {
  message: string;
  href: string;
}

interface Props {
  onClose: () => void;
  onSaved: (saved: Saved) => void;
}

type CaptureKind = NoteKind | 'reminder';

/** Captura rápida (Alt+N): nota, enlace o recordatorio sin salir de la pantalla actual. */
export function QuickCapture({ onClose, onSaved }: Props) {
  const { t } = useTranslation('common');
  const [kind, setKind] = useState<CaptureKind>('note');
  const kindClass = (active: boolean) =>
    `h-8 rounded-sm px-3 text-[13px] ${active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`;
  const tabs: { kind: CaptureKind; label: string }[] = [
    { kind: 'note', label: t('quickCapture.kinds.note') },
    { kind: 'link', label: t('quickCapture.kinds.link') },
    { kind: 'reminder', label: t('quickCapture.kinds.reminder') },
  ];

  return (
    <Modal labelledBy="captura-titulo" onClose={onClose}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="captura-titulo" className="m-0 text-title font-semibold">
          {t('quickCapture.title')}
        </h1>
        <div role="group" aria-label={t('quickCapture.typeGroup')} className="flex gap-1 rounded-md border border-line bg-bg p-1">
          {tabs.map((tab) => (
            <button key={tab.kind} type="button" aria-pressed={kind === tab.kind} onClick={() => setKind(tab.kind)} className={kindClass(kind === tab.kind)}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {kind === 'reminder' ? (
        <ReminderForm onCancel={onClose} onSaved={() => onSaved({ message: t('quickCapture.saved.reminder'), href: '#/recordatorios' })} />
      ) : (
        <NoteCapture
          kind={kind}
          onCancel={onClose}
          onSaved={(note) => onSaved({ message: note.kind === 'link' ? t('quickCapture.saved.link') : t('quickCapture.saved.note'), href: noteHref(note) })}
        />
      )}
    </Modal>
  );
}

function NoteCapture({ kind, onCancel, onSaved }: { kind: NoteKind; onCancel: () => void; onSaved: (note: Note) => void }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const tagsQuery = useQuery({ queryKey: queryKeys.tags(kind), queryFn: () => api.listTags(kind) });
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [taskText, setTaskText] = useState('');
  const [commitPick, setCommitPick] = useState<{ task: string | null; commit: CommitRef | null }>({ task: null, commit: null });
  // El commit es de la primera tarea escrita; si cambia la tarea, deja de valer.
  const commitTask = parseTaskKeys(taskText)[0] ?? null;
  const commit = kind === 'note' && commitTask && commitPick.task === commitTask ? commitPick.commit : null;
  const [error, setError] = useState<string | null>(null);
  const linkTitle = useLinkTitle(title, setTitle);
  const save = useMutation({
    mutationFn: () =>
      api.createNote({
        kind,
        title: title.trim(),
        bodyMd,
        url: kind === 'link' ? url.trim() : null,
        urlTitle: kind === 'link' ? linkTitle.urlTitle : null,
        tags,
        taskKeys: parseTaskKeys(taskText),
        commit,
      }),
    onSuccess: async (note) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes });
      onSaved(note);
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (kind === 'link' && !isHttpUrl(url.trim())) return setError(t('quickCapture.errors.url'));
    if (!title.trim()) return setError(t('quickCapture.errors.title'));
    const badKey = parseTaskKeys(taskText).find((k) => !TASK_KEY_RE.test(k));
    if (badKey) return setError(t('quickCapture.errors.badKey', { key: badKey }));
    setError(null);
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {kind === 'link' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cap-url" className={labelClass}>
            {t('quickCapture.fields.url')}
          </label>
          <input
            id="cap-url"
            type="url"
            value={url}
            placeholder="https://"
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => linkTitle.lookup(e.clipboardData.getData('text'))}
            onBlur={() => linkTitle.lookup(url)}
            className={`${inputClass} font-mono text-code`}
          />
          <LinkTitleHint status={linkTitle.status} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cap-titulo" className={labelClass}>
          {t('quickCapture.fields.title')}
        </label>
        <input id="cap-titulo" type="text" value={title} autoFocus={kind === 'note'} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cap-texto" className={labelClass}>
          {t('quickCapture.fields.text')}
        </label>
        <textarea
          id="cap-texto"
          value={bodyMd}
          placeholder={kind === 'link' ? t('quickCapture.placeholders.linkBody') : t('quickCapture.placeholders.noteBody')}
          onChange={(e) => setBodyMd(e.target.value)}
          className="min-h-[120px] resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor="cap-tags" className={labelClass}>
            {t('quickCapture.fields.tags')}
          </label>
          <TagInput id="cap-tags" value={tags} onChange={setTags} suggestions={tagsQuery.data?.map((tag) => tag.name)} />
        </div>
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor="cap-tarea" className={labelClass}>
            {t('quickCapture.fields.task')}
          </label>
          <input
            id="cap-tarea"
            type="text"
            list="cap-tareas"
            value={taskText}
            placeholder="ABC-123"
            onChange={(e) => setTaskText(e.target.value)}
            className={`${inputClass} font-mono text-code text-info`}
          />
          <TaskOptions id="cap-tareas" />
        </div>
        {kind === 'note' && (
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
            <label htmlFor="cap-commit" className={labelClass}>
              {t('quickCapture.fields.commit')}
            </label>
            <CommitSelect id="cap-commit" taskKey={commitTask} value={commit} onChange={(c) => setCommitPick({ task: commitTask, commit: c })} />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-ink-faint">
          <Trans t={t} i18nKey="quickCapture.shortcuts" components={{ kbd: <kbd className="font-mono" /> }} />
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('actions.cancel')}
          </button>
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
