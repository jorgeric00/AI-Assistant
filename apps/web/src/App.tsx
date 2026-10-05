import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@dev-assistant/shared';
import { useState } from 'react';

// Secciones de la app; cada una la desarrolla su hilo (ver diseño, sección 8).
const SECTIONS = [
  { id: 'notes', label: 'Notas y enlaces' },
  { id: 'reminders', label: 'Recordatorios' },
  { id: 'journal', label: 'Diario' },
  { id: 'tasks', label: 'Tareas JIRA' },
  { id: 'repos', label: 'Repositorios' },
  { id: 'settings', label: 'Ajustes' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function App() {
  const [section, setSection] = useState<SectionId>('notes');
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <nav className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <h1 className="mb-6 text-lg font-semibold">Asistente</h1>
        <ul className="space-y-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSection(s.id)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  s.id === section ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-slate-500">
          Servidor: {health.isError ? 'sin conexión' : health.data ? `ok · v${health.data.version}` : '…'}
        </p>
      </nav>
      <main className="flex-1 overflow-auto p-8">
        <h2 className="mb-4 text-2xl font-semibold">{current.label}</h2>
        <p className="text-slate-500">Pendiente de implementar.</p>
      </main>
    </div>
  );
}
