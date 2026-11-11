// Conexión con opencode compartida por toda la app: se arranca `opencode serve` la primera vez que hace
// falta (o se usa el de OPENCODE_URL) y lo reutilizan la IA de la app y las sesiones de desarrollo.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';
import { t } from '../../i18n/index.js';

/** Error que se muestra tal cual al usuario (opencode no arranca, el modelo falla...). */
export class LlmUnavailableError extends Error {}

export interface OpencodeConnectionOptions {
  /** URL de un `opencode serve` ya arrancado. Si falta, la app lo arranca la primera vez que hace falta. */
  url?: string;
  /** Contraseña del `opencode serve` de OPENCODE_URL (OPENCODE_SERVER_PASSWORD), si la tiene. */
  password?: string;
  /** Usuario de esa contraseña; por defecto "opencode". */
  username?: string;
  /** Puerto para el `opencode serve` propio; 0 = uno libre cualquiera. */
  port?: number;
  /** Comando de opencode; por defecto "opencode". */
  command?: string;
}

export interface OpencodeConnection {
  /** Cliente, URL del servidor y cabeceras para llamarlo; arranca opencode si aún no lo está. */
  connect(): Promise<{ client: OpencodeClient; baseUrl: string; headers: Record<string, string> }>;
  /** URL de OPENCODE_URL si se usa un opencode ya arrancado; null si lo arranca la app. */
  readonly externalUrl: string | null;
  /** Cierra y olvida la conexión: el siguiente intento vuelve a conectar (o a arrancar opencode). */
  reset(): void;
  close(): void;
}

const USER = 'opencode';
const START_TIMEOUT_MS = 30_000;

const basicAuth = (username: string, password: string | undefined): Record<string, string> =>
  password ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {};

function stop(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    const out = spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    if (!out.error && out.status === 0) return;
  }
  proc.kill();
}

/**
 * Arranca `opencode serve` con una contraseña propia (las versiones nuevas piden una) y espera a que diga en
 * qué URL escucha. Vale para "opencode server listening on <url>" (1.x) y "server listening on <url>" (2.x); si
 * opencode genera su propia contraseña ("server password <...>"), se usa esa.
 */
export function startOpencodeServer({ port = 0, command = 'opencode', timeout = START_TIMEOUT_MS } = {}): Promise<{
  url: string;
  headers: () => Record<string, string>;
  close(): void;
}> {
  let password = randomBytes(24).toString('base64url');
  const proc = spawn(command, ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: '{}', OPENCODE_SERVER_USERNAME: USER, OPENCODE_SERVER_PASSWORD: password },
    // En Windows "opencode" es un .cmd: hace falta la shell para encontrarlo.
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let url: string | null = null;
    const fail = (err: Error) => {
      clearTimeout(timer);
      stop(proc);
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`Timeout waiting for server to start after ${timeout}ms${output.trim() ? `: ${output.trim().split('\n')[0]}` : ''}`)), timeout);
    let done = false;
    const finish = () => {
      if (done || !url) return;
      done = true;
      resolve({ url, headers: () => basicAuth(USER, password), close: () => stop(proc) });
    };
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const generated = output.match(/server password[:\s]+(\S+)/i)?.[1];
      if (generated) password = generated;
      if (!url) {
        const found = output.match(/server listening on\s+(https?:\/\/\S+)/i)?.[1];
        if (!found) return;
        url = found;
        clearTimeout(timer);
        // La 2.x escribe su contraseña justo después de la URL: se espera un momento a que llegue.
        setTimeout(finish, 500);
      }
      if (generated) finish();
    };
    proc.stdout?.on('data', read);
    proc.stderr?.on('data', read);
    proc.on('error', (err) => fail(err));
    proc.on('exit', (code) => {
      if (!url) fail(new Error(`Server exited with code ${code}${output.trim() ? `\nServer output: ${output.trim()}` : ''}`));
    });
  });
}

export function createOpencodeConnection({ url, password, username = USER, port = 0, command }: OpencodeConnectionOptions = {}): OpencodeConnection {
  let connection: Promise<{ client: OpencodeClient; baseUrl: string; headers: () => Record<string, string>; close(): void }> | undefined;

  const clientFor = (baseUrl: string, headers: () => Record<string, string>) =>
    createOpencodeClient({
      baseUrl,
      fetch: (req: Request) => {
        for (const [k, v] of Object.entries(headers())) req.headers.set(k, v);
        // @ts-expect-error: Bun/undici aceptan timeout=false para las respuestas largas del modelo.
        req.timeout = false;
        return fetch(req);
      },
    });

  const connect = () => {
    connection ??= (async () => {
      if (url) {
        const headers = () => basicAuth(username, password);
        return { client: clientFor(url, headers), baseUrl: url.replace(/\/+$/, ''), headers, close() {} };
      }
      const server = await startOpencodeServer({ port, command });
      return { client: clientFor(server.url, server.headers), baseUrl: server.url.replace(/\/+$/, ''), headers: server.headers, close: () => server.close() };
    })().catch((err: unknown) => {
      connection = undefined; // el siguiente intento vuelve a probar
      const detail = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err);
      throw new LlmUnavailableError(url ? t('ai.connectFailed', { url, detail }) : t('ai.startFailed', { detail }));
    });
    return connection.then((c) => ({ client: c.client, baseUrl: c.baseUrl, headers: c.headers() }));
  };

  return {
    connect,
    externalUrl: url ? url.replace(/\/+$/, '') : null,
    reset() {
      void connection?.then((c) => c.close()).catch(() => {});
      connection = undefined;
    },
    close() {
      void connection?.then((c) => c.close()).catch(() => {});
    },
  };
}

/** El servidor de opencode no responde (proceso caído, puerto cerrado), a diferencia de un error que devuelve él. */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return err.name === 'TypeError' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || /fetch failed|ECONNREFUSED|socket hang up/i.test(err.message);
}
