// Sesión con opencode dentro de la app: un chat por tarea, en la carpeta de la tarea, con el modelo y el
// modo que se elijan en cada mensaje. opencode hace el trabajo; la app envía los mensajes, enseña lo que
// va haciendo y pregunta los permisos.
import { relative, isAbsolute } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ChatMessage, ChatPart, ChatPermission, ChatPermissionReply, ChatSendInput, ChatToolStatus, TaskChat } from '@dev-assistant/shared';
import { CHAT_TOOL_STATUSES } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import type { OcMessage, OcPart, OcPermission, OpencodeApi } from '../../integrations/opencode/api.js';
import { LlmUnavailableError } from '../../integrations/opencode/connection.js';
import { parseModel } from '../../integrations/opencode/llm.js';
import { t } from '../../i18n/index.js';
import { openPrompt, type DevSessionService } from '../tasks/session.js';
import type { AiOptionsService, AiSettingsStore } from './ai-settings.js';

/** Mensajes que se devuelven como mucho (los más recientes) y caracteres de cada salida de herramienta. */
const MAX_MESSAGES = 200;
const MAX_OUTPUT = 4000;
const MAX_DETAIL = 400;
const MAX_DIFF = 6000;

// En la app no hay cómo contestar a la herramienta de preguntas de opencode: sin ella, pregunta en el chat.
const TOOLS = { question: false };

interface Stored {
  sessionId: string;
  model: string | null;
  agent: string;
}

export class ChatInputError extends Error {}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

export class TaskChatService {
  constructor(
    private readonly db: Db,
    private readonly api: OpencodeApi | null,
    private readonly sessions: DevSessionService,
    private readonly aiSettings: AiSettingsStore,
    private readonly aiOptions: AiOptionsService,
  ) {}

  private stored(key: string): Stored | null {
    const value = this.db.select().from(settings).where(eq(settings.key, storeKey(key))).get()?.valueJson as Partial<Stored> | undefined;
    return value && typeof value.sessionId === 'string' ? { sessionId: value.sessionId, model: value.model ?? null, agent: value.agent ?? 'build' } : null;
  }

  private save(key: string, value: Stored) {
    this.db.insert(settings).values({ key: storeKey(key), valueJson: value }).onConflictDoUpdate({ target: settings.key, set: { valueJson: value } }).run();
  }

  private forget(key: string) {
    this.db.delete(settings).where(eq(settings.key, storeKey(key))).run();
  }

  private empty(key: string, stored: Stored | null, extra: Partial<TaskChat> = {}): TaskChat {
    const defaults = this.aiSettings.get();
    return {
      available: true,
      error: null,
      started: false,
      busy: false,
      messages: [],
      permissions: [],
      model: stored ? stored.model : defaults.sessionModel,
      agent: stored?.agent ?? defaults.sessionAgent,
      contextPercent: null,
      starterPrompt: openPrompt(key),
      ...extra,
    };
  }

  async get(key: string): Promise<TaskChat> {
    const stored = this.stored(key);
    if (!this.api) return this.empty(key, stored, { available: false, error: t('ai.notConfigured') });
    // Sin sesión no se molesta a opencode: ver la página no lo arranca.
    if (!stored) return this.empty(key, null);
    const folder = this.sessions.folder(key);
    try {
      const [messages, status, permissions] = await Promise.all([
        this.api.messages(stored.sessionId, folder),
        this.api.status(folder),
        this.api.permissions(folder),
      ]);
      if (!messages) {
        // La sesión ya no existe en opencode: se empieza otra con el siguiente mensaje.
        this.forget(key);
        return this.empty(key, null);
      }
      this.aiOptions.warm();
      const mapped = messages.map((m) => toMessage(m, folder)).filter((m) => m.parts.length || m.error);
      return {
        ...this.empty(key, stored),
        started: true,
        busy: !!status[stored.sessionId] && status[stored.sessionId]!.type !== 'idle',
        messages: mapped.slice(-MAX_MESSAGES),
        // Solo los de sesiones en marcha: al parar una sesión, opencode deja su permiso en la lista.
        permissions: permissions.filter((p) => status[p.sessionID] && status[p.sessionID]!.type !== 'idle').map((p) => toPermission(p, folder)),
        contextPercent: this.contextPercent(messages),
      };
    } catch (err) {
      if (err instanceof LlmUnavailableError) return this.empty(key, stored, { available: false, error: err.message, started: true });
      throw err;
    }
  }

  private contextPercent(messages: OcMessage[]): number | null {
    const last = [...messages].reverse().find((m) => m.info.role === 'assistant' && (m.info.tokens?.input ?? 0) > 0);
    if (!last) return null;
    const limit = this.aiOptions.contextLimit(`${last.info.providerID}/${last.info.modelID}`);
    if (!limit) return null;
    const { input = 0, output = 0, cache } = last.info.tokens!;
    return Math.min(100, Math.round(((input + output + (cache?.read ?? 0)) / limit) * 100));
  }

  async send(key: string, input: ChatSendInput): Promise<TaskChat> {
    const api = this.requireApi();
    let stored = this.stored(key);
    const defaults = this.aiSettings.get();
    const model = input.model !== undefined ? input.model : stored ? stored.model : defaults.sessionModel;
    const agent = input.agent ?? stored?.agent ?? defaults.sessionAgent;
    const folder = this.sessions.folder(key);
    if (stored && (await api.messages(stored.sessionId, folder)) === null) stored = null;
    if (!stored) {
      // TAREA.md al día: es lo primero que lee opencode.
      await this.sessions.prepare(key);
      const session = await api.createSession(folder, `${key} · AI-Assistant`);
      stored = { sessionId: session.id, model, agent };
    }
    this.save(key, { sessionId: stored.sessionId, model, agent });
    await api.prompt(stored.sessionId, folder, { parts: [{ type: 'text', text: input.text }], model: parseModel(model), agent, tools: TOOLS });
    // opencode tarda un instante en marcar la sesión como ocupada: recién enviado, lo está.
    return { ...(await this.get(key)), busy: true };
  }

