import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AskResponse, Note } from '@dev-assistant/shared';
import { ExternalLink, FileText, Link2, MoreHorizontal, Pin, Plus, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { primaryButtonClass } from '../../components/fields';
import { dayAndTime, shortDay } from '../../dates';
import { navigate } from '../../sections';
import { NoteEditor } from './NoteEditor';

/** Sección "Notas y enlaces": `#/notas`, `#/notas/:id`, `#/notas/:id/editar` y `#/notas/nueva`. */
export function NotasPage({ params }: { params: string[] }) {
  const [first, second] = params;
  if (first === 'nueva') return <NoteEditor />;
  const id = first ? Number(first) : undefined;
  if (id && second === 'editar') return <NoteEditor noteId={id} />;
  return <NotesBrowser selectedId={id} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Primera línea útil del texto, sin marcas de Markdown, para la lista. */
function excerpt(note: Note): string {
  if (note.kind === 'link' && note.url) return note.url;
  const line = note.bodyMd
    .split('\n')
    .map((l) => l.replace(/^\s*(#+|[-*+]|\d+\.|>)\s*/, '').replace(/[`*_~[\]]/g, '').trim())
    .find(Boolean);
  return line ?? '';
}

type SearchMode = 'texto' | 'pregunta';

function NotesBrowser({ selectedId }: { selectedId?: number }) {
  const [mode, setMode] = useState<SearchMode>('texto');
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [archived, setArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(search.trim(), 200);
  const asking = mode === 'pregunta';
  // En modo pregunta la lista parte de todas las notas activas y luego muestra las relacionadas.
  const filter = asking ? {} : { q: q || undefined, tag, archived };

  const notes = useQuery({ queryKey: queryKeys.noteList(filter), queryFn: () => api.listNotes(filter), placeholderData: (prev) => prev });
  const tags = useQuery({ queryKey: queryKeys.tags, queryFn: api.listTags });
  const ask = useMutation({ mutationFn: (text: string) => api.ask(text) });

  const switchMode = (next: SearchMode) => {
    setMode(next);
    inputRef.current?.focus();
  };

  const answer = asking ? ask.data : undefined;
  const list = answer ? answer.sources.flatMap((s) => notes.data?.find((n) => n.id === s.id) ?? []) : (notes.data ?? []);
  const selected = list.find((n) => n.id === selectedId) ?? (selectedId === undefined ? list[0] : undefined);

  const chipClass = (active: boolean) =>
    `h-7 rounded-sm border px-2.5 text-small ${active ? 'border-accent bg-surface-raised text-ink' : 'border-line-strong text-ink-muted hover:text-ink'}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">Notas y enlaces</h1>
        <button type="button" onClick={() => navigate('notas/nueva')} className={primaryButtonClass}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          Nueva nota
        </button>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Lista de notas" className="flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div role="group" aria-label="Tipo de búsqueda" className="flex gap-1 self-start rounded-md border border-line bg-surface p-1">
              {(['texto', 'pregunta'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`h-8 rounded-sm px-3 text-[13px] ${mode === m ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`}
                >
                  {m === 'texto' ? 'Texto' : 'Pregunta'}
                </button>
              ))}
            </div>
            <form
              role="search"
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                if (asking && question.trim()) ask.mutate(question.trim());
              }}
            >
              <label htmlFor="buscar-notas" className="sr-only">
                {asking ? 'Pregunta sobre tus notas' : 'Buscar en notas'}
              </label>
              {asking ? (
                <Sparkles size={16} strokeWidth={1.5} className="absolute top-3 left-3 text-accent" aria-hidden />
              ) : (
                <Search size={16} strokeWidth={1.5} className="absolute top-3 left-3 text-ink-faint" aria-hidden />
              )}
              <input
                ref={inputRef}
                id="buscar-notas"
                type="search"
                value={asking ? question : search}
                onChange={(e) => (asking ? setQuestion(e.target.value) : setSearch(e.target.value))}
                placeholder={asking ? '¿Cómo se despliega en pre?' : 'Buscar en notas y enlaces'}
                className="h-10 w-full rounded-md border border-line-strong bg-surface-raised pr-3 pl-9 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </form>
            {asking ? (
              <p className="m-0 text-small text-ink-faint">Pulsa Enter. opencode responde solo con lo que hay en tus notas y enlaces no archivados.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={!tag} onClick={() => setTag(undefined)} className={chipClass(!tag)}>
                  Todas
                </button>
                {tags.data?.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    aria-pressed={tag === t.name}
                    onClick={() => setTag(tag === t.name ? undefined : t.name)}
                    className={chipClass(tag === t.name)}
                  >
                    {t.name}
                  </button>
                ))}
                <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)} className={chipClass(archived)}>
                  Archivadas
                </button>
              </div>
            )}
          </div>

          {asking && <AskResult pending={ask.isPending} error={ask.error} answer={answer} />}

          {notes.isError ? (
            <p className="m-0 text-danger">No se pudieron cargar las notas.</p>
          ) : notes.isPending ? (
            <p className="m-0 text-ink-muted">Cargando…</p>
          ) : asking && (ask.isPending || answer?.sources.length === 0) ? null : list.length === 0 ? (
            <p className="m-0 py-2 text-ink-muted">
              {q || tag ? 'No hay notas que coincidan.' : archived ? 'No hay notas archivadas.' : 'Aún no tienes notas. Crea una con "Nueva nota" o con Alt+N.'}
            </p>
          ) : (
            <ul aria-label={answer ? 'Notas relacionadas' : undefined} className="flex flex-col gap-1">
              {list.map((note) => (
                <li key={note.id}>
                  <NoteListItem note={note} active={note.id === selected?.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <NoteDetail note={selected} />
        ) : (
          list.length > 0 && <p className="flex-[999_1_420px] text-ink-muted">Esa nota no está en esta lista.</p>
        )}
      </div>
    </div>
  );
}

function AskResult({ pending, error, answer }: { pending: boolean; error: Error | null; answer?: AskResponse }) {
  if (pending) {
    return (
      <p role="status" className="m-0 flex items-center gap-2 rounded-lg border border-line bg-surface p-4 text-ink-muted">
        <Sparkles size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
        Pensando…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="m-0 rounded-lg border border-line bg-surface p-4 text-danger">
        {error.message}
      </p>
    );
  }
  if (!answer) return null;
  const cited = answer.sources.filter((s) => s.cited);
  return (
    <section aria-label="Respuesta" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <span className="flex items-center gap-2 text-small font-medium tracking-[.04em] text-ink-muted uppercase">
        <Sparkles size={14} strokeWidth={1.5} className="text-accent" aria-hidden />
        Respuesta
      </span>
      <Markdown>{answer.answer}</Markdown>
      {cited.length > 0 && (
        <ul className="m-0 flex flex-col gap-1 border-t border-line pt-3 text-small">
          {cited.map((s) => (
            <li key={s.id} className="flex gap-2">
              <span className="font-mono text-ink-faint">[{s.ref}]</span>
              <a href={`#/notas/${s.id}`} className="text-info">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteListItem({ note, active }: { note: Note; active: boolean }) {
  const Icon = note.kind === 'link' ? Link2 : FileText;
  const meta = [...note.tags];
  return (
    <a
      href={`#/notas/${note.id}`}
      aria-current={active ? 'true' : undefined}
      className={`flex flex-col gap-1 rounded-md p-3 text-ink no-underline ${active ? 'bg-surface-raised' : 'hover:bg-surface'}`}
    >
      <span className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 grow truncate font-medium">{note.title}</span>
        {note.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Fijada" />}
        <span className="shrink-0 text-small text-ink-faint">{shortDay(note.updatedAt)}</span>
      </span>
      {excerpt(note) && <span className="truncate text-[13px] text-ink-muted">{excerpt(note)}</span>}
      {(meta.length > 0 || note.tasks.length > 0) && (
        <span className="text-small text-ink-muted">
          {meta.join(' · ')}
          {meta.length > 0 && note.tasks.length > 0 && ' · '}
          {note.tasks.map((t, i) => (
            <code key={t.key} className="font-mono text-info">
              {i > 0 && ', '}
              {t.key}
            </code>
          ))}
        </span>
      )}
    </a>
  );
}

function NoteDetail({ note }: { note: Note }) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notes });
  const update = useMutation({ mutationFn: (patch: Partial<Pick<Note, 'pinned' | 'archived'>>) => api.updateNote(note.id, patch), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.deleteNote(note.id),
    onSuccess: async () => {
      await refresh();
      navigate('notas');
    },
  });

  const act = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const menuItem = 'h-9 rounded-sm px-3 text-left text-ink hover:bg-surface';

  return (
    <article aria-labelledby="nota-titulo" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id="nota-titulo" className="m-0 text-title font-semibold break-words">
            {note.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
            {note.pinned && (
              <span className="flex items-center gap-1 text-accent">
                <Pin size={12} aria-hidden />
                Fijada
              </span>
            )}
            {note.archived && <span>Archivada</span>}
            {note.tags.map((t) => (
              <span key={t} className="rounded-sm border border-line-strong px-1.5 py-0.5">
                {t}
              </span>
            ))}
            {note.tasks.length > 0 && (
              <span>
                Vinculada a{' '}
                {note.tasks.map((t, i) => (
                  <span key={t.key}>
                    {i > 0 && ', '}
                    <a href={`#/tareas/${t.key}`} className="font-mono text-info" title={t.synced ? t.summary : 'Aún sin sincronizar con JIRA'}>
                      {t.key}
                    </a>
                  </span>
                ))}
              </span>
            )}
            <span>Editada {dayAndTime(note.updatedAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`#/notas/${note.id}/editar`} className="flex h-9 items-center rounded-md border border-line-strong px-3 text-ink no-underline hover:bg-surface-raised">
            Editar
          </a>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="Más opciones"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex size-9 items-center justify-center rounded-md border border-line-strong text-ink hover:bg-surface-raised"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute top-10 right-0 z-10 flex w-48 flex-col rounded-md border border-line-strong bg-surface-raised p-1">
                <button type="button" role="menuitem" className={menuItem} onClick={act(() => update.mutate({ pinned: !note.pinned }))}>
                  {note.pinned ? 'Quitar de fijadas' : 'Fijar arriba'}
                </button>
                <button type="button" role="menuitem" className={menuItem} onClick={act(() => update.mutate({ archived: !note.archived }))}>
                  {note.archived ? 'Sacar del archivo' : 'Archivar'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItem} text-danger`}
                  onClick={act(() => window.confirm(`¿Eliminar "${note.title}"? No se puede deshacer.`) && remove.mutate())}
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {note.kind === 'link' && note.url && (
        <a href={note.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 self-start font-mono text-code break-all text-info">
          <ExternalLink size={14} className="shrink-0" aria-hidden />
          {note.url}
        </a>
      )}
      {note.bodyMd.trim() ? <Markdown>{note.bodyMd}</Markdown> : note.kind === 'note' && <p className="m-0 text-ink-muted">Sin texto.</p>}
    </article>
  );
}
