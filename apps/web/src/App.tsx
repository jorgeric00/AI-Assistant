import { useQuery } from '@tanstack/react-query';
import type { HealthResponse, Note } from '@dev-assistant/shared';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { QuickCapture } from './components/QuickCapture';
import { Sidebar } from './components/Sidebar';
import { HoyPage } from './pages/HoyPage';
import { PendingPage } from './pages/PendingPage';
import { NotasPage } from './pages/notas/NotasPage';
import { SECTIONS, routeFromHash, type Route } from './sections';

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

export function App() {
  const { section, params } = useHashRoute();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [savedNote, setSavedNote] = useState<Note | null>(null);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setCaptureOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!savedNote) return;
    const t = setTimeout(() => setSavedNote(null), 4000);
    return () => clearTimeout(t);
  }, [savedNote]);

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="flex min-h-screen flex-wrap">
      <Sidebar current={section} serverOk={health.isError ? false : health.data ? true : undefined} onQuickCapture={() => setCaptureOpen(true)} />
      <main className="min-w-0 flex-[999_1_560px] p-6">
        <div className="mx-auto w-full max-w-[1120px]">
          {section === 'hoy' ? <HoyPage /> : section === 'notas' ? <NotasPage params={params} /> : <PendingPage title={current.label} />}
        </div>
      </main>

      {captureOpen && (
        <QuickCapture
          onClose={() => setCaptureOpen(false)}
          onSaved={(note) => {
            setCaptureOpen(false);
            setSavedNote(note);
          }}
        />
      )}

      {savedNote && (
        <div role="status" className="fixed right-6 bottom-6 z-40 flex items-center gap-3 rounded-md border border-line-strong bg-surface-raised px-4 py-3">
          <CircleCheck size={16} className="text-success" aria-hidden />
          <span>{savedNote.kind === 'link' ? 'Enlace guardado' : 'Nota guardada'}</span>
          <a href={`#/notas/${savedNote.id}`} onClick={() => setSavedNote(null)} className="text-info">
            Ver
          </a>
        </div>
      )}
    </div>
  );
}
