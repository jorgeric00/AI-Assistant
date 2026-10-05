import { useState, type FormEvent } from 'react';
import { inputClass, secondaryButtonClass } from '../../components/fields';

/** Campo + "Añadir" para escribir una entrada manual. */
export function JournalAddForm({ onAdd, pending, placeholder }: { onAdd: (text: string) => Promise<unknown>; pending: boolean; placeholder: string }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await onAdd(text.trim());
    setText('');
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor="nueva-entrada" className="sr-only">
        Nueva entrada del diario
      </label>
      <input id="nueva-entrada" type="text" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} className={`${inputClass} min-w-0 grow`} />
      <button type="submit" disabled={pending || !text.trim()} className={secondaryButtonClass}>
        Añadir
      </button>
    </form>
  );
}
