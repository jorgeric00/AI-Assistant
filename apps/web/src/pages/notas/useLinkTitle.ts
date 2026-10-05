import { useRef, useState } from 'react';
import { api } from '../../api';

export type LinkTitleStatus = 'idle' | 'loading' | 'found' | 'not-found';

export function isHttpUrl(text: string): boolean {
  try {
    return /^https?:$/.test(new URL(text).protocol);
  } catch {
    return false;
  }
}

/**
 * Trae el título de la página al pegar o salir del campo URL. Solo sobrescribe el título si está
 * vacío o si aún es el que se trajo antes (no pisa lo que hayas escrito tú).
 */
export function useLinkTitle(title: string, setTitle: (t: string) => void) {
  const [status, setStatus] = useState<LinkTitleStatus>('idle');
  const [urlTitle, setUrlTitle] = useState<string | null>(null);
  const lastUrl = useRef<string | null>(null);

  const lookup = async (url: string) => {
    const trimmed = url.trim();
    if (!isHttpUrl(trimmed) || trimmed === lastUrl.current) return;
    lastUrl.current = trimmed;
    setStatus('loading');
    try {
      const { title: found } = await api.linkTitle(trimmed);
      if (lastUrl.current !== trimmed) return;
      setStatus(found ? 'found' : 'not-found');
      if (found && (!title.trim() || title === urlTitle)) setTitle(found);
      setUrlTitle(found);
    } catch {
      setStatus('not-found');
    }
  };

  return { status, urlTitle, lookup };
}
