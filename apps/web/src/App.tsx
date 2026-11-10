import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@dev-assistant/shared';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pregunta } from './components/Pregunta';
import { QuickCapture, type Saved } from './components/QuickCapture';
import { ReminderAlerts } from './components/ReminderAlerts';
import { Sidebar } from './components/Sidebar';
import { HoyPage } from './pages/HoyPage';
import { ChatPage } from './pages/chat/ChatPage';
import { PrsPage } from './pages/prs/PrsPage';
import { PendingPage } from './pages/PendingPage';
import { DiarioPage } from './pages/diario/DiarioPage';
import { DocumentacionPage } from './pages/documentacion/DocumentacionPage';
import { EnlacesPage } from './pages/enlaces/EnlacesPage';
import { NotasPage } from './pages/notas/NotasPage';
import { RecordatoriosPage } from './pages/recordatorios/RecordatoriosPage';
import { AjustesPage } from './pages/AjustesPage';
import { RepositoriosPage } from './pages/repositorios/RepositoriosPage';
import { TareasPage } from './pages/tareas/TareasPage';
import { navigate, routeFromHash, type Route } from './sections';
import { useLanguage } from './i18n/useLanguage';

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
  useLanguage();
  const { t } = useTranslation('common');
  const { section, params } = useHashRoute();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
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
      } else if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setAskOpen(true);
      } else if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        navigate('chat');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  const sectionTitle = t(`sections.${section}`);

  return (
    <div className="flex min-h-screen flex-wrap">
      <Sidebar current={section} serverOk={health.isError ? false : health.data ? true : undefined} onQuickCapture={() => setCaptureOpen(true)} onAsk={() => setAskOpen(true)} />
      <main className="min-w-0 flex-[999_1_560px] p-6">
        <div className="mx-auto w-full max-w-[1120px]">
          {section === 'hoy' ? (
            <HoyPage />
          ) : section === 'chat' ? (
            <ChatPage params={params} />
          ) : section === 'documentacion' ? (
            <DocumentacionPage params={params} />
          ) : section === 'notas' ? (
            <NotasPage params={params} />
          ) : section === 'enlaces' ? (
            <EnlacesPage params={params} />
          ) : section === 'recordatorios' ? (
            <RecordatoriosPage />
          ) : section === 'diario' ? (
            <DiarioPage params={params} />
          ) : section === 'tareas' ? (
            <TareasPage params={params} />
          ) : section === 'prs' ? (
            <PrsPage params={params} />
          ) : section === 'repositorios' ? (
            <RepositoriosPage params={params} />
          ) : section === 'ajustes' ? (
            <AjustesPage />
          ) : (
            <PendingPage title={sectionTitle} />
          )}
        </div>
      </main>

      {captureOpen && (
        <QuickCapture
          onClose={() => setCaptureOpen(false)}
          onSaved={(result) => {
            setCaptureOpen(false);
            setSaved(result);
          }}
        />
      )}

      {askOpen && <Pregunta onClose={() => setAskOpen(false)} />}

      <ReminderAlerts />

      {saved && (
        <div role="status" className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line-strong bg-surface-raised px-4 py-3">
          <CircleCheck size={16} className="text-success" aria-hidden />
          <span>{saved.message}</span>
          <a href={saved.href} onClick={() => setSaved(null)} className="text-info">
            {t('app.view')}
          </a>
        </div>
      )}
    </div>
  );
}
