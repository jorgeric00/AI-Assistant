// Chat general con opencode: conversaciones que no van con ninguna tarea. Cada una es una sesión de opencode
// que arranca en una carpeta propia de la app (<DEV_ASSISTANT_HOME>/chat); su AGENTS.md le dice a opencode
// que no hay carpeta por defecto: si le piden un fichero, pregunta dónde y al acabar da la ruta completa.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ChatPermissionReply, ChatQuestionReplyInput, ChatSendInput, ConversationList, GeneralChat } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { LlmUnavailableError } from '../../integrations/opencode/connection.js';
import { t } from '../../i18n/index.js';
import type { AiSettingsStore } from './ai-settings.js';
import { clip, type OpencodeChat } from './chat-core.js';

const STORE_KEY = 'chat.general';
const MAX_TITLE = 80;
/** Título que pone opencode hasta que genera uno a partir del primer mensaje. */
const DEFAULT_TITLE = /^(New session|Child session) - \d/;

interface Stored {
  sessionId: string;
  model: string | null;
  agent: string;
  createdAt: string;
  /** El principio del primer mensaje: el título mientras opencode no ponga uno. */
  firstText: string;
}

export class GeneralChatService {
  readonly folder: string;

  constructor(
    private readonly db: Db,
    private readonly chat: OpencodeChat,
    private readonly aiSettings: AiSettingsStore,
    devAssistantHome: string,
  ) {
    this.folder = join(devAssistantHome, 'chat');
  }

  private all(): Stored[] {
    const value = this.db.select().from(settings).where(eq(settings.key, STORE_KEY)).get()?.valueJson;
    return Array.isArray(value) ? (value as Stored[]).filter((c) => typeof c?.sessionId === 'string') : [];
  }

  private saveAll(list: Stored[]) {
    this.db.insert(settings).values({ key: STORE_KEY, valueJson: list }).onConflictDoUpdate({ target: settings.key, set: { valueJson: list } }).run();
  }

  private find(id: string) {
    return this.all().find((c) => c.sessionId === id) ?? null;
  }

  private upsert(conversation: Stored) {
    this.saveAll([conversation, ...this.all().filter((c) => c.sessionId !== conversation.sessionId)]);
  }

  private remove(id: string) {
    this.saveAll(this.all().filter((c) => c.sessionId !== id));
  }

  /** Una conversación nueva, aún sin mensajes, con el modelo y el modo de Ajustes. */
  empty(extra: Partial<GeneralChat> = {}): GeneralChat {
    const defaults = this.aiSettings.get();
    return {
      id: null,
      title: null,
      available: this.chat.available,
      error: this.chat.available ? null : t('ai.notConfigured'),
      started: false,
      busy: false,
      messages: [],
      permissions: [],
      questions: [],
      model: defaults.sessionModel,
      agent: defaults.sessionAgent,
      contextPercent: null,
      ...extra,
    };
  }

  async list(): Promise<ConversationList> {
    const stored = this.all();
    if (!this.chat.available) return { available: false, error: t('ai.notConfigured'), conversations: [] };
    let titles = new Map<string, { title?: string; updated?: number }>();
    let error: string | null = null;
    try {
      const sessions = await this.chat.requireApi().sessions(this.folder);
      titles = new Map(sessions.map((s) => [s.id, { title: s.title, updated: s.time?.updated }]));
    } catch (err) {
      // Sin opencode la lista se enseña igual, con los títulos que se guardaron.
      if (!(err instanceof LlmUnavailableError)) throw err;
      error = err.message;
    }
    const conversations = stored.map((c) => {
      const info = titles.get(c.sessionId);
      return {
        id: c.sessionId,
        title: this.title(c, info?.title),
        updatedAt: new Date(info?.updated ?? Date.parse(c.createdAt)).toISOString(),
      };
    });
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { available: !error, error, conversations };
  }

  private title(c: Stored, fromOpencode?: string) {
    return fromOpencode && !DEFAULT_TITLE.test(fromOpencode) ? clip(fromOpencode, MAX_TITLE) : c.firstText || t('chat.general.untitled');
  }

  /** null si la conversación no es del chat general (o ya no existe en opencode). */
  async get(id: string): Promise<GeneralChat | null> {
    const stored = this.find(id);
    if (!stored) return null;
    const base = this.empty({ id, title: this.title(stored), model: stored.model, agent: stored.agent, started: true });
    if (!this.chat.available) return base;
    try {
      const view = await this.chat.view(id, this.folder);
      if (!view) {
        // La borraron en opencode (desde la terminal, por ejemplo): sale también de la lista.
        this.remove(id);
        return null;
      }
      const session = (await this.chat.requireApi().sessions(this.folder).catch(() => [])).find((s) => s.id === id);
      return { ...base, title: this.title(stored, session?.title), ...view };
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { ...base, available: false, error: err.message };
      throw err;
    }
  }

  /** Empieza una conversación con su primer mensaje. */
  async start(input: ChatSendInput): Promise<GeneralChat> {
    const api = this.chat.requireApi();
    const defaults = this.aiSettings.get();
    await this.prepareFolder();
    const session = await api.createSession(this.folder);
    const stored: Stored = {
      sessionId: session.id,
      model: input.model !== undefined ? input.model : defaults.sessionModel,
      agent: input.agent ?? defaults.sessionAgent,
      createdAt: new Date().toISOString(),
      firstText: clip(input.text.replace(/\s+/g, ' ').trim(), MAX_TITLE),
    };
    this.upsert(stored);
    await this.chat.prompt(stored.sessionId, this.folder, input.text, stored.model, stored.agent);
    return { ...((await this.get(stored.sessionId)) ?? this.empty({ id: stored.sessionId })), busy: true };
  }

  async send(id: string, input: ChatSendInput): Promise<GeneralChat | null> {
    const stored = this.find(id);
    if (!stored) return null;
    if (!(await this.chat.exists(id, this.folder))) {
      this.remove(id);
      return null;
    }
    const updated = { ...stored, model: input.model !== undefined ? input.model : stored.model, agent: input.agent ?? stored.agent };
    this.upsert(updated);
    await this.prepareFolder();
    await this.chat.prompt(id, this.folder, input.text, updated.model, updated.agent);
    const chat = await this.get(id);
    return chat && { ...chat, busy: true };
  }

  async abort(id: string): Promise<GeneralChat | null> {
    if (!this.find(id)) return null;
    await this.chat.stop(id, this.folder);
    return this.get(id);
  }

  async replyPermission(id: string, permissionId: string, reply: ChatPermissionReply): Promise<GeneralChat | null> {
    if (!this.find(id)) return null;
    await this.chat.replyPermission(permissionId, reply, this.folder);
    return this.get(id);
  }

  async replyQuestion(id: string, questionId: string, input: ChatQuestionReplyInput): Promise<GeneralChat | null> {
    if (!this.find(id)) return null;
    await this.chat.replyQuestion(questionId, input, this.folder);
    return this.get(id);
  }

  /** La borra de la app y de opencode. */
  async delete(id: string): Promise<boolean> {
    if (!this.find(id)) return false;
    if (this.chat.available) {
      await this.chat.stop(id, this.folder).catch(() => {});
      await this.chat.requireApi().deleteSession(id, this.folder);
    }
    this.remove(id);
    return true;
  }

  /** La carpeta de arranque con su AGENTS.md al día (en el idioma de la app). */
  private async prepareFolder() {
    await mkdir(this.folder, { recursive: true });
    await writeFile(join(this.folder, 'AGENTS.md'), t('chat.general.instructions'), 'utf8');
  }
}
