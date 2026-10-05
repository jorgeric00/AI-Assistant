import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

/**
 * Diálogo modal: Esc cierra, Ctrl+Enter envía el formulario de dentro, Tab no sale del diálogo
 * y al cerrar el foco vuelve a donde estaba.
 */
export function Modal({ labelledBy, onClose, children, width = 'max-w-[640px]' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Solo el diálogo de más arriba atiende el teclado.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        ref.current?.querySelector('form')?.requestSubmit();
      } else if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>('input, textarea, select, button:not([disabled]), a[href]');
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
  }, [onClose]);

  useEffect(() => () => (previousFocus.current as HTMLElement | null)?.focus?.(), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/75 px-4 pt-[12vh] pb-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`flex w-full ${width} flex-col gap-4 rounded-lg border border-line-strong bg-surface p-6`}
      >
        {children}
      </div>
    </div>
  );
}
