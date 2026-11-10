// Ajustes > Inteligencia artificial: qué modelo usa la IA de la app y con qué modelo y modo empiezan
// las sesiones de desarrollo. Los modelos y modos disponibles se leen del opencode del usuario.
import { eq } from 'drizzle-orm';
import { AiSettings, type AiOptions, type AiSettingsUpdate } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import type { OpencodeApi } from '../../integrations/opencode/api.js';
import { LlmUnavailableError } from '../../integrations/opencode/connection.js';
import { t } from '../../i18n/index.js';

const KEY = 'ai.settings';
const DEFAULTS: AiSettings = { appModel: null, sessionModel: null, sessionAgent: 'build' };

export class AiSettingsStore {
  constructor(private readonly db: Db) {}

  get(): AiSettings {
    const stored = this.db.select().from(settings).where(eq(settings.key, KEY)).get()?.valueJson;
    const parsed = AiSettings.safeParse({ ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) });
    return parsed.success ? parsed.data : DEFAULTS;
  }

  update(change: AiSettingsUpdate): AiSettings {
    const next = { ...this.get(), ...change };
    this.db.insert(settings).values({ key: KEY, valueJson: next }).onConflictDoUpdate({ target: settings.key, set: { valueJson: next } }).run();
    return next;
  }
}

/** Cuánto se reutiliza la lista de modelos antes de volver a pedírsela a opencode. */
const CACHE_MS = 60_000;

export class AiOptionsService {
  private cached: { at: number; options: AiOptions; limits: Map<string, number> } | undefined;

  constructor(private readonly api: OpencodeApi | null) {}

  private async load(refresh: boolean) {
    if (!this.api) return { options: unavailable(t('ai.notConfigured')), limits: new Map<string, number>() };
    if (!refresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached;
    try {
      const [{ providers }, config, agents] = await Promise.all([this.api.providers(), this.api.config(), this.api.agents()]);
      const limits = new Map<string, number>();
      const options: AiOptions = {
        available: true,
        error: null,
        providers: providers
          .map((p) => ({
            id: p.id,
            name: p.name ?? p.id,
            models: Object.entries(p.models ?? {})
              .map(([id, m]) => {
                if (m.limit?.context) limits.set(`${p.id}/${id}`, m.limit.context);
                return { id: `${p.id}/${id}`, name: m.name ?? id };
              })
              .sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .filter((p) => p.models.length),
        defaultModel: typeof config?.model === 'string' && config.model.includes('/') ? config.model : null,
        // Los subagentes y los agentes internos (título, resumen...) no se eligen a mano.
        agents: agents.filter((a) => a.mode !== 'subagent' && !a.hidden).map((a) => ({ name: a.name, description: a.description ?? null })),
      };
      this.cached = { at: Date.now(), options, limits };
      return this.cached;
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { options: unavailable(err.message), limits: new Map<string, number>() };
      throw err;
    }
  }

  async options(refresh = false): Promise<AiOptions> {
    return (await this.load(refresh)).options;
  }

  /** Tamaño de la ventana de contexto del modelo, si opencode lo dice (y ya se había cargado la lista). */
  contextLimit(model: string): number | null {
    return this.cached?.limits.get(model) ?? null;
  }

  /** Carga la lista si aún no está, sin esperar a que termine. */
  warm() {
    if (!this.cached) void this.load(false).catch(() => {});
  }
}

function unavailable(error: string): AiOptions {
  return { available: false, error, providers: [], defaultModel: null, agents: [] };
}
