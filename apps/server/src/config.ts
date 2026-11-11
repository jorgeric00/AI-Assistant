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
  /** Contraseña del opencode de OPENCODE_URL (OPENCODE_SERVER_PASSWORD), si la pide. */
  opencodePassword: string | undefined;
  teamsWebhookUrl: string | undefined;
  /** Carpeta de trabajo de la app: worktrees/<CLAVE>/ con PLAN.md e HISTORIAL.md de cada tarea. */
  devAssistantHome: string;
  /** Carpeta global de skills de opencode, donde se instala la skill de la app. */
  opencodeSkillsDir: string;
  /** Lectura de JIRA por API REST; sin URL y token la sección de tareas indica cómo configurarla. */
  jira: { baseUrl: string; token: string; email: string | undefined; jql: string } | undefined;
  /** Avisos de tus PR: token de GitHub de solo lectura. Sin él no se consulta GitHub. */
  github: { token: string; graphqlUrl: string | undefined } | undefined;
}

/** Todas las tareas asignadas, no solo el sprint activo (R9). */
export const DEFAULT_JIRA_JQL = 'assignee = currentUser() ORDER BY updated DESC';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // R1/R2: solo local. No se permite escuchar en otras interfaces.
    host: '127.0.0.1',
    port: Number(env.PORT ?? 4321),
    databasePath: expandHome(env.DATABASE_PATH ?? './data/assistant.db'),
    opencodeConfigPath: expandHome(env.OPENCODE_CONFIG ?? '~/.config/opencode/opencode.json'),
    opencodeUrl: env.OPENCODE_URL || undefined,
    opencodePassword: env.OPENCODE_SERVER_PASSWORD || undefined,
    teamsWebhookUrl: env.TEAMS_WEBHOOK_URL || undefined,
    devAssistantHome: expandHome(env.DEV_ASSISTANT_HOME ?? '~/.dev-assistant'),
    opencodeSkillsDir: expandHome(env.OPENCODE_SKILLS_DIR ?? '~/.config/opencode/skill'),
    jira:
      env.JIRA_URL && env.JIRA_TOKEN
        ? { baseUrl: env.JIRA_URL, token: env.JIRA_TOKEN, email: env.JIRA_EMAIL || undefined, jql: env.JIRA_JQL || DEFAULT_JIRA_JQL }
        : undefined,
    github: env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN, graphqlUrl: env.GITHUB_GRAPHQL_URL || undefined } : undefined,
  };
}
