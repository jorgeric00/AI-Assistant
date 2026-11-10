import { Bell, Book, BookOpen, FileText, GitBranch, GitPullRequest, Link2, MessageSquare, SlidersHorizontal, SquareCheck, Sun, type LucideIcon } from 'lucide-react';
import type { NoteKind } from '@dev-assistant/shared';

// Secciones del menú lateral (diseño "AI-Assistant · Pantallas").
export const SECTIONS = [
// El nombre visible de cada una se traduce al pintarla: t('common:sections.<id>').
  { id: 'hoy', icon: Sun },
  { id: 'chat', icon: MessageSquare, shortcut: 'Alt+C' },
  { id: 'documentacion', icon: BookOpen },
  { id: 'notas', icon: FileText },
  { id: 'enlaces', icon: Link2 },
  { id: 'recordatorios', icon: Bell },
  { id: 'diario', icon: Book },
  { id: 'tareas', icon: SquareCheck },
  { id: 'prs', icon: GitPullRequest },
  { id: 'repositorios', icon: GitBranch },
  { id: 'ajustes', icon: SlidersHorizontal },
] as const satisfies readonly { id: string; icon: LucideIcon; shortcut?: string }[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export interface Route {
  section: SectionId;
  /** Resto de la ruta tras la sección: `#/notas/12/editar` → ['12', 'editar']. */
  params: string[];
}

export function routeFromHash(hash: string): Route {
  const [id = '', ...params] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const section = SECTIONS.find((s) => s.id === id)?.id;
  return section ? { section, params } : { section: 'hoy', params: [] };
}

export function navigate(path: string) {
  window.location.hash = `#/${path}`;
}

/** Dónde se ve cada tipo de nota: las notas en Notas, los documentos propios en Documentación y los enlaces en Enlaces. */
export function noteHref(note: { id: number; kind: NoteKind }): string {
  return note.kind === 'doc' ? `#/documentacion/propia/${note.id}` : note.kind === 'link' ? `#/enlaces/${note.id}` : `#/notas/${note.id}`;
}
