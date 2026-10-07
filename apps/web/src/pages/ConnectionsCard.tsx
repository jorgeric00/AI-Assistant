import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectionsStatus, ConnectionsUpdate, ConnectionTestResult, SecretState } from '@dev-assistant/shared';
import { CircleCheck, CircleX, Eye, EyeOff, PlugZap } from 'lucide-react';
import { api, queryKeys } from '../api';
import { Card } from '../components/Card';
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../components/fields';

type SecretField = 'jiraToken' | 'jiraMcpToken' | 'githubToken';

/** Ajustes > Conexiones: URL y tokens de JIRA y GitHub (diseño aprobado por Jorge). Se aplican sin reiniciar. */
export function ConnectionsCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.connections, queryFn: api.getConnections });
  const save = useMutation({
    mutationFn: api.updateConnections,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.connections, data);
      // JIRA y GitHub se reconectan al guardar: refresca tareas y PR.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prs });
    },
  });
  const s = status.data;

  return (
    <Card title="Conexiones">
      <p className="m-0 text-ink-muted">Se aplican al momento, sin reiniciar la app. Los tokens guardados no se vuelven a mostrar.</p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !s ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : (
        <>
          <Group title="JIRA" target="jira" ready={!!s.jiraUrl && s.jiraToken.set}>
            <UrlField value={s.jiraUrl} onSave={(jiraUrl) => save.mutateAsync({ jiraUrl })} />
            <Secret field="jiraToken" label="Token" state={s.jiraToken} onSave={save.mutateAsync} />
            <Secret
              field="jiraMcpToken"
              label="Token del MCP de JIRA"
              help={
                <>
                  Lo usa opencode con <code className="font-mono text-code">{'{env:JIRA_MCP_TOKEN}'}</code> cuando lo abres desde la app.
                </>
              }
              state={s.jiraMcpToken}
              onSave={save.mutateAsync}
            />
          </Group>
          <Group title="GitHub" target="github" ready={s.githubToken.set}>
            <Secret
              field="githubToken"
              label="Token"
              help="Basta con permisos de lectura. Si tu organización usa SSO, autoriza el token en GitHub."
              state={s.githubToken}
              onSave={save.mutateAsync}
            />
          </Group>
          {save.isError && <p className="m-0 text-danger">{save.error.message}</p>}
          <p className="m-0 text-small text-ink-faint break-all">Se guardan en {s.envFile}</p>
        </>
      )}
    </Card>
  );
}

function Group({ title, target, ready, children }: { title: string; target: 'jira' | 'github'; ready: boolean; children: ReactNode }) {
  const test = useMutation({ mutationFn: () => api.testConnection(target) });
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-body font-semibold">{title}</h3>
        <button type="button" onClick={() => test.mutate()} disabled={!ready || test.isPending} className={secondaryButtonClass}>
          <PlugZap size={16} strokeWidth={2} aria-hidden />
          {test.isPending ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>
      {test.data && <TestResult result={test.data} />}
      {test.isError && <p className="m-0 text-danger">{test.error.message}</p>}
      {children}
    </div>
  );
}

function TestResult({ result }: { result: ConnectionTestResult }) {
  return result.ok ? (
    <p className="m-0 flex items-center gap-2 text-success">
      <CircleCheck size={16} aria-hidden />
      Funciona. Entras como {result.user}.
    </p>
  ) : (
    <p className="m-0 flex items-start gap-2 text-danger">
      <CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />
      {result.error}
    </p>
  );
}

function UrlField({ value, onSave }: { value: string | null; onSave: (url: string | null) => Promise<ConnectionsStatus> }) {
  const [text, setText] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = text.trim().replace(/\/+$/, '') !== (value ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await onSave(text.trim() || null);
      setText(saved.jiraUrl ?? '');
    } catch {
      // El error lo enseña la tarjeta.
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <label htmlFor="jira-url" className={labelClass}>
        URL
      </label>
      <div className="flex gap-2">
        <input
          id="jira-url"
          type="url"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://jira.tuempresa.com/jira"
          className={`${inputClass} min-w-0 grow`}
        />
        {dirty && (
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
      <span className="text-small text-ink-faint">La parte de la dirección de una tarea anterior a /browse/.</span>
    </form>
  );
}

function Secret({
  field,
  label,
  help,
  state,
  onSave,
}: {
  field: SecretField;
  label: string;
  help?: ReactNode;
  state: SecretState;
  onSave: (input: ConnectionsUpdate) => Promise<ConnectionsStatus>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = `secret-${field}`;

  const save = async (value: string | null) => {
    setSaving(true);
    try {
      await onSave({ [field]: value });
      setEditing(false);
      setText('');
      setVisible(false);
    } catch {
      // El error lo enseña la tarjeta.
    } finally {
      setSaving(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void save(text.trim());
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {state.set && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-ink">
            <CircleCheck size={16} className="text-success" aria-hidden />
            Guardado{state.hint ? ` · termina en …${state.hint}` : ''}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
              Cambiar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (window.confirm(`¿Borrar el ${label.toLowerCase()}?`)) void save(null);
              }}
              className={secondaryButtonClass}
            >
              Borrar
            </button>
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative min-w-0 grow">
            <input
              id={id}
              type={visible ? 'text' : 'password'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={state.set ? 'Nuevo token' : 'Pega aquí el token'}
              className={`${inputClass} w-full pr-10 font-mono`}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Ocultar token' : 'Mostrar token'}
              className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink"
            >
              {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
            </button>
          </div>
          <button type="submit" disabled={!text.trim() || saving} className={primaryButtonClass}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          {state.set && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText('');
              }}
              className={secondaryButtonClass}
            >
              Cancelar
            </button>
          )}
        </form>
      )}
      {help && <span className="text-small text-ink-faint">{help}</span>}
    </div>
  );
}
