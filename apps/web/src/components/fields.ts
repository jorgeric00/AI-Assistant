/** Clases compartidas de los campos de formulario (diseño: inputs sobre surface-raised, borde fuerte). */
export const inputClass =
  'h-10 rounded-md border border-line-strong bg-surface-raised px-3 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none';
export const labelClass = 'text-small text-ink-muted';
export const primaryButtonClass =
  'flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-ink hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-faint';

/** "ABC-123, abc-7" → ['ABC-123', 'ABC-7']. */
export function parseTaskKeys(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((k) => k.trim().toUpperCase()).filter(Boolean))];
}

export const TASK_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
