// Lee los servidores MCP configurados en opencode para reutilizarlos en la app
// (diseño, sección 6.1). Formato de opencode:
//   "mcp": { "<nombre>": { "type": "local", "command": [...], "environment": {...} }
//          , "<nombre>": { "type": "remote", "url": "...", "headers": {...} } }
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const LocalServer = z.object({
  type: z.literal('local'),
  command: z.array(z.string()).min(1),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const RemoteServer = z.object({
  type: z.literal('remote'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const OpencodeConfig = z.looseObject({
  mcp: z.record(z.string(), z.discriminatedUnion('type', [LocalServer, RemoteServer])).optional(),
});

export type McpServerDef = (
  | { name: string; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { name: string; transport: 'http'; url: string; headers: Record<string, string> }
) & {
  /** Variables {env:VAR} que usa el servidor y no están definidas (se sustituyen por vacío). */
  missingEnv: string[];
};

/** Quita comentarios // y /* *\/ fuera de cadenas (opencode admite JSONC). */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const next = input[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += input[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Sustituye {env:VAR} como hace opencode; anota en `missing` las variables que no existen. */
function substituteEnv(value: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    if (env[name] === undefined) missing.add(name);
    return env[name] ?? '';
  });
}

const mapValues = (obj: Record<string, string> | undefined, env: NodeJS.ProcessEnv, missing: Set<string>) =>
  Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, substituteEnv(v, env, missing)]));

export function parseOpencodeMcpServers(raw: string, env: NodeJS.ProcessEnv = process.env): McpServerDef[] {
  const config = OpencodeConfig.parse(JSON.parse(stripJsonComments(raw)));
  return Object.entries(config.mcp ?? {})
    .filter(([, def]) => def.enabled !== false)
    .map(([name, def]): McpServerDef => {
      const missing = new Set<string>();
      if (def.type === 'local') {
        const [command, ...args] = def.command.map((part) => substituteEnv(part, env, missing));
        const environment = mapValues(def.environment, env, missing);
        return { name, transport: 'stdio', command: command!, args, env: environment, missingEnv: [...missing] };
      }
      const url = substituteEnv(def.url, env, missing);
      const headers = mapValues(def.headers, env, missing);
      return { name, transport: 'http', url, headers, missingEnv: [...missing] };
    });
}

export function readOpencodeMcpServers(path: string, env: NodeJS.ProcessEnv = process.env): McpServerDef[] {
  return parseOpencodeMcpServers(readFileSync(path, 'utf8'), env);
}
