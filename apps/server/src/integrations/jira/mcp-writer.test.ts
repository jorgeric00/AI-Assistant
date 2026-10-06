import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JiraError } from './client.js';
import { findJiraMcpServer, McpJiraWriter, type McpSession } from './mcp-writer.js';

const JIRA = { type: 'remote', url: 'https://api.example.com/mcp-jira/mcp', headers: { Authorization: 'Bearer {env:JIRA_MCP_TOKEN}' } };

function configDir(files: Record<string, object | string>) {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

describe('MCP de JIRA de opencode', () => {
  it('lo encuentra en opencode.jsonc aunque la ruta configurada sea opencode.json', () => {
    const dir = configDir({ 'opencode.jsonc': `{ // JSONC\n "mcp": { "github": { "type": "local", "command": ["gh"] }, "jira": ${JSON.stringify(JIRA)} } }` });
    const server = findJiraMcpServer(join(dir, 'opencode.json'), undefined, { JIRA_MCP_TOKEN: 't' });
    expect(server).toMatchObject({ name: 'jira', transport: 'http', headers: { Authorization: 'Bearer t' } });
  });

  it('explica qué falta: configuración, servidor o variable de entorno', () => {
    expect(() => findJiraMcpServer('/no/existe/opencode.json', undefined, {})).toThrow(/No se encuentra la configuración de opencode/);
    const dir = configDir({ 'opencode.json': { mcp: { jira: JIRA } } });
    const path = join(dir, 'opencode.json');
    expect(() => findJiraMcpServer(path, undefined, {})).toThrow(/\{env:JIRA_MCP_TOKEN\}/);
    expect(() => findJiraMcpServer(path, 'atlassian', { JIRA_MCP_TOKEN: 't' })).toThrow(/llamado "atlassian"/);
    expect(new McpJiraWriter(path, undefined, undefined, {}).status()).toMatchObject({ server: null, problem: expect.stringContaining('JIRA_MCP_TOKEN') });
  });

  it('llama a las herramientas de mcp-atlassian, convierte sus errores y reconecta si se cae la conexión', async () => {
    const dir = configDir({ 'opencode.json': { mcp: { jira: JIRA } } });
    const calls: string[] = [];
    let connections = 0;
    let dropNext = false;
    const connect = async (): Promise<McpSession> => {
      connections++;
      return {
        callTool: async (name, args) => {
          if (dropNext) {
            dropNext = false;
            throw new Error('socket hang up');
          }
          calls.push(`${name} ${JSON.stringify(args)}`);
          return name === 'jira_transition_issue' && args.transition_id === '0' ? { isError: true, text: 'Transition not found' } : { isError: false, text: '{}' };
        },
        close: async () => {},
      };
    };
    const writer = new McpJiraWriter(join(dir, 'opencode.json'), undefined, connect, { JIRA_MCP_TOKEN: 't' });
    expect(writer.status()).toEqual({ server: 'jira', problem: null });

    await writer.addComment('ABC-1', 'Hola');
    await writer.transition('ABC-1', '31');
    expect(calls).toEqual(['jira_add_comment {"issue_key":"ABC-1","comment":"Hola"}', 'jira_transition_issue {"issue_key":"ABC-1","transition_id":"31"}']);
    expect(connections).toBe(1);

    dropNext = true;
    await writer.addComment('ABC-1', 'Otra vez');
    expect(connections).toBe(2);

    await expect(writer.transition('ABC-1', '0')).rejects.toThrow(JiraError);
    await expect(writer.transition('ABC-1', '0')).rejects.toThrow(/Transition not found/);
  });
});
