import type { AiOptions } from '@dev-assistant/shared';
import { useTranslation } from 'react-i18next';
import { inputClass } from './fields';

/** Nombre legible de un modelo "proveedor/modelo" (el que da opencode, o el id sin el proveedor). */
export function modelName(options: AiOptions | undefined, id: string): string {
  for (const provider of options?.providers ?? []) {
    const model = provider.models.find((m) => m.id === id);
    if (model) return model.name;
  }
  return id.slice(id.indexOf('/') + 1);
}

/** Nombre de un modo (agente) de opencode tal como lo enseña él: "build" → "Build". */
export const modeName = (agent: string) => agent.charAt(0).toUpperCase() + agent.slice(1);

interface ModelSelectProps {
  id: string;
  /** null = el predeterminado de opencode. */
  value: string | null;
  onChange: (model: string | null) => void;
  options: AiOptions | undefined;
  disabled?: boolean;
  className?: string;
}

/** Desplegable con los modelos del opencode del usuario, agrupados por proveedor. */
export function ModelSelect({ id, value, onChange, options, disabled, className = '' }: ModelSelectProps) {
  const { t } = useTranslation('common');
  const providers = options?.providers ?? [];
  const known = !value || providers.some((p) => p.models.some((m) => m.id === value));
  return (
    <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={`${inputClass} min-w-0 ${className}`}>
      <option value="">{options?.defaultModel ? t('model.defaultNow', { name: modelName(options, options.defaultModel) }) : t('model.default')}</option>
      {/* El elegido sigue a la vista aunque opencode ya no lo liste (o aún no haya contestado). */}
      {!known && value && <option value={value}>{modelName(options, value)}</option>}
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

interface ModeToggleProps {
  labelledBy?: string;
  value: string;
  onChange: (agent: string) => void;
  options: AiOptions | undefined;
  disabled?: boolean;
}

/** Los modos de opencode (Build, Plan y los agentes propios) como botones; con muchos, un desplegable. */
export function ModeToggle({ labelledBy, value, onChange, options, disabled }: ModeToggleProps) {
  const { t } = useTranslation('common');
  const listed = options?.agents.map((a) => a.name) ?? [];
  const names = [...new Set([...(listed.length ? listed : ['build', 'plan']), value])];
  const label = labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': t('model.modeLabel') };
  if (names.length > 4) {
    return (
      <select {...label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {names.map((name) => (
          <option key={name} value={name}>
            {modeName(name)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div role="group" {...label} className="flex shrink-0 overflow-hidden rounded-md border border-line-strong">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={name === value}
          disabled={disabled}
          title={options?.agents.find((a) => a.name === name)?.description ?? undefined}
          onClick={() => onChange(name)}
          className={`h-10 px-3.5 disabled:cursor-not-allowed disabled:opacity-60 ${name === value ? 'bg-accent font-semibold text-on-accent' : 'text-ink hover:bg-surface-raised'}`}
        >
          {modeName(name)}
        </button>
      ))}
    </div>
  );
}
