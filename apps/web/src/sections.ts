import { Bell, Book, BookOpen, FileText, GitBranch, Link2, SlidersHorizontal, SquareCheck, Sun, type LucideIcon } from 'lucide-react';
import type { NoteKind } from '@dev-assistant/shared';

// Secciones del menú lateral (diseño "AI-Assistant · Pantallas").
export const SECTIONS = [
  { id: 'hoy', label: 'Hoy', icon: Sun },
  { id: 'documentacion', label: 'Documentación', icon: BookOpen },
  { id: 'notas', label: 'Notas', icon: FileText },
  { id: 'enlaces', label: 'Enlaces', icon: Link2 },
  { id: 'recordatorios', label: 'Recordatorios', icon: Bell },
  { id: 'diario', label: 'Diario', icon: Book },
  { id: 'tareas', label: 'Tareas de JIRA', icon: SquareCheck },
  { id: 'repositorios', label: 'Repositorios', icon: GitBranch },
  { id: 'ajustes', label: 'Ajustes', icon: SlidersHorizontal },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

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
