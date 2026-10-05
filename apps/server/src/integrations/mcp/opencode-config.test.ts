import { describe, expect, it } from 'vitest';
import { parseOpencodeMcpServers } from './opencode-config.js';

describe('parseOpencodeMcpServers', () => {
  it('lee servidores locales y remotos, ignora desactivados y sustituye {env:}', () => {
    const raw = `{
      // comentario JSONC
      "$schema": "https://opencode.ai/config.json",
      "mcp": {
        "jira": { "type": "remote", "url": "https://mcp.example.com/jira", "headers": { "Authorization": "Bearer {env:JIRA_TOKEN}" } },
        "github": { "type": "local", "command": ["npx", "-y", "github-mcp", "--url=http://x//y"], "environment": { "TOKEN": "{env:GH}" } },
        "off": { "type": "local", "command": ["foo"], "enabled": false },
      },
    }`;
    const servers = parseOpencodeMcpServers(raw, { JIRA_TOKEN: 'abc', GH: 'xyz' });
    expect(servers).toEqual([
      { name: 'jira', transport: 'http', url: 'https://mcp.example.com/jira', headers: { Authorization: 'Bearer abc' } },
      { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'github-mcp', '--url=http://x//y'], env: { TOKEN: 'xyz' } },
    ]);
  });

  it('devuelve lista vacía sin sección mcp', () => {
    expect(parseOpencodeMcpServers('{}')).toEqual([]);
  });
});
