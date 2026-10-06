// Escritura en JIRA por el MCP de JIRA que ya está configurado en opencode (decisión de Jorge:
// leer por la API REST, escribir por el MCP). Herramientas de mcp-atlassian:
//   jira_add_comment { issue_key, comment }   jira_transition_issue { issue_key, transition_id }
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readOpencodeMcpServers, type McpServerDef } from '../mcp/opencode-config.js';
import { JiraError } from './client.js';

/** Lo que la app necesita para escribir en JIRA. */
export interface JiraWriter {
  /** Servidor MCP que se usará, o por qué no se puede escribir. */
  status(): { server: string | null; problem: string | null };
  addComment(key: string, comment: string): Promise<void>;
  transition(key: string, transitionId: string): Promise<void>;
  close(): Promise<void>;
}

/** Herramienta MCP: nombre y argumentos → texto de la respuesta. */
export interface McpSession {
  callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

const TIMEOUT_MS = 60_000;

/** opencode lee opencode.json y opencode.jsonc: se prueban los dos. */
export function opencodeConfigCandidates(configPath: string): string[] {
  const base = configPath.replace(/\.jsonc?$/, '');
  return configPath.endsWith('.jsonc') ? [configPath, `${base}.json`] : [configPath, `${base}.jsonc`];
}

/**
 * Busca el servidor MCP de JIRA en la configuración de opencode: el que indique JIRA_MCP_SERVER o,
 * si no, el primero cuyo nombre contenga "jira" o "atlassian".
 */
export function findJiraMcpServer(configPath: string, preferred: string | undefined, env: NodeJS.ProcessEnv = process.env): McpServerDef {
  const files = opencodeConfigCandidates(configPath).filter((p) => existsSync(p));
  if (!files.length) {
    throw new JiraError(`No se encuentra la configuración de opencode (${configPath} o .jsonc), donde está el MCP de JIRA.`);
  }
  const servers: McpServerDef[] = [];
  for (const file of files) {
    try {
      servers.push(...readOpencodeMcpServers(file, env));
    } catch (err) {
      throw new JiraError(`No se pudo leer ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const server = preferred ? servers.find((s) => s.name === preferred) : servers.find((s) => /jira|atlassian/i.test(s.name));
  if (!server) {
    throw new JiraError(
      preferred
        ? `No hay ningún servidor MCP llamado "${preferred}" (JIRA_MCP_SERVER) en la configuración de opencode.`
        : 'No hay ningún servidor MCP de JIRA en la configuración de opencode (se busca uno cuyo nombre contenga "jira").',
    );
  }
  if (server.missingEnv.length) {
    throw new JiraError(
      `El MCP de JIRA de opencode usa ${server.missingEnv.map((v) => `{env:${v}}`).join(', ')}, pero la app no tiene esa variable. Añádela al fichero .env de la app o a las variables de entorno de Windows.`,
    );
  }
  return server;
}

/** Abre una sesión MCP con el servidor (HTTP con sus cabeceras, o el comando local). */
export async function connectMcp(server: McpServerDef): Promise<McpSession> {
  const transport =
    server.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      : new StdioClientTransport({ command: server.command, args: server.args, env: { ...(process.env as Record<string, string>), ...server.env } });
  const client = new Client({ name: 'dev-assistant', version: '0.1.0' });
  await client.connect(transport, { timeout: TIMEOUT_MS });
  return {
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT_MS });
      const content = Array.isArray(result.content) ? (result.content as { type: string; text?: string }[]) : [];
      const text = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
      return { isError: result.isError === true, text };
    },
    close: () => client.close(),
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class McpJiraWriter implements JiraWriter {
  private session: Promise<McpSession> | null = null;
  private serverName: string | null = null;

  constructor(
    private readonly configPath: string,
    private readonly preferred: string | undefined,
    private readonly connect: (server: McpServerDef) => Promise<McpSession> = connectMcp,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  status() {
    try {
      return { server: findJiraMcpServer(this.configPath, this.preferred, this.env).name, problem: null };
    } catch (err) {
      return { server: null, problem: message(err) };
    }
  }

  private open(): Promise<McpSession> {
    if (!this.session) {
      const server = findJiraMcpServer(this.configPath, this.preferred, this.env);
      this.serverName = server.name;
      this.session = this.connect(server).catch((err: unknown) => {
        this.session = null;
        throw new JiraError(`No se pudo conectar con el MCP de JIRA (${server.name}): ${message(err)}`);
      });
    }
    return this.session;
  }

  /** Llama a una herramienta; si la conexión se cayó, reconecta una vez. */
  private async call(tool: string, args: Record<string, unknown>): Promise<string> {
    let result: { isError: boolean; text: string };
    try {
      result = await (await this.open()).callTool(tool, args);
    } catch (err) {
      if (err instanceof JiraError) throw err;
      await this.close();
      try {
        result = await (await this.open()).callTool(tool, args);
      } catch (retryErr) {
        if (retryErr instanceof JiraError) throw retryErr;
        await this.close();
        throw new JiraError(`El MCP de JIRA (${this.serverName}) falló en ${tool}: ${message(retryErr)}`);
      }
    }
    if (result.isError) throw new JiraError(`JIRA no aceptó el cambio (${tool}): ${result.text || 'sin detalle'}`);
    return result.text;
  }

  async addComment(key: string, comment: string) {
    await this.call('jira_add_comment', { issue_key: key, comment });
  }

  async transition(key: string, transitionId: string) {
    await this.call('jira_transition_issue', { issue_key: key, transition_id: transitionId });
  }

  async close() {
    const session = this.session;
    this.session = null;
    await session?.then((s) => s.close()).catch(() => {});
  }
}