  async abort(key: string): Promise<TaskChat> {
    const api = this.requireApi();
    const stored = this.stored(key);
    if (stored) await this.stop(api, stored.sessionId, this.sessions.folder(key));
    return this.get(key);
  }

  /** Deja la sesión actual (sigue en el historial de opencode) para empezar otra con el siguiente mensaje. */
  async reset(key: string): Promise<TaskChat> {
    const stored = this.stored(key);
    if (stored && this.api) await this.stop(this.api, stored.sessionId, this.sessions.folder(key)).catch(() => {});
    this.forget(key);
    return this.get(key);
  }

  async replyPermission(key: string, permissionId: string, reply: ChatPermissionReply): Promise<TaskChat> {
    const api = this.requireApi();
    const folder = this.sessions.folder(key);
    const pending = (await api.permissions(folder)).find((p) => p.id === permissionId);
    // Si ya no está pendiente (se contestó en la terminal, se paró la sesión), no hay nada que responder.
    if (pending) await api.replyPermission(permissionId, reply, folder);
    return this.get(key);
  }

  /** Para la sesión y rechaza lo que tuviera pendiente de permiso. */
  private async stop(api: OpencodeApi, sessionId: string, folder: string) {
    const pending = (await api.permissions(folder)).filter((p) => p.sessionID === sessionId);
    await api.abort(sessionId, folder);
    await Promise.all(pending.map((p) => api.replyPermission(p.id, 'reject', folder).catch(() => {})));
  }

  private requireApi(): OpencodeApi {
    if (!this.api) throw new LlmUnavailableError(t('ai.notConfigured'));
    return this.api;
  }
}

const storeKey = (key: string) => `chat.session.${key}`;

/** Ruta relativa a la carpeta de la tarea si está dentro; si no, tal cual. */
function shortPath(path: string, folder: string): string {
  if (!path || !isAbsolute(path)) return path;
  const rel = relative(folder, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

function toolDetail(part: OcPart, folder: string): string {
  const input = part.state?.input ?? {};
  const byTool: Record<string, string> = {
    bash: str(input.command),
    read: shortPath(str(input.filePath), folder),
    edit: shortPath(str(input.filePath), folder),
    write: shortPath(str(input.filePath), folder),
    grep: str(input.pattern),
    glob: str(input.pattern),
    list: shortPath(str(input.path), folder),
    webfetch: str(input.url),
    task: str(input.description),
    skill: str(input.name),
  };
  const known = part.tool ? byTool[part.tool] : undefined;
  if (known) return clip(known, MAX_DETAIL);
  if (known === '') return '';
  // Herramientas de MCP y otras: el título que da opencode o el primer dato de texto.
  const first = Object.values(input).find((v): v is string => typeof v === 'string' && v.length > 0) ?? '';
  return clip(str(part.state?.title) || first, MAX_DETAIL);
}

function toPart(part: OcPart, folder: string): ChatPart | null {
  if (part.type === 'text') {
    const text = (part.text ?? '').trim();
    return text && !part.synthetic ? { type: 'text', id: part.id, text } : null;
  }
  if (part.type !== 'tool' || !part.tool || !part.state) return null;
  const { state } = part;
  const status = (CHAT_TOOL_STATUSES as readonly string[]).includes(state.status) ? (state.status as ChatToolStatus) : 'running';
  const output = status === 'error' ? str(state.error) : str(state.output);
  const { start, end } = state.time ?? {};
  return {
    type: 'tool',
    id: part.id,
    tool: part.tool,
    status,
    detail: toolDetail(part, folder),
    output: output ? clip(output, MAX_OUTPUT) : null,
    seconds: start && end ? Math.max(0, Math.round((end - start) / 1000)) : null,
  };
}

function toMessage({ info, parts }: OcMessage, folder: string): ChatMessage {
  const provider = info.providerID ?? info.model?.providerID;
  const model = info.modelID ?? info.model?.modelID;
  let error: string | null = null;
  if (info.error) {
    const message = info.error.data?.message;
    error = info.error.name === 'MessageAbortedError' ? t('chat.aborted') : typeof message === 'string' && message ? message : (info.error.name ?? 'Error');
  }
  return {
    id: info.id,
    role: info.role === 'user' ? 'user' : 'assistant',
    agent: info.mode ?? info.agent ?? null,
    model: provider && model ? `${provider}/${model}` : null,
    createdAt: new Date(info.time?.created ?? 0).toISOString(),
    error,
    parts: parts.map((p) => toPart(p, folder)).filter((p): p is ChatPart => !!p),
  };
}

function toPermission(p: OcPermission, folder: string): ChatPermission {
  const patterns = p.patterns ?? [];
  const meta = p.metadata ?? {};
  const detail = str(meta.command) || shortPath(str(meta.filepath) || str(meta.filePath), folder) || str(meta.url) || patterns.join('\n');
  const diff = str(meta.diff);
  return { id: p.id, permission: p.permission ?? '', detail: clip(detail, MAX_DETAIL), diff: diff ? clip(diff, MAX_DIFF) : null, always: p.always ?? [] };
}
