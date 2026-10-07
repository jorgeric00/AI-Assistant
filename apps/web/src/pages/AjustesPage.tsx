import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, DatabaseBackup, Download } from 'lucide-react';
import { api, queryKeys } from '../api';
import { Card } from '../components/Card';
import { primaryButtonClass, secondaryButtonClass } from '../components/fields';
import { dayAndTime } from '../dates';
import { ConnectionsCard } from './ConnectionsCard';

/** Sección "Ajustes": conexiones, skill de opencode, arranque automático y copias de seguridad. */
export function AjustesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">Ajustes</h1>
      <div className="flex max-w-[640px] flex-col gap-4">
        <ConnectionsCard />
        <OpencodeSkillCard />
        <AutostartCard />
        <BackupsCard />
      </div>
    </div>
  );
}

function OpencodeSkillCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.opencodeSkill, queryFn: api.opencodeSkill });
  const install = useMutation({
    mutationFn: api.installOpencodeSkill,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.opencodeSkill, data),
  });
  const s = status.data;
  return (
    <Card title="Skill de opencode">
      <p className="m-0 text-ink-muted">
        Enseña a opencode a trabajar las tareas siempre igual: escribe el plan en <code className="font-mono text-code">PLAN.md</code>, anota
        cada commit en <code className="font-mono text-code">HISTORIAL.md</code> y no hace push, PR ni cambios en JIRA sin tu confirmación. Así la
        página de detalle de cada tarea muestra la fase y los cambios.
      </p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : s ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {s.installed && s.upToDate ? (
            <span className="flex items-center gap-2 text-success">
              <CircleCheck size={16} aria-hidden />
              Instalada y al día
            </span>
          ) : (
            <span className="text-ink-muted">{s.installed ? 'Hay una versión nueva.' : 'No está instalada.'}</span>
          )}
          {!(s.installed && s.upToDate) && (
            <button type="button" onClick={() => install.mutate()} disabled={install.isPending} className={primaryButtonClass}>
              <Download size={16} strokeWidth={2} aria-hidden />
              {install.isPending ? 'Instalando…' : s.installed ? 'Actualizar' : 'Instalar'}
            </button>
          )}
        </div>
      ) : (
        <p className="m-0 text-ink-muted">Cargando…</p>
      )}
      {install.isError && <p className="m-0 text-danger">{install.error.message}</p>}
      {s && <p className="m-0 text-small text-ink-faint break-all">Se instala en {s.path}</p>}
    </Card>
  );
}

const checkbox = 'mt-0.5 size-[18px] shrink-0 accent-accent';

function AutostartCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.autostart, queryFn: api.getAutostart });
  const update = useMutation({
    mutationFn: api.updateAutostart,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.autostart, data),
  });
  const s = status.data;
  return (
    <Card title="Arranque">
      <p className="m-0 text-ink-muted">
        La app se abre en <code className="font-mono text-code">http://127.0.0.1:4321</code>. Para arrancarla a mano, ejecuta{' '}
        <code className="font-mono text-code">npx pnpm@10.28.0 start</code> en la carpeta de la app.
      </p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !s ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : (
        <>
          {!s.supported && <p className="m-0 text-ink-muted">El arranque automático solo está disponible en Windows.</p>}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={!s.supported || update.isPending}
              onChange={(e) => update.mutate({ enabled: e.target.checked })}
              className={checkbox}
            />
            <span className="flex flex-col">
              <span>Arrancar AI-Assistant al iniciar sesión en Windows</span>
              <span className="text-small text-ink-muted">Sin ventana: se queda funcionando en segundo plano.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.openBrowser}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ openBrowser: e.target.checked })}
              className={checkbox}
            />
            <span className="flex flex-col">
              <span>Abrir la app en el navegador al arrancar</span>
              <span className="text-small text-ink-muted">Solo cuando arranca sola al iniciar sesión.</span>
            </span>
          </label>
          {update.isError && <p className="m-0 text-danger">{update.error.message}</p>}
          {s.supported && <p className="m-0 text-small text-ink-faint break-all">Si no arranca, mira el registro en {s.logFile}</p>}
        </>
      )}
    </Card>
  );
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function BackupsCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.backups, queryFn: api.getBackups });
  const run = useMutation({
    mutationFn: api.runBackup,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.backups, data),
  });
  const s = status.data;
  return (
    <Card title="Copias de seguridad">
      <p className="m-0 text-ink-muted">Cada día se guarda una copia de la base de datos. Se conservan las 7 más recientes.</p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !s ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-ink-muted">
            {s.last ? (
              <>
                Última copia: <span className="text-ink">{dayAndTime(s.last.at)}</span> · {size(s.last.bytes)} · {s.count} {s.count === 1 ? 'copia' : 'copias'}
              </>
            ) : (
              'Aún no hay copias.'
            )}
          </span>
          <button type="button" onClick={() => run.mutate()} disabled={!s.supported || run.isPending} className={secondaryButtonClass}>
            <DatabaseBackup size={16} strokeWidth={2} aria-hidden />
            {run.isPending ? 'Copiando…' : 'Hacer copia ahora'}
          </button>
        </div>
      )}
      {run.isError && <p className="m-0 text-danger">{run.error.message}</p>}
      {s && <p className="m-0 text-small text-ink-faint break-all">Se guardan en {s.dir}</p>}
    </Card>
  );
}
