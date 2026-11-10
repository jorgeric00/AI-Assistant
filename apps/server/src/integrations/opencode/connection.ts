// Conexión con opencode compartida por toda la app: se arranca `opencode serve` la primera vez que hace
// falta (o se usa el de OPENCODE_URL) y lo reutilizan la IA de la app y las sesiones de desarrollo.
import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from '@opencode-ai/sdk';
import { t } from '../../i18n/index.js';

/** Error que se muestra tal cual al usuario (opencode no arranca, el modelo falla...). */
export class LlmUnavailableError extends Error {}

export interface OpencodeConnectionOptions {
  /** URL de un `opencode serve` ya arrancado. Si falta, la app lo arranca la primera vez que hace falta. */
  url?: string;
  /** Puerto para el `opencode serve` propio; 0 = uno libre cualquiera. */
  port?: number;
}

export interface OpencodeConnection {
  /** Cliente y URL del servidor; arranca opencode si aún no lo está. */
  connect(): Promise<{ client: OpencodeClient; baseUrl: string }>;
  /** URL de OPENCODE_URL si se usa un opencode ya arrancado; null si lo arranca la app. */
  readonly externalUrl: string | null;
  /** Cierra y olvida la conexión: el siguiente intento vuelve a conectar (o a arrancar opencode). */
  reset(): void;
  close(): void;
}

export function createOpencodeConnection({ url, port = 0 }: OpencodeConnectionOptions = {}): OpencodeConnection {
  let connection: Promise<{ client: OpencodeClient; baseUrl: string; close(): void }> | undefined;

  const connect = () => {
    connection ??= (async () => {
      if (url) return { client: createOpencodeClient({ baseUrl: url }), baseUrl: url.replace(/\/+$/, ''), close() {} };
      const server = await createOpencodeServer({ hostname: '127.0.0.1', port, timeout: 20_000 });
      return { client: createOpencodeClient({ baseUrl: server.url }), baseUrl: server.url.replace(/\/+$/, ''), close: () => server.close() };
    })().catch((err: unknown) => {
      connection = undefined; // el siguiente intento vuelve a probar
      const detail = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err);
      throw new LlmUnavailableError(url ? t('ai.connectFailed', { url, detail }) : t('ai.startFailed', { detail }));
    });
    return connection;
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
