import { BookOpen, Bell, FileText, GitBranch, SlidersHorizontal, SquareCheck, Sun, type LucideIcon } from 'lucide-react';

// Secciones del menú lateral (diseño "AI-Assistant · Pantallas").
export const SECTIONS = [
  { id: 'hoy', label: 'Hoy', icon: Sun },
  { id: 'notas', label: 'Notas y enlaces', icon: FileText },
  { id: 'recordatorios', label: 'Recordatorios', icon: Bell },
  { id: 'diario', label: 'Diario', icon: BookOpen },
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
