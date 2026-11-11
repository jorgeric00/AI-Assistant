import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OpencodeApi } from './api.js';
import { createOpencodeConnection, type OpencodeConnection } from './connection.js';

/** Un `opencode` falso: escucha en un puerto libre, pide contraseña y escribe el arranque como la versión indicada. */
function fakeOpencode(style: '1.x' | '2.x'): string {
  const dir = mkdtempSync(join(tmpdir(), 'da-oc-bin-'));
  const file = join(dir, 'opencode');
  writeFileSync(
    file,
    `#!/usr/bin/env node
const http = require('node:http');
// La 2.x genera su propia contraseña aunque se le pase otra; la 1.x usa la de OPENCODE_SERVER_PASSWORD.
const password = ${style === '2.x' ? "'generada-por-opencode'" : 'process.env.OPENCODE_SERVER_PASSWORD'};
const expected = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== expected) { res.writeHead(401); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ healthy: true, version: '${style}' }));
});
server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port;
  ${style === '2.x' ? "console.log('server listening on ' + url); setTimeout(() => console.log('server password ' + password), 100);" : "console.log('opencode server listening on ' + url);"}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

let conn: OpencodeConnection | undefined;
afterEach(() => conn?.close());

describe('arranque de opencode serve', () => {
  it.skipIf(process.platform === 'win32')('entiende el arranque de la 1.x y le pasa la contraseña que elige la app', async () => {
    conn = createOpencodeConnection({ command: fakeOpencode('1.x') });
    expect(await new OpencodeApi(conn).health()).toEqual({ healthy: true, version: '1.x' });
  });

  it.skipIf(process.platform === 'win32')('entiende el arranque de la 2.x y usa la contraseña que genera opencode', async () => {
    conn = createOpencodeConnection({ command: fakeOpencode('2.x') });
    expect(await new OpencodeApi(conn).health()).toEqual({ healthy: true, version: '2.x' });
  });
});
