import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}

/** Etiquetas como chips: Intro o coma añade, Retroceso con el campo vacío quita la última. */
export function TagInput({ id, value, onChange, suggestions = [] }: Props) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const names = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const next = [...value, ...names.filter((n) => !value.includes(n))];
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2 py-1 focus-within:border-accent">
      {value.map((tag) => (
        <span key={tag} className="flex h-[26px] items-center gap-1 rounded-sm border border-line-strong pr-1 pl-2 text-small">
          {tag}
          <button
            type="button"
            aria-label={`Quitar ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="flex size-5 items-center justify-center text-ink-muted hover:text-ink"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={draft}
        list={`${id}-suggestions`}
        placeholder={value.length ? '' : 'Añadir etiqueta'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        className="h-7 min-w-[100px] grow border-0 bg-transparent text-ink outline-none placeholder:text-ink-faint"
      />
      <datalist id={`${id}-suggestions`}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
