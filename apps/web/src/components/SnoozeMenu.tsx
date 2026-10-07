import { SNOOZE_OPTIONS, type SnoozeInput } from '@dev-assistant/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Botón "Posponer" con las tres opciones acordadas. */
export function SnoozeMenu({ onSnooze, up = false }: { onSnooze: (until: SnoozeInput['until']) => void; /** Abre el menú hacia arriba. */ up?: boolean }) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-8 rounded-md border border-line-strong px-2.5 text-[13px] text-ink hover:bg-surface-raised"
      >
        {t('snooze.button')}
      </button>
      {open && (
        <div role="menu" aria-label={t('snooze.button')} className={`absolute right-0 z-20 ${up ? 'bottom-9' : 'top-9'} flex w-[220px] flex-col rounded-md border border-line-strong bg-surface-raised p-1`}>
          {SNOOZE_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSnooze(o);
              }}
              className="h-9 rounded-sm px-3 text-left text-ink hover:bg-surface"
            >
              {t(`snooze.${o}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
