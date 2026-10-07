import { useQuery } from '@tanstack/react-query';
import type { TaskDoc } from '@dev-assistant/shared';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { dayAndTime, shortDay } from '../../dates';
import { navigate } from '../../sections';
import { NoteEditor } from '../notas/NoteEditor';
import { NotesBrowser } from '../notas/NotasPage';

/**
 * Sección "Documentación" con dos pestañas:
 * - De tareas (`#/documentacion`, `#/documentacion/tareas/:clave`): el RESUMEN.md que escribe opencode al cerrar cada tarea.
 * - Propia (`#/documentacion/propia`, `.../propia/:id`, `.../propia/:id/editar`, `.../propia/nuevo`): documentos escritos a mano.
 */
export function DocumentacionPage({ params }: { params: string[] }) {
  const [tab, first, second] = params;
  if (tab === 'propia') {
    if (first === 'nuevo') return <NoteEditor kind="doc" />;
    const id = first ? Number(first) : undefined;
    if (id && second === 'editar') return <NoteEditor noteId={id} />;
    return (
      <Layout tab="propia">
        <NotesBrowser kind="doc" selectedId={id} />
      </Layout>
    );
  }
  return (
    <Layout tab="tareas">
      <TaskDocsBrowser selectedKey={tab === 'tareas' ? first?.toUpperCase() : undefined} />
    </Layout>
  );
}

function Layout({ tab, children }: { tab: 'tareas' | 'propia'; children: ReactNode }) {
  const { t } = useTranslation(['notes', 'common']);
  const tabClass = (active: boolean) =>
    `h-9 border-b-2 px-3 ${active ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">{t('docs.title')}</h1>
        <button type="button" onClick={() => navigate('documentacion/propia/nuevo')} className={primaryButtonClass}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          {t('docs.newDoc')}
        </button>
      </header>
      <div role="tablist" aria-label={t('docs.tabsLabel')} className="-mt-2 flex gap-1 border-b border-line">
        <button type="button" role="tab" aria-selected={tab === 'tareas'} onClick={() => navigate('documentacion')} className={tabClass(tab === 'tareas')}>
          {t('docs.tabTasks')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'propia'} onClick={() => navigate('documentacion/propia')} className={tabClass(tab === 'propia')}>
          {t('docs.tabOwn')}
        </button>
      </div>
      <div role="tabpanel">{children}</div>
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

function TaskDocsBrowser({ selectedKey }: { selectedKey?: string }) {
  const { t } = useTranslation(['notes', 'common']);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 200);
  const docs = useQuery({ queryKey: queryKeys.taskDocs(q), queryFn: () => api.listTaskDocs(q || undefined), placeholderData: (prev) => prev });
  const list = docs.data ?? [];
  const key = selectedKey ?? list[0]?.key;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label={t('docs.taskDocs')} className="flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-3">
        <div role="search" className="relative">
          <label htmlFor="buscar-doc" className="sr-only">
            {t('docs.search')}
          </label>
          <Search size={16} strokeWidth={1.5} className="absolute top-3 left-3 text-ink-faint" aria-hidden />
          <input
            id="buscar-doc"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('docs.search')}
            className="h-10 w-full rounded-md border border-line-strong bg-surface-raised pr-3 pl-9 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
        <p className="m-0 text-small text-ink-faint">{t('docs.hint')}</p>
        {docs.isError ? (
          <p className="m-0 text-danger">{t('docs.loadError')}</p>
        ) : docs.isPending ? (
          <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
        ) : list.length === 0 ? (
          <p className="m-0 py-2 text-ink-muted">
            {q ? t('docs.noMatches') : t('docs.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((d) => (
              <li key={d.key}>
                <TaskDocItem doc={d} active={d.key === key} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {key && <TaskDocView taskKey={key} />}
    </div>
  );
}

function TaskDocItem({ doc, active }: { doc: TaskDoc; active: boolean }) {
  const { t } = useTranslation(['notes', 'common']);
  const meta = [...doc.repos, doc.prCount ? t('docs.prCount', { count: doc.prCount }) : ''].filter(Boolean);
  return (
    <a
      href={`#/documentacion/tareas/${doc.key}`}
      aria-current={active ? 'true' : undefined}
      className={`flex flex-col gap-1 rounded-md p-3 text-ink no-underline ${active ? 'bg-surface-raised' : 'hover:bg-surface'}`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 grow truncate font-medium">
          <code className="mr-1.5 font-mono font-normal text-info">{doc.key}</code>
          {doc.title}
        </span>
        <span className="shrink-0 text-small text-ink-faint">{shortDay(doc.updatedAt)}</span>
      </span>
      {meta.length > 0 && <span className="truncate text-small text-ink-muted">{meta.join(' · ')}</span>}
    </a>
  );
}

/** Quita el título "# CLAVE · ...": ya va en la cabecera. */
function withoutTitle(markdown: string) {
  return markdown.replace(/^\s*#\s+.*\n?/, '');
}

function TaskDocView({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation(['notes', 'common']);
  const doc = useQuery({ queryKey: queryKeys.taskDoc(taskKey), queryFn: () => api.getTaskDoc(taskKey), retry: false });
  if (!doc.data) {
    return <p className="flex-[999_1_420px] text-ink-muted">{doc.isError ? doc.error.message : t('common:status.loading')}</p>;
  }
  const d = doc.data;
  return (
    <article aria-labelledby="doc-titulo" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id="doc-titulo" className="m-0 text-title font-semibold break-words">
            <code className="mr-2 font-mono font-normal text-info">{d.key}</code>
            {d.title}
          </h2>
          <span className="text-small text-ink-muted">{t('docs.updated', { when: dayAndTime(d.updatedAt) })}</span>
        </div>
        <a href={`#/tareas/${d.key}/detalle`} className={`${secondaryButtonClass} no-underline`}>
          {t('docs.viewTask')}
        </a>
      </div>
      <Markdown>{withoutTitle(d.markdown)}</Markdown>
    </article>
  );
}
