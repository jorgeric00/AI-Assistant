import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AskResponse, Note, NoteKind } from '@dev-assistant/shared';
import { ExternalLink, FileText, Link2, MoreHorizontal, Pin, Plus, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { primaryButtonClass } from '../../components/fields';
import { dayAndTime, shortDay } from '../../dates';
import { CommitLink } from '../../components/TaskFields';
import { navigate, noteHref } from '../../sections';
import { KIND_INFO, NoteEditor } from './NoteEditor';

/** Sección "Notas": `#/notas`, `#/notas/:id`, `#/notas/:id/editar` y `#/notas/nueva`. */
export function NotasPage({ params }: { params: string[] }) {
  const { t } = useTranslation(['notes', 'common']);
  const [first, second] = params;
  const id = first && first !== 'nueva' ? Number(first) : undefined;
  // Los enlaces y documentos antiguos (#/notas/:id) se abren en su sección.
  const target = useQuery({ queryKey: queryKeys.note(id ?? 0), queryFn: () => api.getNote(id!), enabled: id !== undefined });
  useEffect(() => {
    if (target.data && target.data.kind !== 'note') window.location.replace(noteHref(target.data));
  }, [target.data]);

  if (first === 'nueva') return <NoteEditor kind="note" />;
  if (id && second === 'editar') return <NoteEditor noteId={id} />;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">{t('notesPage.title')}</h1>
        <button type="button" onClick={() => navigate('notas/nueva')} className={primaryButtonClass}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          {t('notesPage.newNote')}
        </button>
      </header>
      <NotesBrowser kind="note" selectedId={id} />
    </div>
  );
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

/** Lista con búsqueda y la nota elegida al lado. Las notas (kind note) además filtran por tarea y admiten preguntas a la IA. */
export function NotesBrowser({ kind, selectedId }: { kind: NoteKind; selectedId?: number }) {
  const { t } = useTranslation(['notes', 'common']);
  const isNote = kind === 'note';
  const [mode, setMode] = useState<SearchMode>('texto');
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [archived, setArchived] = useState(false);
  const [withTask, setWithTask] = useState<'con' | 'sin' | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(search.trim(), 200);
  const asking = isNote && mode === 'pregunta';
  // En modo pregunta la lista parte de todas las notas activas y luego muestra las relacionadas.
  const filter = asking ? { kind } : { kind, q: q || undefined, tag, archived, task: withTask };

  const notes = useQuery({ queryKey: queryKeys.noteList(filter), queryFn: () => api.listNotes(filter), placeholderData: (prev) => prev });
  const tags = useQuery({ queryKey: queryKeys.tags(kind), queryFn: () => api.listTags(kind) });
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
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label={isNote ? t('browser.notesList') : t('browser.ownDocs')} className="flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-3">
          <div className="flex flex-col gap-2">
            {isNote && <div role="group" aria-label={t('browser.searchType')} className="flex gap-1 self-start rounded-md border border-line bg-surface p-1">
              {(['texto', 'pregunta'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`h-8 rounded-sm px-3 text-[13px] ${mode === m ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink'}`}
                >
                  {m === 'texto' ? t('browser.modeText') : t('browser.modeQuestion')}
                </button>
              ))}
            </div>}
            <form
              role="search"
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                if (asking && question.trim()) ask.mutate(question.trim());
              }}
            >
              <label htmlFor="buscar-notas" className="sr-only">
                {asking ? t('browser.askLabel') : isNote ? t('browser.searchNotes') : t('browser.searchDocs')}
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
                placeholder={asking ? t('browser.askPlaceholder') : isNote ? t('browser.searchNotes') : t('browser.searchDocs')}
                className="h-10 w-full rounded-md border border-line-strong bg-surface-raised pr-3 pl-9 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </form>
            {asking ? (
              <p className="m-0 text-small text-ink-faint">{t('browser.askHint')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={!tag && !withTask}
                  onClick={() => {
                    setTag(undefined);
                    setWithTask(undefined);
                  }}
                  className={chipClass(!tag && !withTask)}
                >
                  {t('browser.all')}
                </button>
                {isNote &&
                  (['con', 'sin'] as const).map((w) => (
                    <button key={w} type="button" aria-pressed={withTask === w} onClick={() => setWithTask(withTask === w ? undefined : w)} className={chipClass(withTask === w)}>
                      {w === 'con' ? t('browser.withTask') : t('browser.withoutTask')}
                    </button>
                  ))}
                {tags.data?.map((tg) => (
                  <button
                    key={tg.name}
                    type="button"
                    aria-pressed={tag === tg.name}
                    onClick={() => setTag(tag === tg.name ? undefined : tg.name)}
                    className={chipClass(tag === tg.name)}
                  >
                    {tg.name}
                  </button>
                ))}
                <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)} className={chipClass(archived)}>
                  {isNote ? t('browser.archivedNotes') : t('browser.archivedDocs')}
                </button>
              </div>
            )}
          </div>

          {asking && <AskResult pending={ask.isPending} error={ask.error} answer={answer} />}

          {notes.isError ? (
            <p className="m-0 text-danger">{t('browser.loadError')}</p>
          ) : notes.isPending ? (
            <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
          ) : asking && (ask.isPending || answer?.sources.length === 0) ? null : list.length === 0 ? (
            <p className="m-0 py-2 text-ink-muted">
              {q || tag || withTask
                ? t(`kinds.${kind}.noMatches`)
                : archived
                  ? t(`kinds.${kind}.noArchived`)
                  : isNote
                    ? t('browser.emptyNotes')
                    : t('browser.emptyDocs')}
            </p>
          ) : (
            <ul aria-label={answer ? t('browser.relatedNotes') : undefined} className="flex flex-col gap-1">
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
          list.length > 0 && <p className="flex-[999_1_420px] text-ink-muted">{isNote ? t('browser.noteNotInList') : t('browser.docNotInList')}</p>
        )}
      </div>
  );
}

