import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@dev-assistant/shared';
import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { HoyPage } from './pages/HoyPage';
import { PendingPage } from './pages/PendingPage';
import { SECTIONS, sectionFromHash, type SectionId } from './sections';

function useHashSection(): SectionId {
  const [section, setSection] = useState(() => sectionFromHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setSection(sectionFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return section;
}

export function App() {
  const section = useHashSection();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // La captura rápida se implementa en el hilo de notas y recordatorios.
  const openQuickCapture = () => {};

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openQuickCapture();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="flex min-h-screen flex-wrap">
      <Sidebar current={section} serverOk={health.isError ? false : health.data ? true : undefined} onQuickCapture={openQuickCapture} />
      <main className="min-w-0 flex-[999_1_560px] p-6">
        <div className="mx-auto w-full max-w-[1120px]">
          {section === 'hoy' ? <HoyPage /> : <PendingPage title={current.label} />}
        </div>
      </main>
    </div>
  );
}
