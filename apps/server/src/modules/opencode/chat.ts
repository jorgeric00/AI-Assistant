// Sesión con opencode dentro de la app: un chat por tarea, en la carpeta de la tarea, con el modelo y el
// modo que se elijan en cada mensaje. opencode hace el trabajo; la app envía los mensajes, enseña lo que
// va haciendo y pregunta los permisos.
import { eq } from 'drizzle-orm';
import type { ChatPermissionReply, ChatQuestionReplyInput, ChatSendInput, TaskChat } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { LlmUnavailableError } from '../../integrations/opencode/connection.js';
import { t } from '../../i18n/index.js';
import type { DevSessionService } from '../tasks/session.js';
import type { AiSettingsStore } from './ai-settings.js';
import type { OpencodeChat } from './chat-core.js';

interface Stored {
  sessionId: string;
  model: string | null;
  agent: string;
}

export class TaskChatService {
  constructor(
    private readonly db: Db,
    private readonly chat: OpencodeChat,
    private readonly sessions: DevSessionService,
    private readonly aiSettings: AiSettingsStore,
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
      questions: [],
      model: stored ? stored.model : defaults.sessionModel,
      agent: stored?.agent ?? defaults.sessionAgent,
      contextPercent: null,
      starterPrompt: this.sessions.prompt(key),
      ...extra,
    };
  }

  async get(key: string): Promise<TaskChat> {
    const stored = this.stored(key);
    if (!this.chat.available) return this.empty(key, stored, { available: false, error: t('ai.notConfigured') });
    // Sin sesión no se molesta a opencode: ver la página no lo arranca.
    if (!stored) return this.empty(key, null);
    try {
      const view = await this.chat.view(stored.sessionId, this.sessions.folder(key), { allPermissions: true });
      if (!view) {
        // La sesión ya no existe en opencode: se empieza otra con el siguiente mensaje.
        this.forget(key);
        return this.empty(key, null);
      }
      return { ...this.empty(key, stored), started: true, ...view };
    } catch (err) {
      if (err instanceof LlmUnavailableError) return this.empty(key, stored, { available: false, error: err.message, started: true });
      throw err;
    }
  }

  async send(key: string, input: ChatSendInput): Promise<TaskChat> {
    const api = this.chat.requireApi();
    let stored = this.stored(key);
    const defaults = this.aiSettings.get();
    const model = input.model !== undefined ? input.model : stored ? stored.model : defaults.sessionModel;
    const agent = input.agent ?? stored?.agent ?? defaults.sessionAgent;
    const folder = this.sessions.folder(key);
    if (stored && !(await this.chat.exists(stored.sessionId, folder))) stored = null;
    // TAREA.md y AGENTS.md al día en cada mensaje: son el contexto de la tarea que lee opencode.
    await this.sessions.prepare(key);
    if (!stored) {
      const session = await api.createSession(folder, `${key} · AI-Assistant`);
      stored = { sessionId: session.id, model, agent };
    }
    this.save(key, { sessionId: stored.sessionId, model, agent });
    await this.chat.prompt(stored.sessionId, folder, input.text, model, agent);
    // opencode tarda un instante en marcar la sesión como ocupada: recién enviado, lo está.
    return { ...(await this.get(key)), busy: true };
  }

  async abort(key: string): Promise<TaskChat> {
    const stored = this.stored(key);
    if (stored) await this.chat.stop(stored.sessionId, this.sessions.folder(key));
    else this.chat.requireApi();
    return this.get(key);
  }

  /** Deja la sesión actual (sigue en el historial de opencode) para empezar otra con el siguiente mensaje. */
  async reset(key: string): Promise<TaskChat> {
    const stored = this.stored(key);
    if (stored && this.chat.available) await this.chat.stop(stored.sessionId, this.sessions.folder(key)).catch(() => {});
    this.forget(key);
    return this.get(key);
  }

  async replyPermission(key: string, permissionId: string, reply: ChatPermissionReply): Promise<TaskChat> {
    await this.chat.replyPermission(permissionId, reply, this.sessions.folder(key));
    return this.get(key);
  }

  async replyQuestion(key: string, questionId: string, input: ChatQuestionReplyInput): Promise<TaskChat> {
    await this.chat.replyQuestion(questionId, input, this.sessions.folder(key));
    return this.get(key);
  }
}

const storeKey = (key: string) => `chat.session.${key}`;
