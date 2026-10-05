// Acceso al modelo de IA a través de opencode (diseño, sección 6.2): toda la IA pasa por
// opencode con los modelos de Copilot que el usuario ya tiene configurados.
import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from '@opencode-ai/sdk';

export interface LlmRequest {
  /** Instrucciones de sistema (rol, formato, reglas). */
  system: string;
  /** Mensaje del usuario con los datos. */
  user: string;
  /** Título de la sesión en opencode, para reconocerla en su historial. */
  title: string;
}

/** Lo mínimo que la app necesita de un modelo: texto de entrada, texto de salida. */
export interface Llm {
  complete(request: LlmRequest): Promise<string>;
}

/** Error que se muestra tal cual al usuario (opencode no arranca, el modelo falla...). */
export class LlmUnavailableError extends Error {}

// Las respuestas de la app solo necesitan texto: sin herramientas, el modelo no puede tocar
// ficheros ni ejecutar nada aunque se lo pidan las notas.
const NO_TOOLS: Record<string, boolean> = {
  '*': false,
  bash: false,
  edit: false,
  write: false,
  patch: false,
  read: false,
  grep: false,
  glob: false,
  list: false,
  webfetch: false,
  task: false,
  todowrite: false,
  todoread: false,
};

interface OpencodeLlmOptions {
  /** URL de un `opencode serve` ya arrancado. Si falta, la app lo arranca la primera vez que hace falta. */
  url?: string;
  /** Puerto para el `opencode serve` propio; 0 = uno libre cualquiera. */
  port?: number;
}

export function createOpencodeLlm({ url, port = 0 }: OpencodeLlmOptions = {}): Llm & { close(): void } {
  let connection: Promise<{ client: OpencodeClient; close(): void }> | undefined;

  const connect = () => {
    connection ??= (async () => {
      if (url) return { client: createOpencodeClient({ baseUrl: url }), close() {} };
      const server = await createOpencodeServer({ hostname: '127.0.0.1', port, timeout: 20_000 });
      return { client: createOpencodeClient({ baseUrl: server.url }), close: () => server.close() };
    })().catch((err: unknown) => {
      connection = undefined; // el siguiente intento vuelve a probar
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
      throw new LlmUnavailableError(
        url
          ? `No se puede conectar con opencode en ${url} (${detail}).`
          : `No se pudo arrancar opencode (${detail}). Comprueba que el comando "opencode" funciona en una terminal.`,
      );
    });
    return connection;
  };

  return {
    async complete({ system, user, title }) {
      const { client } = await connect();
      let sessionId: string | undefined;
      try {
        const session = await client.session.create({ body: { title }, throwOnError: true });
        sessionId = session.data.id;
        const result = await client.session.prompt({
          path: { id: sessionId },
          body: { system, tools: NO_TOOLS, parts: [{ type: 'text', text: user }] },
          throwOnError: true,
        });
        const { info, parts } = result.data;
        if (info.error) {
          const data = info.error.data as { message?: unknown } | undefined;
          throw new LlmUnavailableError(`El modelo devolvió un error: ${typeof data?.message === 'string' ? data.message : info.error.name}`);
        }
        const text = parts
          .flatMap((p) => (p.type === 'text' && !p.synthetic ? [p.text] : []))
          .join('')
          .trim();
        if (!text) throw new LlmUnavailableError('El modelo no devolvió ninguna respuesta.');
        return text;
      } catch (err) {
        if (err instanceof LlmUnavailableError) throw err;
        connection = undefined;
        throw new LlmUnavailableError(`Fallo al hablar con opencode: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (sessionId) void client.session.delete({ path: { id: sessionId } }).catch(() => {});
      }
    },
    close() {
      void connection?.then((c) => c.close()).catch(() => {});
    },
  };
}
