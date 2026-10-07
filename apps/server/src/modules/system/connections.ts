// Ajustes > Conexiones: URL y tokens de JIRA y GitHub. Se guardan en el mismo .env de la app (no en la base de
// datos, así no van en las copias) y se aplican al momento. Los tokens nunca se devuelven, solo sus 4 últimos
// caracteres. JIRA_MCP_TOKEN no lo usa la app: lo hereda opencode al abrirlo desde la app ({env:JIRA_MCP_TOKEN}).
import { readFile, writeFile } from 'node:fs/promises';
import type { ConnectionsStatus, ConnectionsUpdate, ConnectionTestResult, SecretState } from '@dev-assistant/shared';
import { loadConfig } from '../../config.js';
import { GithubClient } from '../../integrations/github/client.js';
import { JiraClient } from '../../integrations/jira/client.js';

const VARS = { jiraUrl: 'JIRA_URL', jiraToken: 'JIRA_TOKEN', jiraMcpToken: 'JIRA_MCP_TOKEN', githubToken: 'GITHUB_TOKEN' } as const;
type Field = keyof typeof VARS;

const secret = (value: string | undefined): SecretState => (value ? { set: true, hint: value.length >= 12 ? value.slice(-4) : null } : { set: false, hint: null });

/** Valor tal cual si es seguro; si no, entre comillas simples (las entiende el --env-file de Node). */
function envValue(value: string): string {
  if (/^[\w.:/+=@,~%-]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Cambia o quita variables en el texto de un .env, sin tocar el resto de líneas ni los comentarios. */
export function patchEnv(text: string, changes: Record<string, string | null>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  for (const [name, value] of Object.entries(changes)) {
    const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
    const idx = lines.findIndex((l) => re.test(l));
    // Si la variable estaba repetida, se queda solo la primera.
    lines = lines.filter((l, i) => i === idx || !re.test(l));
    const line = value === null ? [] : [`${name}=${envValue(value)}`];
    if (idx >= 0) lines.splice(idx, 1, ...line);
    else lines.push(...line);
  }
  return lines.length ? lines.join(eol) + eol : '';
}

export type ConnectionsListener = (env: NodeJS.ProcessEnv, changed: { jira: boolean; github: boolean }) => void;

export class Connections {
  private listeners: ConnectionsListener[] = [];

  constructor(
    readonly envFile: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  onChange(listener: ConnectionsListener) {
    this.listeners.push(listener);
  }

  status(): ConnectionsStatus {
    return {
      jiraUrl: this.env.JIRA_URL || null,
      jiraToken: secret(this.env.JIRA_TOKEN),
      jiraMcpToken: secret(this.env.JIRA_MCP_TOKEN),
      githubToken: secret(this.env.GITHUB_TOKEN),
      envFile: this.envFile,
    };
  }

  async update(input: ConnectionsUpdate): Promise<ConnectionsStatus> {
    const changes: Record<string, string | null> = {};
    for (const field of Object.keys(VARS) as Field[]) {
      const value = input[field];
      if (value !== undefined) changes[VARS[field]] = value;
    }
    if (!Object.keys(changes).length) return this.status();

    let text = '';
    try {
      text = await readFile(this.envFile, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await writeFile(this.envFile, patchEnv(text, changes), 'utf8');
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) delete this.env[name];
      else this.env[name] = value;
    }
    const changed = { jira: 'JIRA_URL' in changes || 'JIRA_TOKEN' in changes, github: 'GITHUB_TOKEN' in changes };
    for (const listener of this.listeners) listener(this.env, changed);
    return this.status();
  }

  /** "Probar conexión": con qué usuario entra el token guardado. */
  async test(target: 'jira' | 'github'): Promise<ConnectionTestResult> {
    const config = loadConfig(this.env);
    try {
      if (target === 'jira') {
        if (!config.jira) return { ok: false, user: null, error: 'Falta la URL o el token de JIRA.' };
        return { ok: true, user: await new JiraClient(config.jira, this.fetchImpl).myself(), error: null };
      }
      if (!config.github) return { ok: false, user: null, error: 'Falta el token de GitHub.' };
      return { ok: true, user: await new GithubClient(config.github, this.fetchImpl).viewer(), error: null };
    } catch (err) {
      return { ok: false, user: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
