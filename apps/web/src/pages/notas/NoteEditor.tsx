import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommitRef, Note, NoteKind } from '@dev-assistant/shared';
import { CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { TagInput } from '../../components/TagInput';
import {
  TASK_KEY_RE,
  inputClass,
  labelClass,
  parseTaskKeys,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/fields';
import { CommitSelect, TaskOptions } from '../../components/TaskFields';
import { navigate, noteHref } from '../../sections';
import { isHttpUrl, useLinkTitle } from './useLinkTitle';

/** Dónde vive cada tipo: sección de vuelta. Sus textos están en notes:kinds.<kind>. */
export const KIND_INFO: Record<NoteKind, { section: string }> = {
  note: { section: 'notas' },
  link: { section: 'enlaces' },
  doc: { section: 'documentacion/propia' },
};

/** Pantalla de edición de una nota, un enlace o un documento propio (diseño: NotaEditor). Sin `noteId` crea uno nuevo de tipo `kind`. */
export function NoteEditor({ noteId, kind = 'note' }: { noteId?: number; kind?: NoteKind }) {
  const existing = useQuery({
    queryKey: queryKeys.note(noteId ?? 0),
    queryFn: () => api.getNote(noteId!),
    enabled: noteId !== undefined,
  });
  const { t } = useTranslation(['notes', 'common']);

  if (noteId !== undefined && !existing.data) {
    return <p className="text-ink-muted">{existing.isError ? t('editor.notFound') : t('common:status.loading')}</p>;
  }
  return <EditorForm key={noteId ?? 'nueva'} note={existing.data} newKind={kind} />;
}

function EditorForm({ note, newKind }: { note?: Note; newKind: NoteKind }) {
  const { t } = useTranslation(['notes', 'common']);
  const queryClient = useQueryClient();
  const ids = useId();
  const kind = note?.kind ?? newKind;
  const info = KIND_INFO[kind];
  const tagsQuery = useQuery({ queryKey: queryKeys.tags(kind), queryFn: () => api.listTags(kind) });

  const [url, setUrl] = useState(note?.url ?? '');
  const [title, setTitle] = useState(note?.title ?? '');
  const [bodyMd, setBodyMd] = useState(note?.bodyMd ?? '');
  const [tags, setTags] = useState(note?.tags ?? []);
  const [taskText, setTaskText] = useState(note?.tasks.map((t) => t.key).join(', ') ?? '');
  // El commit se elige para una tarea concreta: si cambia la tarea, deja de valer.
  const [commitPick, setCommitPick] = useState<{ task: string | null; commit: CommitRef | null }>({ task: note?.tasks[0]?.key ?? null, commit: note?.commit ?? null });
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<string | null>(null);
  const linkTitle = useLinkTitle(title, setTitle);

  const taskKeys = kind === 'doc' ? [] : parseTaskKeys(taskText);
  // El commit es de la primera tarea vinculada.
  const commitTask = taskKeys[0] ?? null;
  const commitToSave = kind === 'note' && commitTask && commitPick.task === commitTask ? commitPick.commit : null;
  const syncedKeys = new Set(note?.tasks.filter((t) => t.synced).map((t) => t.key));
  const unsyncedKeys = taskKeys.filter((k) => !syncedKeys.has(k));

  const save = useMutation({
    mutationFn: () => {
      const input = {
        kind,
        title: title.trim(),
        bodyMd,
        url: kind === 'link' ? url.trim() : null,
        urlTitle: kind === 'link' ? (linkTitle.urlTitle ?? note?.urlTitle ?? null) : null,
        tags,
        taskKeys,
        commit: commitToSave,
        pinned,
      };
      return note ? api.updateNote(note.id, input) : api.createNote(input);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes });
      navigate(noteHref(saved).slice(2));
    },
    onError: (e) => setError(e.message),
  });

  const cancel = () => navigate(note ? noteHref(note).slice(2) : info.section);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return setError(t('editor.titleRequired'));
    if (kind === 'link' && !isHttpUrl(url.trim())) return setError(t('editor.urlRequired'));
    const badKey = taskKeys.find((k) => !TASK_KEY_RE.test(k));
    if (badKey) return setError(t('editor.badTaskKey', { key: badKey }));
    setError(null);
    save.mutate();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return; // la captura rápida está encima
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const tabClass = (active: boolean) =>
    `h-7 rounded-sm border px-2.5 text-small text-ink ${active ? 'border-accent' : 'border-line-strong hover:border-ink-muted'}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <a href={`#/${info.section}`} className="text-ink-muted no-underline hover:text-ink">
            {t(`kinds.${kind}.label`)}
          </a>
          <span className="text-line-strong">/</span>
          <h1 className="m-0 text-display font-semibold">{note ? t(`kinds.${kind}.edit`) : t(`kinds.${kind}.new`)}</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} className={secondaryButtonClass}>
            {t('common:actions.cancel')}
          </button>
          <button type="submit" form={`${ids}-form`} disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
          </button>
        </div>
      </header>

      <form id={`${ids}-form`} onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        {kind === 'link' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-url`} className={labelClass}>
              {t('editor.url')}
            </label>
            <input
              id={`${ids}-url`}
              type="url"
              value={url}
              placeholder="https://"
              autoFocus={!note}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => linkTitle.lookup(e.clipboardData.getData('text'))}
              onBlur={() => linkTitle.lookup(url)}
              className={`${inputClass} font-mono text-code`}
            />
            <LinkTitleHint status={linkTitle.status} />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-title`} className={labelClass}>
            {t('editor.title')}
          </label>
          <input
            id={`${ids}-title`}
            type="text"
            value={title}
            autoFocus={!note && kind !== 'link'}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} text-[16px] font-medium`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span id={`${ids}-body-label`} className={labelClass}>
              {t('editor.body')}
            </span>
            <div role="tablist" aria-label={t('editor.editorMode')} className="flex gap-1">
              <button type="button" role="tab" aria-selected={mode === 'write'} onClick={() => setMode('write')} className={tabClass(mode === 'write')}>
                {t('editor.write')}
              </button>
              <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')} className={tabClass(mode === 'preview')}>
                {t('editor.preview')}
              </button>
            </div>
          </div>
          {mode === 'write' ? (
            <textarea
              aria-labelledby={`${ids}-body-label`}
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              className="min-h-[260px] resize-y rounded-md border border-line-strong bg-surface-raised p-3 font-mono text-code text-ink focus:border-accent focus:outline-none"
            />
          ) : (
            <div className="min-h-[260px] rounded-md border border-line bg-bg p-3">
              {bodyMd.trim() ? <Markdown>{bodyMd}</Markdown> : <p className="m-0 text-ink-muted">{t('editor.nothingToShow')}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor={`${ids}-tags`} className={labelClass}>
              {t('editor.tags')}
            </label>
            <TagInput id={`${ids}-tags`} value={tags} onChange={setTags} suggestions={tagsQuery.data?.map((t) => t.name)} />
          </div>
          {kind !== 'doc' && (
            <div className="flex flex-[1_1_280px] flex-col gap-1.5">
              <label htmlFor={`${ids}-task`} className={labelClass}>
                {t('editor.linkTask')}
              </label>
              <input
                id={`${ids}-task`}
                type="text"
                list={`${ids}-tasks`}
                value={taskText}
                placeholder={t('editor.taskPlaceholder')}
                onChange={(e) => setTaskText(e.target.value)}
                className={`${inputClass} font-mono text-code text-info`}
              />
              <TaskOptions id={`${ids}-tasks`} />
              {unsyncedKeys.length > 0 && (
                <span className="text-small text-ink-muted">{t('editor.notSyncedHint')}</span>
              )}
            </div>
          )}
          {kind === 'note' && (
            <div className="flex flex-[1_1_280px] flex-col gap-1.5">
              <label htmlFor={`${ids}-commit`} className={labelClass}>
                {t('editor.commit')}
              </label>
              <CommitSelect id={`${ids}-commit`} taskKey={commitTask} value={commitToSave} onChange={(c) => setCommitPick({ task: commitTask, commit: c })} />
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 text-danger">
            <CircleAlert size={16} aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-[18px] accent-accent" />
            {t('editor.pinTop')}
          </label>
          <span className="text-small text-ink-faint">
            <Trans t={t} i18nKey="editor.shortcuts" components={{ kbd: <kbd className="font-mono" /> }} />
          </span>
        </div>
      </form>
    </div>
  );
}

export function LinkTitleHint({ status }: { status: ReturnType<typeof useLinkTitle>['status'] }) {
  const { t } = useTranslation(['notes', 'common']);
  if (status === 'idle') return null;
  return (
    <span className="flex items-center gap-1.5 text-small text-ink-muted">
      {status === 'loading' && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
      {status === 'found' && <CircleCheck size={12} className="text-success" aria-hidden />}
      {status === 'loading' && t('linkTitle.loading')}
      {status === 'found' && t('linkTitle.found')}
      {status === 'not-found' && t('linkTitle.notFound')}
    </span>
  );
}
