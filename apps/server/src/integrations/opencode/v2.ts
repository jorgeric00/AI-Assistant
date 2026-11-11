// opencode 2.x tiene otra API HTTP (/api/...). Aquí se traduce lo que devuelve a las formas de la 1.x que usa
// el resto de la app, y se renombran las herramientas y permisos nuevos a los de siempre (shell → bash...).
import type { OcAgent, OcMessage, OcPart, OcPermission, OcProvider, OcSession } from './api.js';

export interface V2ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}
export interface V2Model {
  id: string;
  providerID: string;
  name: string;
  enabled?: boolean;
  limit?: { context?: number };
}
export interface V2Provider {
  id: string;
  name: string;
  activation?: string;
}
export interface V2Agent {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
}
export interface V2Session {
  id: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: V2ModelRef;
  time?: { created?: number; updated?: number };
  location?: { directory?: string };
}
interface V2Error {
  type?: string;
  message?: string;
}
interface V2ToolState {
  status: string;
  input?: unknown;
  content?: { type: string; text?: string }[];
  error?: V2Error;
}
interface V2Content {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  state?: V2ToolState;
  time?: { created?: number; completed?: number };
}
export interface V2Message {
  id: string;
  type: string;
  time?: { created?: number; completed?: number };
  text?: string;
  agent?: string;
  model?: V2ModelRef;
  content?: V2Content[];
  error?: V2Error;
  outcome?: string;
  tokens?: { input?: number; output?: number; cache?: { read?: number } };
}
export interface V2Permission {
  id: string;
  sessionID: string;
  action: string;
  resources?: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
}

/** Nombres de la 2.x → los de la 1.x, que son los que conoce la app (etiquetas, detalle de cada herramienta). */
const TOOL_NAMES: Record<string, string> = { shell: 'bash', subagent: 'task' };
const legacyName = (name: string) => TOOL_NAMES[name] ?? name;

export function toProviders(providers: V2Provider[], models: V2Model[]): OcProvider[] {
  return providers
    .filter((p) => p.activation !== 'disabled')
    .map((p) => ({
      id: p.id,
      name: p.name,
      models: Object.fromEntries(
        models.filter((m) => m.providerID === p.id && m.enabled !== false).map((m) => [m.id, { id: m.id, name: m.name, limit: { context: m.limit?.context } }]),
      ),
    }))
    .filter((p) => Object.keys(p.models).length > 0);
}

export const toAgent = (a: V2Agent): OcAgent => ({ name: a.id, description: a.description, mode: a.mode, hidden: a.hidden });

export const toSession = (s: V2Session): OcSession => ({ id: s.id, title: s.title, parentID: s.parentID, directory: s.location?.directory, time: s.time });

export const toPermission = (p: V2Permission): OcPermission => ({
  id: p.id,
  sessionID: p.sessionID,
  permission: legacyName(p.action),
  patterns: p.resources ?? [],
  always: p.save ?? [],
  metadata: p.metadata,
});

const TOOL_STATUS: Record<string, string> = { streaming: 'pending', running: 'running', completed: 'completed', error: 'error' };

function toolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const values = { ...(input as Record<string, unknown>) };
  // La 1.x llamaba filePath a la ruta de read, edit y write.
  if (typeof values.path === 'string' && values.filePath === undefined) values.filePath = values.path;
  return values;
}

function toPart(messageId: string, c: V2Content, i: number): OcPart | null {
  if (c.type === 'text') return { id: `${messageId}:${i}`, type: 'text', text: c.text ?? '' };
  if (c.type !== 'tool' || !c.name || !c.state) return null;
  const output = (c.state.content ?? []).map((x) => x.text ?? '').filter(Boolean).join('\n');
  return {
    id: c.id ?? `${messageId}:${i}`,
    type: 'tool',
    tool: legacyName(c.name),
    state: {
      status: TOOL_STATUS[c.state.status] ?? 'running',
      input: toolInput(c.state.input),
      output,
      error: c.state.error?.message,
      time: { start: c.time?.created, end: c.time?.completed },
    },
  };
}

const errorOf = (e: V2Error) => ({ name: e.type, data: { message: e.message } });

/** Mensajes de la 2.x (en orden, del más antiguo al más reciente) → mensajes de la 1.x. */
export function toMessages(list: V2Message[]): OcMessage[] {
  const out: OcMessage[] = [];
  for (const m of list) {
    if (m.type === 'user') {
      out.push({ info: { id: m.id, role: 'user', time: { created: m.time?.created } }, parts: [{ id: `${m.id}:0`, type: 'text', text: m.text ?? '' }] });
    } else if (m.type === 'assistant') {
      out.push({
        info: {
          id: m.id,
          role: 'assistant',
          agent: m.agent,
          providerID: m.model?.providerID,
          modelID: m.model?.id,
          time: { created: m.time?.created, completed: m.time?.completed },
          error: m.error ? errorOf(m.error) : undefined,
          tokens: m.tokens,
        },
        parts: (m.content ?? []).map((c, i) => toPart(m.id, c, i)).filter((p): p is OcPart => !!p),
      });
    } else if (m.type === 'idle' && m.outcome && m.outcome !== 'succeeded') {
      // El turno acabó mal o se paró: el error va en la última respuesta (o en una vacía si no hubo).
      const error = m.outcome === 'interrupted' ? { name: 'MessageAbortedError' } : errorOf(m.error ?? { type: 'Error', message: m.outcome });
      const last = out[out.length - 1];
      if (last?.info.role === 'assistant' && !last.info.error) last.info.error = error;
      else out.push({ info: { id: m.id, role: 'assistant', time: { created: m.time?.created }, error }, parts: [] });
    }
  }
  return out;
}
