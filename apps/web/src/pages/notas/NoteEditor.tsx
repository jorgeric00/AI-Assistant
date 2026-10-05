import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Note, NoteKind } from '@dev-assistant/shared';
import { CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
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
import { navigate } from '../../sections';
import { isHttpUrl, useLinkTitle } from './useLinkTitle';

/** Pantalla "Editar nota o enlace" (diseño: NotaEditor). Sin `noteId` crea una nota nueva. */
export function NoteEditor({ noteId }: { noteId?: number }) {
  const existing = useQuery({
    queryKey: queryKeys.note(noteId ?? 0),
    queryFn: () => api.getNote(noteId!),
    enabled: noteId !== undefined,
  });

  if (noteId !== undefined && !existing.data) {
    return <p className="text-ink-muted">{existing.isError ? 'No se encontró la nota.' : 'Cargando…'}</p>;
  }
  return <EditorForm key={noteId ?? 'nueva'} note={existing.data} />;
}

function EditorForm({ note }: { note?: Note }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const tagsQuery = useQuery({ queryKey: queryKeys.tags, queryFn: api.listTags });

  const [kind, setKind] = useState<NoteKind>(note?.kind ?? 'note');
  const [url, setUrl] = useState(note?.url ?? '');
  const [title, setTitle] = useState(note?.title ?? '');
  const [bodyMd, setBodyMd] = useState(note?.bodyMd ?? '');
  const [tags, setTags] = useState(note?.tags ?? []);
  const [taskText, setTaskText] = useState(note?.tasks.map((t) => t.key).join(', ') ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<string | null>(null);
  const linkTitle = useLinkTitle(title, setTitle);

  const taskKeys = parseTaskKeys(taskText);
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
        pinned,
      };
      return note ? api.updateNote(note.id, input) : api.createNote(input);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes });
      navigate(`notas/${saved.id}`);
    },
    onError: (e) => setError(e.message),
  });

  const cancel = () => navigate(note ? `notas/${note.id}` : 'notas');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return setError('Escribe un título.');
    if (kind === 'link' && !isHttpUrl(url.trim())) return setError('Escribe una URL que empiece por http:// o https://.');
    const badKey = taskKeys.find((k) => !TASK_KEY_RE.test(k));
    if (badKey) return setError(`"${badKey}" no es una clave de JIRA (ej.: ABC-123).`);
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
  const kindClass = (active: boolean) =>
    `h-8 rounded-sm px-3 text-[13px] ${active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <a href="#/notas" className="text-ink-muted no-underline hover:text-ink">
            Notas y enlaces
          </a>
          <span className="text-line-strong">/</span>
          <h1 className="m-0 text-display font-semibold">{note ? 'Editar' : 'Nueva'}</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} className={secondaryButtonClass}>
            Cancelar
          </button>
          <button type="submit" form={`${ids}-form`} disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </header>

      <form id={`${ids}-form`} onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <div role="group" aria-label="Tipo" className="flex gap-1 self-start rounded-md border border-line bg-bg p-1">
          <button type="button" aria-pressed={kind === 'note'} onClick={() => setKind('note')} className={kindClass(kind === 'note')}>
            Nota
          </button>
          <button type="button" aria-pressed={kind === 'link'} onClick={() => setKind('link')} className={kindClass(kind === 'link')}>
            Enlace
          </button>
        </div>

        {kind === 'link' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-url`} className={labelClass}>
              URL
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
            Título
          </label>
          <input
            id={`${ids}-title`}
            type="text"
            value={title}
            autoFocus={!note && kind === 'note'}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} text-[16px] font-medium`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span id={`${ids}-body-label`} className={labelClass}>
              Texto (Markdown)
            </span>
            <div role="tablist" aria-label="Modo del editor" className="flex gap-1">
              <button type="button" role="tab" aria-selected={mode === 'write'} onClick={() => setMode('write')} className={tabClass(mode === 'write')}>
                Escribir
              </button>
              <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')} className={tabClass(mode === 'preview')}>
                Vista previa
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
              {bodyMd.trim() ? <Markdown>{bodyMd}</Markdown> : <p className="m-0 text-ink-muted">Nada que mostrar todavía.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor={`${ids}-tags`} className={labelClass}>
              Etiquetas
            </label>
            <TagInput id={`${ids}-tags`} value={tags} onChange={setTags} suggestions={tagsQuery.data?.map((t) => t.name)} />
          </div>
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor={`${ids}-task`} className={labelClass}>
              Vincular a tarea de JIRA
            </label>
            <input
              id={`${ids}-task`}
              type="text"
              value={taskText}
              placeholder="Clave, p. ej. ABC-123"
              onChange={(e) => setTaskText(e.target.value)}
              className={`${inputClass} font-mono text-code text-info`}
            />
            {unsyncedKeys.length > 0 && (
              <span className="text-small text-ink-muted">Aún sin sincronizar con JIRA. Se enlazará sola cuando llegue la tarea.</span>
            )}
          </div>
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
            Fijar arriba en la lista
          </label>
          <span className="text-small text-ink-faint">
            <kbd className="font-mono">Ctrl+Enter</kbd> guardar · <kbd className="font-mono">Esc</kbd> cancelar
          </span>
        </div>
      </form>
    </div>
  );
}

export function LinkTitleHint({ status }: { status: ReturnType<typeof useLinkTitle>['status'] }) {
  if (status === 'idle') return null;
  return (
    <span className="flex items-center gap-1.5 text-small text-ink-muted">
      {status === 'loading' && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
      {status === 'found' && <CircleCheck size={12} className="text-success" aria-hidden />}
      {status === 'loading' && 'Buscando el título de la página…'}
      {status === 'found' && 'Título obtenido de la página. Puedes cambiarlo.'}
      {status === 'not-found' && 'No se pudo obtener el título; escríbelo tú.'}
    </span>
  );
}
