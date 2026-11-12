import type { TagCount } from '@dev-assistant/shared';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtro por etiqueta en un desplegable con buscador: con muchas etiquetas no llena la fila de filtros. */
export function TagFilter({ tags, value, onChange, chipClass }: { tags: TagCount[]; value: string | undefined; onChange: (tag: string | undefined) => void; chipClass: (active: boolean) => string }) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shown = tags.filter((tg) => fold(tg.name).includes(fold(query.trim())));
  const pick = (name: string) => {
    onChange(value === name ? undefined : name);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <div ref={root} className="relative">
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)} className={`${chipClass(!!value)} flex items-center gap-1.5`}>
          {value ? t('tagFilter.selected', { tag: value }) : t('tagFilter.label')}
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
        {open && (
          <div className="absolute top-9 left-0 z-10 flex w-64 flex-col gap-1.5 rounded-lg border border-line-strong bg-surface p-2 shadow-lg">
            <input
              ref={search}
              type="search"
              aria-label={t('tagFilter.search')}
              placeholder={t('tagFilter.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && shown.length === 1 && pick(shown[0]!.name)}
              className="h-8 rounded border border-info bg-surface-raised px-2 text-small text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <ul id={listId} role="listbox" aria-label={t('tagFilter.label')} className="m-0 flex max-h-44 list-none flex-col gap-0.5 overflow-y-auto p-0">
              {shown.map((tg) => (
                <li
                  key={tg.name}
                  role="option"
                  aria-selected={value === tg.name}
                  tabIndex={0}
                  onClick={() => pick(tg.name)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(tg.name))}
                  className={`flex cursor-pointer justify-between gap-2 rounded px-2 py-1 text-small hover:bg-surface-raised focus:bg-surface-raised focus:outline-none ${value === tg.name ? 'bg-surface-raised text-ink' : 'text-ink'}`}
                >
                  <span className="min-w-0 truncate">{tg.name}</span>
                  <span className="text-ink-faint">{tg.count}</span>
                </li>
              ))}
            </ul>
            {!shown.length && <span className="px-2 py-1 text-small text-ink-muted">{t('tagFilter.none')}</span>}
          </div>
        )}
      </div>
      {value && (
        <button type="button" aria-label={t('tagFilter.clear')} onClick={() => onChange(undefined)} className={`${chipClass(false)} flex items-center px-2`}>
          <X size={12} strokeWidth={2} aria-hidden />
        </button>
      )}
    </>
  );
}
