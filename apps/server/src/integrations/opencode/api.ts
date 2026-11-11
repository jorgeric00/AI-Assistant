// Lo que la app usa de la API HTTP de `opencode serve` para las sesiones de desarrollo: modelos, agentes,
// sesiones, mensajes, permisos. Habla con la API de la 1.x y con la de la 2.x (/api/...), que es otra: al
// conectar mira cuál tiene el servidor y traduce las respuestas de la 2.x a las formas de la 1.x. Va con fetch (y no con el cliente generado del SDK) porque ese cliente solo
// conoce la API antigua de permisos, que no permite listar los pendientes.
import { t } from '../../i18n/index.js';
import { dirname } from 'node:path';
import { LlmUnavailableError, isConnectionError, type OpencodeConnection } from './connection.js';
import * as v2 from './v2.js';
import type { ChatQuestion } from '@dev-assistant/shared';

export interface OcModel {
  id: string;
  name?: string;
  limit?: { context?: number };
}
export interface OcProvider {
  id: string;
  name?: string;
  models: Record<string, OcModel>;
}
export interface OcAgent {
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
}
export interface OcToolState {
  status: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  title?: string;
  time?: { start?: number; end?: number };
}
export interface OcPart {
  id: string;
  type: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  state?: OcToolState;
}
export interface OcMessage {
  info: {
    id: string;
    role: string;
    agent?: string;
    mode?: string;
    providerID?: string;
    modelID?: string;
    model?: { providerID?: string; modelID?: string };
    time?: { created?: number; completed?: number };
    error?: { name?: string; data?: { message?: unknown } };
    tokens?: { input?: number; output?: number; cache?: { read?: number } };
  };
  parts: OcPart[];
}
export interface OcPermission {
  id: string;
  sessionID: string;
  /** Qué pide: bash, edit, webfetch... */
  permission?: string;
  patterns?: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
}
export interface OcSession {
  id: string;
  title?: string;
  parentID?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}
export interface OcQuestion extends ChatQuestion {
  sessionID: string;
}

