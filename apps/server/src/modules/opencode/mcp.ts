// Ajustes > Inteligencia artificial: qué servidores MCP ve el opencode de la app y si arrancan. Sirve para ver
// por qué opencode no tiene una herramienta (GitHub, JIRA...) que sí tiene al abrirlo desde la terminal.
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { McpOverview, McpServer, McpState } from '@dev-assistant/shared';
import type { OpencodeApi } from '../../integrations/opencode/api.js';
import { t } from '../../i18n/index.js';

const STATES: Record<string, McpState> = {
  connected: 'connected',
  failed: 'failed',
  disabled: 'disabled',
  needs_auth: 'needs_auth',
  needs_client_registration: 'needs_auth',
};

/** Ruta del ejecutable que lanzaría `name` con este PATH (lo que hace `which`); null si no está. */
export async function whichBinary(name: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string | null> {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = join(dir, name + ext.toLowerCase());
      try {
        await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return file;
      } catch {
        // sigue buscando
      }
    }
  }
  return null;
}

export class McpService {
  constructor(
    private readonly api: OpencodeApi | null,
    private readonly findBinary: () => Promise<string | null> = () => whichBinary('opencode'),
  ) {}

  async overview(): Promise<McpOverview> {
    const url = this.api?.externalUrl ?? null;
    const binary = url ? null : await this.findBinary();
    const base = {
      version: null,
      binary,
      url,
      configDir: null,
      servers: [] as McpServer[],
    };
    if (!this.api) return { ...base, available: false, error: t('ai.notConfigured') };
    try {
      const [mcp, health, paths] = await Promise.all([this.api.mcp(), this.api.health().catch(() => null), this.api.paths().catch(() => null)]);
      const servers = Object.entries(mcp)
        .map(([name, s]): McpServer => {
          const state = STATES[s.status] ?? 'unknown';
          return {
            name,
            state,
            error: state === 'failed' ? (s.error ?? null) : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        ...base,
        available: true,
        error: null,
        version: health?.version ?? null,
        configDir: paths?.config ?? null,
        servers,
      };
    } catch (err) {
      return {
        ...base,
        available: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
