import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download } from 'lucide-react';
import { api, queryKeys } from '../api';
import { Card } from '../components/Card';
import { primaryButtonClass } from '../components/fields';

/** Sección "Ajustes". De momento, la instalación de la skill de opencode. */
export function AjustesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">Ajustes</h1>
      <div className="max-w-[640px]">
        <OpencodeSkillCard />
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
