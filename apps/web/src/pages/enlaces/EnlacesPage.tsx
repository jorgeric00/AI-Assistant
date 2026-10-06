import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Note } from '@dev-assistant/shared';
import { MoreHorizontal, Pin, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, queryKeys } from '../../api';
import { primaryButtonClass } from '../../components/fields';
import { navigate } from '../../sections';
import { NoteEditor } from '../notas/NoteEditor';

/** Sección "Enlaces de interés": `#/enlaces`, `#/enlaces/:id` (fila resaltada), `#/enlaces/:id/editar` y `#/enlaces/nuevo`. */
export function EnlacesPage({ params }: { params: string[] }) {
  const [first, second] = params;
  if (first === 'nuevo') return <NoteEditor kind="link" />;
  const id = first ? Number(first) : undefined;
  if (id && second === 'editar') return <NoteEditor noteId={id} />;
  return <LinksTable selectedId={id} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function domain(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return url ?? '';
  }
}

function LinksTable({ selectedId }: { selectedId?: number }) {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [archived, setArchived] = useState(false);
  const q = useDebounced(search.trim(), 200);
  const filter = { kind: 'link' as const, q: q || undefined, tag, archived };
  const links = useQuery({ queryKey: queryKeys.noteList(filter), queryFn: () => api.listNotes(filter), placeholderData: (prev) => prev });
  const tags = useQuery({ queryKey: queryKeys.tags('link'), queryFn: () => api.listTags('link') });

  const chipClass = (active: boolean) =>
    `h-7 rounded-sm border px-2.5 text-small ${active ? 'border-accent bg-surface-raised text-ink' : 'border-line-strong text-ink-muted hover:text-ink'}`;
  const th = 'px-4 py-2.5 text-left text-small font-medium text-ink-muted';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">Enlaces de interés</h1>
        <button type="button" onClick={() => navigate('enlaces/nuevo')} className={primaryButtonClass}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          Nuevo enlace
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div role="search" className="relative flex-[0_1_420px]">
          <label htmlFor="buscar-enlaces" className="sr-only">
            Buscar en enlaces
          </label>
          <Search size={16} strokeWidth={1.5} className="absolute top-3 left-3 text-ink-faint" aria-hidden />
          <input
            id="buscar-enlaces"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en enlaces"
            className="h-10 w-full rounded-md border border-line-strong bg-surface-raised pr-3 pl-9 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!tag} onClick={() => setTag(undefined)} className={chipClass(!tag)}>
            Todos
          </button>
          {tags.data?.map((t) => (
            <button key={t.name} type="button" aria-pressed={tag === t.name} onClick={() => setTag(tag === t.name ? undefined : t.name)} className={chipClass(tag === t.name)}>
              {t.name}
            </button>
          ))}
          <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)} className={chipClass(archived)}>
            Archivados
          </button>
        </div>
      </div>

      {links.isError ? (
        <p className="m-0 text-danger">No se pudieron cargar los enlaces.</p>
      ) : links.isPending ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : !links.data.length ? (
        <p className="m-0 text-ink-muted">
          {q || tag ? 'No hay enlaces que coincidan.' : archived ? 'No hay enlaces archivados.' : 'Aún no tienes enlaces. Guarda uno con "Nuevo enlace" o con Alt+N.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Enlace
                </th>
                <th scope="col" className={th}>
                  Etiquetas
                </th>
                <th scope="col" className={th}>
                  Tarea
                </th>
                <th scope="col" className={`${th} w-14`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.data.map((link) => (
                <LinkRow key={link.id} link={link} active={link.id === selectedId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-small text-ink-faint">Al pegar una URL, la app rellena el título de la página. Se abren en una pestaña nueva.</p>
    </div>
  );
}

function LinkRow({ link, active }: { link: Note; active: boolean }) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'center' });
  }, [active]);

  return (
    <tr ref={rowRef} aria-current={active ? 'true' : undefined} className={`border-t border-line align-top ${active ? 'bg-surface-raised' : ''}`}>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5">
          {link.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Fijado" />}
          <a href={link.url ?? '#/enlaces'} target="_blank" rel="noreferrer" className="font-medium break-words text-info">
            {link.title}
          </a>
        </span>
        <div className="font-mono text-small text-ink-faint">{domain(link.url)}</div>
        {link.bodyMd.trim() && <div className="mt-1 line-clamp-2 text-small text-ink-muted">{link.bodyMd}</div>}
      </td>
      <td className="px-4 py-3 text-small text-ink-muted">{link.tags.join(' · ') || <span className="text-ink-faint">—</span>}</td>
      <td className="px-4 py-3">
        {link.tasks.length ? (
          link.tasks.map((t, i) => (
            <span key={t.key}>
              {i > 0 && ', '}
              <a href={`#/tareas/${t.key}/detalle`} className="font-mono text-code text-info" title={t.synced ? t.summary : 'Aún sin sincronizar con JIRA'}>
                {t.key}
              </a>
            </span>
          ))
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        <RowMenu link={link} />
      </td>
    </tr>
  );
}

function RowMenu({ link }: { link: Note }) {
  const queryClient = useQueryClient();
  // Posición fija junto al botón: la tabla tiene scroll y recortaría un menú absoluto en las últimas filas.
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : e.type === 'scroll' || e.type === 'resize' || !ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (button: HTMLElement) => {
    if (open) return setOpen(null);
    const r = button.getBoundingClientRect();
    const menuHeight = 160;
    setOpen({ top: r.bottom + menuHeight + 4 > window.innerHeight ? r.top - menuHeight - 4 : r.bottom + 4, right: window.innerWidth - r.right });
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notes });
  const update = useMutation({ mutationFn: (patch: Partial<Pick<Note, 'pinned' | 'archived'>>) => api.updateNote(link.id, patch), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.deleteNote(link.id), onSuccess: refresh });
  const act = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };
  const item = 'h-9 rounded-sm px-3 text-left text-ink hover:bg-surface';

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Más opciones de ${link.title}`}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(e) => toggle(e.currentTarget)}
        className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" style={{ top: open.top, right: open.right }} className="fixed z-10 flex w-48 flex-col rounded-md border border-line-strong bg-surface-raised p-1">
          <button type="button" role="menuitem" className={item} onClick={act(() => navigate(`enlaces/${link.id}/editar`))}>
            Editar
          </button>
          <button type="button" role="menuitem" className={item} onClick={act(() => update.mutate({ pinned: !link.pinned }))}>
            {link.pinned ? 'Quitar de fijados' : 'Fijar arriba'}
          </button>
          <button type="button" role="menuitem" className={item} onClick={act(() => update.mutate({ archived: !link.archived }))}>
            {link.archived ? 'Sacar del archivo' : 'Archivar'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${item} text-danger`}
            onClick={act(() => window.confirm(`¿Eliminar "${link.title}"? No se puede deshacer.`) && remove.mutate())}
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}