export interface OcPromptBody {
  parts: { type: 'text'; text: string }[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  tools?: Record<string, boolean>;
}

const LOAD_RETRIES = 10;
const LOAD_RETRY_MS = 300;
const MESSAGE_PAGE = 200;
const MAX_MESSAGE_PAGES = 25;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OpencodeApi {
  /** Qué API tiene el servidor al que está conectada (se mira una vez por servidor). */
  private flavor: { baseUrl: string; v2: Promise<boolean> } | null = null;
  /** Modelo y modo que ya tiene cada sesión de la 2.x, para no cambiarlos en cada mensaje. */
  private readonly applied = new Map<string, { model?: string; agent?: string }>();

  constructor(private readonly connection: OpencodeConnection) {}

  /** URL de OPENCODE_URL; null si la app arranca su propio opencode. */
  get externalUrl(): string | null {
    return this.connection.externalUrl;
  }

  private async call<T>(
    method: string,
    path: string,
    { directory, query, body }: { directory?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const { baseUrl, headers } = await this.connection.connect();
    const params = new URLSearchParams();
    if (directory) params.set('directory', directory);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, v);
    const qs = params.toString();
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text.slice(0, 300) || res.statusText);
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (isConnectionError(err)) this.connection.reset();
      throw new LlmUnavailableError(t('ai.opencodeFailed', { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  /** Como `call`, pero un error que devuelve opencode también se muestra tal cual al usuario. */
  private async request<T>(method: string, path: string, opts: Parameters<OpencodeApi['call']>[2] = {}): Promise<T> {
    try {
      return await this.call<T>(method, path, opts);
    } catch (err) {
      if (err instanceof HttpError) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `${err.status} ${err.message}` }));
      throw err;
    }
  }

  /** true si el servidor tiene la API de la 2.x. */
  async isV2(): Promise<boolean> {
    const { baseUrl } = await this.connection.connect();
    if (this.flavor?.baseUrl !== baseUrl) {
      const v2Check = this.call<{ version?: unknown }>('GET', '/api/info')
        .then((info) => typeof info?.version === 'string')
        .catch(() => false);
      this.flavor = { baseUrl, v2: v2Check };
      this.applied.clear();
    }
    return this.flavor.v2;
  }

  /** La 2.x devuelve listas vacías mientras termina de cargar la configuración: se reintenta un poco. */
  private async loaded<T>(read: () => Promise<T[]>): Promise<T[]> {
    for (let attempt = 0; ; attempt++) {
      const list = await read();
      if (list.length || attempt >= LOAD_RETRIES) return list;
      await new Promise((r) => setTimeout(r, LOAD_RETRY_MS));
    }
  }

  /** `location[directory]` de la 2.x. */
  private static at(directory?: string) {
    return directory ? { 'location[directory]': directory } : {};
  }

  async providers(): Promise<{ providers: OcProvider[]; default?: Record<string, string> }> {
    if (!(await this.isV2())) return this.request('GET', '/config/providers');
    const providers = await this.loaded(async () => {
      const [list, models] = await Promise.all([
        this.request<{ data: v2.V2Provider[] }>('GET', '/api/provider'),
        this.request<{ data: v2.V2Model[] }>('GET', '/api/model'),
      ]);
      return v2.toProviders(list.data, models.data);
    });
    return { providers };
  }

  async config(): Promise<{ model?: string }> {
    if (!(await this.isV2())) return this.request('GET', '/config');
    const { data } = await this.request<{ data: v2.V2Model | null }>('GET', '/api/model/default');
    return data ? { model: `${data.providerID}/${data.id}` } : {};
  }

  /** Estado de cada servidor MCP de la configuración de opencode. */
  async mcp(directory?: string): Promise<Record<string, { status: string; error?: string }>> {
    if (!(await this.isV2())) return this.request('GET', '/mcp', { directory });
    const data = await this.loaded(
      async () =>
        (await this.request<{ data: { name: string; status: { status: string; error?: string } }[] }>('GET', '/api/mcp', { query: OpencodeApi.at(directory) })).data,
    );
    return Object.fromEntries(data.map((s) => [s.name, { status: s.status.status, error: s.status.error }]));
  }

  async health(): Promise<{ healthy: boolean; version?: string }> {
    if (!(await this.isV2())) return this.request('GET', '/global/health');
    const info = await this.request<{ version: string }>('GET', '/api/info');
    return { healthy: true, version: info.version };
  }

  /** Carpetas que usa opencode (la de configuración, entre otras). */
  async paths(): Promise<{ config?: string; home?: string }> {
    if (!(await this.isV2())) return this.request('GET', '/path');
    const docs = await this.request<{ type: string; path?: string }[]>('GET', '/api/config');
    const file = docs.find((d) => d.type === 'document' && d.path)?.path;
    return { config: file ? dirname(file) : undefined };
  }

  async agents(): Promise<OcAgent[]> {
    if (!(await this.isV2())) return this.request('GET', '/agent');
    return this.loaded(async () => (await this.request<{ data: v2.V2Agent[] }>('GET', '/api/agent')).data.map(v2.toAgent));
  }

  /** Sin título, opencode pone uno a partir del primer mensaje. */
  async createSession(directory: string, title?: string): Promise<{ id: string }> {
    if (!(await this.isV2())) return this.request('POST', '/session', { directory, body: title ? { title } : {} });
    const { data } = await this.request<{ data: v2.V2Session }>('POST', '/api/session', { body: { location: { directory }, ...(title ? { title } : {}) } });
    return { id: data.id };
  }

  /** Sesiones de opencode en esa carpeta (o en su proyecto). */
  async sessions(directory: string): Promise<OcSession[]> {
    if (!(await this.isV2())) return (await this.request<OcSession[]>('GET', '/session', { directory })) ?? [];
    const { data } = await this.request<{ data: v2.V2Session[] }>('GET', '/api/session', { query: { directory, limit: '200' } });
    return data.map(v2.toSession);
  }

  async deleteSession(sessionId: string, directory: string): Promise<void> {
    const isV2 = await this.isV2();
    try {
      if (isV2) await this.call<unknown>('DELETE', `/api/session/${sessionId}`);
      else await this.call<unknown>('DELETE', `/session/${sessionId}`, { directory });
    } catch (err) {
      // Si ya no existe, no hay nada que borrar.
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return;
      if (err instanceof HttpError) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `${err.status} ${err.message}` }));
      throw err;
    }
  }

  /** null si la sesión ya no existe en opencode (la borraron desde la terminal, cambió la base de datos...). */
  async messages(sessionId: string, directory: string): Promise<OcMessage[] | null> {
    const isV2 = await this.isV2();
    try {
      if (!isV2) return await this.call<OcMessage[]>('GET', `/session/${sessionId}/message`, { directory });
      // La 2.x da los mensajes por páginas (200 como mucho): se leen todas, de la más antigua a la más reciente.
      const all: v2.V2Message[] = [];
      let query: Record<string, string> = { order: 'asc', limit: String(MESSAGE_PAGE) };
      for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
        const { data, cursor } = await this.call<{ data: v2.V2Message[]; cursor?: { next?: string | null } }>('GET', `/api/session/${sessionId}/message`, { query });
        all.push(...data);
        if (!cursor?.next || data.length < MESSAGE_PAGE) break;
        query = { cursor: cursor.next, limit: String(MESSAGE_PAGE) };
      }
      return v2.toMessages(all);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
      if (err instanceof HttpError) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `${err.status} ${err.message}` }));
      throw err;
    }
  }

  /** Estado de las sesiones que no están en reposo. */
  async status(directory: string): Promise<Record<string, { type: string }>> {
    const isV2 = await this.isV2();
    try {
      if (!isV2) return (await this.call<Record<string, { type: string }>>('GET', '/session/status', { directory })) ?? {};
      const { data } = await this.call<{ data: Record<string, unknown> }>('GET', '/api/session/active');
      return Object.fromEntries(Object.keys(data ?? {}).map((id) => [id, { type: 'busy' }]));
    } catch (err) {
      if (err instanceof HttpError) return {};
      throw err;
    }
  }

  async prompt(sessionId: string, directory: string, body: OcPromptBody): Promise<void> {
    if (!(await this.isV2())) return this.request<void>('POST', `/session/${sessionId}/prompt_async`, { directory, body });
    // En la 2.x el modelo y el modo son de la sesión: se cambian antes del mensaje si hace falta.
    const applied = this.applied.get(sessionId) ?? {};
    const model = body.model ? `${body.model.providerID}/${body.model.modelID}` : undefined;
    if (model && model !== applied.model) {
      await this.request<void>('POST', `/api/session/${sessionId}/model`, { body: { model: { id: body.model!.modelID, providerID: body.model!.providerID } } });
      applied.model = model;
    }
    if (body.agent && body.agent !== applied.agent) {
      await this.request<void>('POST', `/api/session/${sessionId}/agent`, { body: { agent: body.agent } });
      applied.agent = body.agent;
    }
    this.applied.set(sessionId, applied);
    await this.request<unknown>('POST', `/api/session/${sessionId}/prompt`, { body: { text: body.parts.map((p) => p.text).join('\n\n') } });
  }

  async abort(sessionId: string, directory: string): Promise<unknown> {
    if (!(await this.isV2())) return this.request<unknown>('POST', `/session/${sessionId}/abort`, { directory });
    return this.request<unknown>('POST', `/api/session/${sessionId}/interrupt`);
  }

  /** Permisos pendientes de respuesta en esa carpeta (vacío si esta versión de opencode no los lista). */
  async permissions(directory: string): Promise<OcPermission[]> {
    const isV2 = await this.isV2();
    try {
      if (!isV2) return (await this.call<OcPermission[]>('GET', '/permission', { directory })) ?? [];
      const { data } = await this.call<{ data: v2.V2Permission[] }>('GET', '/api/permission/request', { query: OpencodeApi.at(directory) });
      return data.map(v2.toPermission);
    } catch (err) {
      if (err instanceof HttpError) return [];
      throw err;
    }
  }

  async replyPermission(permissionId: string, reply: 'once' | 'always' | 'reject', directory: string): Promise<unknown> {
    if (!(await this.isV2())) return this.request<unknown>('POST', `/permission/${permissionId}/reply`, { directory, body: { reply } });
    // La 2.x responde por sesión: se busca a cuál pertenece el permiso.
    const pending = (await this.permissions(directory)).find((p) => p.id === permissionId);
    if (!pending) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `permission ${permissionId} not found` }));
    return this.request<unknown>('POST', `/api/session/${pending.sessionID}/permission/${permissionId}/reply`, { body: { decision: reply } });
  }

  /** Preguntas de opencode pendientes en esa carpeta. La 1.x no las da: la app le quita esa herramienta. */
  async questions(directory: string): Promise<OcQuestion[]> {
    if (!(await this.isV2())) return [];
    try {
      const { data } = await this.call<{ data: v2.V2Form[] }>('GET', '/api/form', { query: OpencodeApi.at(directory) });
      return data.map(v2.toQuestion).filter((q): q is OcQuestion => !!q);
    } catch (err) {
      if (err instanceof HttpError) return [];
      throw err;
    }
  }

  async replyQuestion(sessionId: string, questionId: string, answer: Record<string, string | string[]>): Promise<void> {
    await this.request<void>('POST', `/api/session/${sessionId}/form/${questionId}/reply`, { body: { answer } });
  }

  /** La deja sin contestar: opencode sigue sin la respuesta. */
  async dismissQuestion(sessionId: string, questionId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/session/${sessionId}/form/${questionId}`);
  }

  /** 2.x: texto generado por el modelo sin herramientas ni sesión (lo que usa la IA de la app). */
  async generate(prompt: string, model?: { providerID: string; modelID: string }): Promise<string> {
    const { data } = await this.request<{ data: { text?: string } }>('POST', '/api/experimental/generate', {
      body: { prompt, ...(model ? { model: { id: model.modelID, providerID: model.providerID } } : {}) },
    });
    return data?.text ?? '';
  }
}
