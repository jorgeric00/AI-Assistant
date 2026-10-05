import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Note, NoteKind } from '@dev-assistant/shared';
import { CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, queryKeys } from '../api';
import { LinkTitleHint } from '../pages/notas/NoteEditor';
import { isHttpUrl, useLinkTitle } from '../pages/notas/useLinkTitle';
import { TagInput } from './TagInput';
import { TASK_KEY_RE, inputClass, labelClass, parseTaskKeys, primaryButtonClass, secondaryButtonClass } from './fields';

interface Props {
  onClose: () => void;
  onSaved: (note: Note) => void;
}

/** Captura rápida (Alt+N): nota o enlace sin salir de la pantalla actual. */
export function QuickCapture({ onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const tagsQuery = useQuery({ queryKey: queryKeys.tags, queryFn: api.listTags });
  const [kind, setKind] = useState<NoteKind>('note');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [taskText, setTaskText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const linkTitle = useLinkTitle(title, setTitle);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<Element | null>(document.activeElement);

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
      }),
    onSuccess: async (note) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes });
      onSaved(note);
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (kind === 'link' && !isHttpUrl(url.trim())) return setError('Escribe una URL que empiece por http:// o https://.');
    if (!title.trim()) return setError('Escribe un título.');
    const badKey = parseTaskKeys(taskText).find((k) => !TASK_KEY_RE.test(k));
    if (badKey) return setError(`"${badKey}" no es una clave de JIRA (ej.: ABC-123).`);
    setError(null);
    save.mutate();
  };

  // Esc cierra, Ctrl+Enter guarda, y el foco no sale del diálogo con Tab.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>('input, textarea, button:not([disabled])');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => () => (previousFocus.current as HTMLElement | null)?.focus?.(), []);

  const kindClass = (active: boolean) =>
    `h-8 rounded-sm px-3 text-[13px] ${active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/75 px-4 pt-[12vh] pb-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="captura-titulo"
        onSubmit={submit}
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-lg border border-line-strong bg-surface p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="captura-titulo" className="m-0 text-title font-semibold">
            Captura rápida
          </h1>
          <div role="group" aria-label="Tipo" className="flex gap-1 rounded-md border border-line bg-bg p-1">
            <button type="button" aria-pressed={kind === 'note'} onClick={() => setKind('note')} className={kindClass(kind === 'note')}>
              Nota
            </button>
            <button type="button" aria-pressed={kind === 'link'} onClick={() => setKind('link')} className={kindClass(kind === 'link')}>
              Enlace
            </button>
            <button type="button" aria-pressed="false" disabled title="Llega con los recordatorios" className="h-8 cursor-not-allowed rounded-sm px-3 text-[13px] text-ink-faint">
              Recordatorio
            </button>
          </div>
        </div>

        {kind === 'link' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cap-url" className={labelClass}>
              URL
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
            Título
          </label>
          <input id="cap-titulo" type="text" value={title} autoFocus={kind === 'note'} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cap-texto" className={labelClass}>
            Texto (Markdown)
          </label>
          <textarea
            id="cap-texto"
            value={bodyMd}
            placeholder={kind === 'link' ? 'Por qué te interesa (opcional)' : 'Escribe la nota'}
            onChange={(e) => setBodyMd(e.target.value)}
            className="min-h-[120px] resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-[1_1_200px] flex-col gap-1.5">
            <label htmlFor="cap-tags" className={labelClass}>
              Etiquetas
            </label>
            <TagInput id="cap-tags" value={tags} onChange={setTags} suggestions={tagsQuery.data?.map((t) => t.name)} />
          </div>
          <div className="flex flex-[1_1_200px] flex-col gap-1.5">
            <label htmlFor="cap-tarea" className={labelClass}>
              Vincular a tarea
            </label>
            <input
              id="cap-tarea"
              type="text"
              value={taskText}
              placeholder="ABC-123"
              onChange={(e) => setTaskText(e.target.value)}
              className={`${inputClass} font-mono text-code text-info`}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 text-danger">
            <CircleAlert size={16} aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-small text-ink-faint">
            <kbd className="font-mono">Esc</kbd> cerrar · <kbd className="font-mono">Ctrl+Enter</kbd> guardar
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancelar
            </button>
            <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
