// Lo común a los chats con opencode de la app (el de cada tarea y el general): leer una sesión de opencode
// y pasarla a mensajes y permisos que entiende la web, enviar mensajes, pararla y contestar permisos.
import { relative, isAbsolute } from 'node:path';
import type { ChatMessage, ChatPart, ChatPermission, ChatPermissionReply, ChatQuestion, ChatQuestionReplyInput, ChatState, ChatToolStatus } from '@dev-assistant/shared';
import { CHAT_TOOL_STATUSES } from '@dev-assistant/shared';
import type { OcMessage, OcPart, OcPermission, OpencodeApi } from '../../integrations/opencode/api.js';
import { LlmUnavailableError } from '../../integrations/opencode/connection.js';
import { parseModel } from '../../integrations/opencode/llm.js';
import { t } from '../../i18n/index.js';
import type { AiOptionsService } from './ai-settings.js';

/** Mensajes que se devuelven como mucho (los más recientes) y caracteres de cada salida de herramienta. */
const MAX_MESSAGES = 200;
const MAX_OUTPUT = 4000;
const MAX_DETAIL = 400;
const MAX_DIFF = 6000;

// La 1.x no deja contestar desde fuera a su herramienta de preguntas: sin ella, pregunta en el chat. La 2.x no
// deja quitarla y sus preguntas se contestan en la app.
const TOOLS = { question: false };

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Lo que se sabe de una sesión de opencode al leerla (sin la selección de modelo y modo). */
export type SessionView = Pick<ChatState, 'busy' | 'messages' | 'permissions' | 'questions' | 'contextPercent'>;

export class OpencodeChat {
  constructor(
    private readonly api: OpencodeApi | null,
    private readonly aiOptions: AiOptionsService,
  ) {}

  get available() {
    return !!this.api;
  }

  requireApi(): OpencodeApi {
    if (!this.api) throw new LlmUnavailableError(t('ai.notConfigured'));
    return this.api;
  }

  /**
   * null si la sesión ya no existe en opencode (la borraron desde la terminal, cambió la base de datos...).
   * Con `allPermissions` enseña también los permisos de otras sesiones de la carpeta (la de la terminal).
   */
  async view(sessionId: string, folder: string, { allPermissions = false } = {}): Promise<SessionView | null> {
    const api = this.requireApi();
    const [messages, status, permissions, questions] = await Promise.all([
      api.messages(sessionId, folder),
      api.status(folder),
      api.permissions(folder),
      api.questions(folder),
    ]);
    if (!messages) return null;
    this.aiOptions.warm();
    const busy = (id: string) => !!status[id] && status[id]!.type !== 'idle';
    return {
      busy: busy(sessionId),
      messages: messages
        .map((m) => toMessage(m, folder))
        .filter((m) => m.parts.length || m.error)
        .slice(-MAX_MESSAGES),
      // Solo de sesiones en marcha: al parar una, opencode deja su permiso en la lista.
      permissions: permissions.filter((p) => (allPermissions || p.sessionID === sessionId) && busy(p.sessionID)).map((p) => toPermission(p, folder)),
      questions: questions.filter((q) => (allPermissions || q.sessionID === sessionId) && busy(q.sessionID)).map(({ id, items }): ChatQuestion => ({ id, items })),
      contextPercent: this.contextPercent(messages),
    };
  }

  async exists(sessionId: string, folder: string) {
    return (await this.requireApi().messages(sessionId, folder)) !== null;
  }

  prompt(sessionId: string, folder: string, text: string, model: string | null, agent: string) {
    return this.requireApi().prompt(sessionId, folder, { parts: [{ type: 'text', text }], model: parseModel(model), agent, tools: TOOLS });
  }

  /** Para la sesión y rechaza lo que tuviera pendiente de permiso o de respuesta. */
  async stop(sessionId: string, folder: string) {
    const api = this.requireApi();
    const [permissions, questions] = await Promise.all([api.permissions(folder), api.questions(folder)]);
    const pending = permissions.filter((p) => p.sessionID === sessionId);
    await api.abort(sessionId, folder);
    await Promise.all([
      ...pending.map((p) => api.replyPermission(p.id, 'reject', folder).catch(() => {})),
      ...questions.filter((q) => q.sessionID === sessionId).map((q) => api.dismissQuestion(q.sessionID, q.id).catch(() => {})),
    ]);
  }

  async replyQuestion(questionId: string, input: ChatQuestionReplyInput, folder: string) {
    const api = this.requireApi();
    const pending = (await api.questions(folder)).find((q) => q.id === questionId);
    // Si ya no está pendiente (se contestó en la terminal, se paró la sesión), no hay nada que responder.
    if (!pending) return;
    if ('skip' in input) await api.dismissQuestion(pending.sessionID, pending.id);
    else await api.replyQuestion(pending.sessionID, pending.id, input.answers);
  }

  async replyPermission(permissionId: string, reply: ChatPermissionReply, folder: string) {
    const api = this.requireApi();
    const pending = (await api.permissions(folder)).find((p) => p.id === permissionId);
    // Si ya no está pendiente (se contestó en la terminal, se paró la sesión), no hay nada que responder.
    if (pending) await api.replyPermission(permissionId, reply, folder);
  }

  private contextPercent(messages: OcMessage[]): number | null {
    const last = [...messages].reverse().find((m) => m.info.role === 'assistant' && (m.info.tokens?.input ?? 0) > 0);
    if (!last) return null;
    const limit = this.aiOptions.contextLimit(`${last.info.providerID}/${last.info.modelID}`);
    if (!limit) return null;
    const { input = 0, output = 0, cache } = last.info.tokens!;
    return Math.min(100, Math.round(((input + output + (cache?.read ?? 0)) / limit) * 100));
  }
}

/** Ruta relativa a la carpeta de la tarea si está dentro; si no, tal cual. */
function shortPath(path: string, folder: string): string {
  if (!path || !isAbsolute(path)) return path;
  const rel = relative(folder, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

/** Lo que se preguntó (sus nombres cortos) o, si ya se contestó, «Rama: main · Tests: Unitarios, e2e». */
function questionDetail(part: OcPart): string {
  const asked = Array.isArray(part.state?.input?.questions) ? (part.state.input.questions as { question?: unknown; header?: unknown }[]) : [];
  const name = (q: { question?: unknown; header?: unknown }) => str(q.header) || str(q.question);
  if (part.state?.status === 'completed') {
    // opencode resume las respuestas así: "pregunta"="respuesta", "pregunta"="respuesta".
    const answers = [...str(part.state.output).matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map(([, question, answer]) => {
      const q = asked.find((a) => str(a.question) === question);
      return `${q ? name(q) : question}: ${answer}`;
    });
    if (answers.length) return answers.join(' · ');
  }
  return asked.map(name).filter(Boolean).join(', ');
}

function toolDetail(part: OcPart, folder: string): string {
  const input = part.state?.input ?? {};
  if (part.tool === 'question') return clip(questionDetail(part), MAX_DETAIL);
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
  // De las preguntas basta el resumen de lo contestado.
  const output = part.tool === 'question' ? '' : status === 'error' ? str(state.error) : str(state.output);
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

export function toMessage({ info, parts }: OcMessage, folder: string): ChatMessage {
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
