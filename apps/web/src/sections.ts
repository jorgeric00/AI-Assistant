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

export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#\/?/, '');
  return SECTIONS.find((s) => s.id === id)?.id ?? 'hoy';
}
