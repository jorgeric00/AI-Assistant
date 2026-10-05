import type { ReactNode } from 'react';

interface Props {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

/** Panel con título, sobre `surface` con borde `line` (diseño: tarjetas de la pantalla Hoy). */
export function Card({ title, action, children }: Props) {
  const id = `card-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 id={id} className="m-0 text-heading font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="m-0 py-2 text-ink-muted">{children}</p>;
}