function AskResult({ pending, error, answer }: { pending: boolean; error: Error | null; answer?: AskResponse }) {
  const { t } = useTranslation(['notes', 'common']);
  if (pending) {
    return (
      <p role="status" className="m-0 flex items-center gap-2 rounded-lg border border-line bg-surface p-4 text-ink-muted">
        <Sparkles size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
        {t('ask.thinking')}
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
    <section aria-label={t('ask.answer')} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <span className="flex items-center gap-2 text-small font-medium tracking-[.04em] text-ink-muted uppercase">
        <Sparkles size={14} strokeWidth={1.5} className="text-accent" aria-hidden />
        {t('ask.answer')}
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
  const { t } = useTranslation(['notes', 'common']);
  const Icon = note.kind === 'link' ? Link2 : FileText;
  const meta = [...note.tags];
  return (
    <a
      href={noteHref(note)}
      aria-current={active ? 'true' : undefined}
      className={`flex flex-col gap-1 rounded-md p-3 text-ink no-underline ${active ? 'bg-surface-raised' : 'hover:bg-surface'}`}
    >
      <span className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 grow truncate font-medium">{note.title}</span>
        {note.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label={t('detail.pinnedNote')} />}
        <span className="shrink-0 text-small text-ink-faint">{shortDay(note.updatedAt)}</span>
      </span>
      {excerpt(note) && <span className="truncate text-[13px] text-ink-muted">{excerpt(note)}</span>}
      {(meta.length > 0 || note.tasks.length > 0) && (
        <span className="text-small text-ink-muted">
          {meta.join(' · ')}
          {meta.length > 0 && note.tasks.length > 0 && ' · '}
          {note.tasks.map((task, i) => (
            <code key={task.key} className="font-mono text-info">
              {i > 0 && ', '}
              {task.key}
            </code>
          ))}
          {note.commit && (
            <>
              {' · '}
              <code className="font-mono text-info">
                {note.commit.repo}@{note.commit.sha}
              </code>
            </>
          )}
        </span>
      )}
    </a>
  );
}

export function NoteDetail({ note }: { note: Note }) {
  const { t } = useTranslation(['notes', 'common']);
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
      navigate(KIND_INFO[note.kind].section);
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
                {t('detail.pinnedNote')}
              </span>
            )}
            {note.archived && <span>{note.kind === 'note' ? t('detail.archivedNote') : t('detail.archivedOther')}</span>}
            {note.tags.map((tg) => (
              <span key={tg} className="rounded-sm border border-line-strong px-1.5 py-0.5">
                {tg}
              </span>
            ))}
            {note.tasks.length > 0 && (
              <span>
                {note.kind === 'note' ? t('detail.task') : t('detail.linkedTo')}{' '}
                {note.tasks.map((task, i) => (
                  <span key={task.key}>
                    {i > 0 && ', '}
                    <a href={`#/tareas/${task.key}`} className="font-mono text-info" title={task.synced ? task.summary : t('detail.notSynced')}>
                      {task.key}
                    </a>
                  </span>
                ))}
              </span>
            )}
            {note.commit && (
              <span>
                · {t('detail.commit')} <CommitLink commit={note.commit} /> “{note.commit.text}”
              </span>
            )}
            <span>{t(note.kind === 'note' ? 'detail.editedNote' : 'detail.editedOther', { when: dayAndTime(note.updatedAt) })}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`${noteHref(note)}/editar`} className="flex h-9 items-center rounded-md border border-line-strong px-3 text-ink no-underline hover:bg-surface-raised">
            {t('common:actions.edit')}
          </a>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={t('detail.moreOptions')}
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
                  {note.pinned ? t('detail.unpinNote') : t('detail.pinTop')}
                </button>
                <button type="button" role="menuitem" className={menuItem} onClick={act(() => update.mutate({ archived: !note.archived }))}>
                  {note.archived ? t('detail.unarchive') : t('detail.archive')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItem} text-danger`}
                  onClick={act(() => window.confirm(t('detail.confirmDelete', { title: note.title })) && remove.mutate())}
                >
                  {t('detail.delete')}
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
      {note.bodyMd.trim() ? <Markdown>{note.bodyMd}</Markdown> : note.kind === 'note' && <p className="m-0 text-ink-muted">{t('detail.noText')}</p>}
    </article>
  );
}
