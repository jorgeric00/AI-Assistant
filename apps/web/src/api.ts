import type { LinkTitleResponse, Note, NoteInput, NoteUpdate, TagCount } from '@dev-assistant/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface NotesFilter {
  q?: string;
  tag?: string;
  archived?: boolean;
}

export const api = {
  listNotes: ({ q, tag, archived }: NotesFilter) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (archived) params.set('archived', 'true');
    return request<Note[]>('GET', `/api/notes?${params}`);
  },
  getNote: (id: number) => request<Note>('GET', `/api/notes/${id}`),
  createNote: (input: NoteInput) => request<Note>('POST', '/api/notes', input),
  updateNote: (id: number, input: NoteUpdate) => request<Note>('PATCH', `/api/notes/${id}`, input),
  deleteNote: (id: number) => request<void>('DELETE', `/api/notes/${id}`),
  listTags: () => request<TagCount[]>('GET', '/api/tags'),
  linkTitle: (url: string) => request<LinkTitleResponse>('GET', `/api/link-title?url=${encodeURIComponent(url)}`),
};

/** Claves de consulta de React Query; invalidar `notes` refresca listas, notas y etiquetas. */
export const queryKeys = {
  notes: ['notes'] as const,
  noteList: (filter: NotesFilter) => ['notes', 'list', filter] as const,
  note: (id: number) => ['notes', 'one', id] as const,
  tags: ['notes', 'tags'] as const,
};
