// Acceso al modelo de IA a través de opencode (diseño, sección 6.2): toda la IA pasa por
// opencode con los modelos de Copilot que el usuario ya tiene configurados.
import { t } from '../../i18n/index.js';
import { LlmUnavailableError, createOpencodeConnection, isConnectionError, type OpencodeConnection, type OpencodeConnectionOptions } from './connection.js';

export { LlmUnavailableError };

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

/** "proveedor/modelo" → lo que espera opencode; null si no es un modelo. */
export function parseModel(ref: string | null | undefined): { providerID: string; modelID: string } | undefined {
  const cut = ref?.indexOf('/') ?? -1;
  if (!ref || cut <= 0 || cut === ref.length - 1) return undefined;
  return { providerID: ref.slice(0, cut), modelID: ref.slice(cut + 1) };
}

interface OpencodeLlmOptions extends OpencodeConnectionOptions {
  /** Conexión compartida con el resto de la app; si falta, se crea una propia con `url` y `port`. */
  connection?: OpencodeConnection;
  /** Modelo elegido en Ajustes ("proveedor/modelo"); sin él, el predeterminado de opencode. */
  model?: () => string | null;
}

export function createOpencodeLlm({ connection, model, ...own }: OpencodeLlmOptions = {}): Llm & { close(): void } {
  const conn = connection ?? createOpencodeConnection(own);

  return {
    async complete({ system, user, title }) {
      const { client } = await conn.connect();
      let sessionId: string | undefined;
      try {
        const session = await client.session.create({ body: { title }, throwOnError: true });
        sessionId = session.data.id;
        const result = await client.session.prompt({
          path: { id: sessionId },
          body: { system, tools: NO_TOOLS, model: parseModel(model?.()), parts: [{ type: 'text', text: user }] },
          throwOnError: true,
        });
        const { info, parts } = result.data;
        if (info.error) {
          const data = info.error.data as { message?: unknown } | undefined;
          throw new LlmUnavailableError(t('ai.modelError', { message: typeof data?.message === 'string' ? data.message : info.error.name }));
        }
        const text = parts
          .flatMap((p) => (p.type === 'text' && !p.synthetic ? [p.text] : []))
          .join('')
          .trim();
        if (!text) throw new LlmUnavailableError(t('ai.emptyAnswer'));
        return text;
      } catch (err) {
        if (err instanceof LlmUnavailableError) throw err;
        if (isConnectionError(err)) conn.reset();
        throw new LlmUnavailableError(t('ai.opencodeFailed', { message: err instanceof Error ? err.message : String(err) }));
      } finally {
        if (sessionId) void client.session.delete({ path: { id: sessionId } }).catch(() => {});
      }
    },
    close() {
      if (!connection) conn.close();
    },
  };
}
