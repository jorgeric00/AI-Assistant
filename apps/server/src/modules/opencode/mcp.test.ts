import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { whichBinary } from './mcp.js';

describe('whichBinary', () => {
  it('devuelve el primer ejecutable del PATH con ese nombre', async () => {
    const root = mkdtempSync(join(tmpdir(), 'da-which-'));
    const [a, b] = [join(root, 'a'), join(root, 'b')];
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(b, 'opencode'), '#!/bin/sh\n');
    chmodSync(join(b, 'opencode'), 0o755);
    expect(await whichBinary('opencode', { PATH: [a, b].join(delimiter) }, 'linux')).toBe(join(b, 'opencode'));
    expect(await whichBinary('otro', { PATH: [a, b].join(delimiter) }, 'linux')).toBeNull();
  });
});
