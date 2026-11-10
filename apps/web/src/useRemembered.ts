import { useState } from 'react';

/** Estado que se recuerda mientras la app sigue abierta (al salir de una lista y volver). */
export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `ai-assistant.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved === null ? initial : (JSON.parse(saved) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Sin sessionStorage solo se olvida al recargar.
    }
  };
  return [value, set];
}
