// Lo que la app usa de la API HTTP de `opencode serve` para las sesiones de desarrollo: modelos, agentes,
// sesiones, mensajes, permisos. Va con fetch (y no con el cliente generado del SDK) porque ese cliente solo
// conoce la API antigua de permisos, que no permite listar los pendientes.
import { t } from '../../i18n/index.js';
import { LlmUnavailableError, isConnectionError, type OpencodeConnection } from './connection.js';

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
export interface OcPromptBody {
  parts: { type: 'text'; text: string }[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  tools?: Record<string, boolean>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OpencodeApi {
  constructor(private readonly connection: OpencodeConnection) {}

  private async call<T>(method: string, path: string, { directory, body }: { directory?: string; body?: unknown } = {}): Promise<T> {
    const { baseUrl } = await this.connection.connect();
    const url = `${baseUrl}${path}${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`;
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
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
  private async request<T>(method: string, path: string, opts: { directory?: string; body?: unknown } = {}): Promise<T> {
    try {
      return await this.call<T>(method, path, opts);
    } catch (err) {
      if (err instanceof HttpError) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `${err.status} ${err.message}` }));
      throw err;
    }
  }

  providers() {
    return this.request<{ providers: OcProvider[]; default?: Record<string, string> }>('GET', '/config/providers');
  }

  config() {
    return this.request<{ model?: string }>('GET', '/config');
  }

  agents() {
    return this.request<OcAgent[]>('GET', '/agent');
  }

  createSession(directory: string, title: string) {
    return this.request<{ id: string }>('POST', '/session', { directory, body: { title } });
  }

  /** null si la sesión ya no existe en opencode (la borraron desde la terminal, cambió la base de datos...). */
  async messages(sessionId: string, directory: string): Promise<OcMessage[] | null> {
    try {
      return await this.call<OcMessage[]>('GET', `/session/${sessionId}/message`, { directory });
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
      if (err instanceof HttpError) throw new LlmUnavailableError(t('ai.opencodeFailed', { message: `${err.status} ${err.message}` }));
      throw err;
    }
  }

  /** Estado de las sesiones que no están en reposo. */
  async status(directory: string): Promise<Record<string, { type: string }>> {
    try {
      return (await this.call<Record<string, { type: string }>>('GET', '/session/status', { directory })) ?? {};
    } catch (err) {
      if (err instanceof HttpError) return {};
      throw err;
    }
  }

  prompt(sessionId: string, directory: string, body: OcPromptBody) {
    return this.request<void>('POST', `/session/${sessionId}/prompt_async`, { directory, body });
  }

  abort(sessionId: string, directory: string) {
    return this.request<unknown>('POST', `/session/${sessionId}/abort`, { directory });
  }

  /** Permisos pendientes de respuesta en esa carpeta (vacío si esta versión de opencode no los lista). */
  async permissions(directory: string): Promise<OcPermission[]> {
    try {
      return (await this.call<OcPermission[]>('GET', '/permission', { directory })) ?? [];
    } catch (err) {
      if (err instanceof HttpError) return [];
      throw err;
    }
  }

  replyPermission(permissionId: string, reply: 'once' | 'always' | 'reject', directory: string) {
    return this.request<unknown>('POST', `/permission/${permissionId}/reply`, { directory, body: { reply } });
  }
}
