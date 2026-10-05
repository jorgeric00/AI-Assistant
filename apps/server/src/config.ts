import { homedir } from 'node:os';
import { resolve } from 'node:path';

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export interface AppConfig {
  host: '127.0.0.1';
  port: number;
  databasePath: string;
  opencodeConfigPath: string;
  opencodeUrl: string | undefined;
  teamsWebhookUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // R1/R2: solo local. No se permite escuchar en otras interfaces.
    host: '127.0.0.1',
    port: Number(env.PORT ?? 4321),
    databasePath: expandHome(env.DATABASE_PATH ?? './data/assistant.db'),
    opencodeConfigPath: expandHome(env.OPENCODE_CONFIG ?? '~/.config/opencode/opencode.json'),
    opencodeUrl: env.OPENCODE_URL || undefined,
    teamsWebhookUrl: env.TEAMS_WEBHOOK_URL || undefined,
  };
}
