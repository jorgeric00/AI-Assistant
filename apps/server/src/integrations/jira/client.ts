// Lectura de JIRA por su API REST (decisión de Jorge: leer por API gasta menos tokens que el MCP;
// las escrituras, comentario y cambio de estado, irán por el MCP de JIRA).
// - JIRA Cloud (*.atlassian.net): JIRA_EMAIL + token de API, autenticación Basic, API v3.
// - JIRA Server / Data Center: token personal (PAT) como Bearer, API v2.
import { adfToText } from './adf.js';

export interface JiraConfig {
  baseUrl: string;
  token: string;
  /** Solo en JIRA Cloud: con email se usa Basic y la API v3. */
  email?: string;
}

export type JiraStatusCategory = 'new' | 'indeterminate' | 'done';

/** Lo que la app guarda de cada incidencia. */
export interface JiraIssue {
  key: string;
  summary: string;
  description: string | null;
  status: string;
  statusCategory: JiraStatusCategory | null;
  priority: string | null;
  issueType: string | null;
  project: string | null;
  /** Última modificación en JIRA (ISO). */
  updated: string | null;
  url: string;
}

/** Error que se muestra tal cual al usuario. */
export class JiraError extends Error {}

const FIELDS = ['summary', 'description', 'status', 'priority', 'issuetype', 'project', 'updated'];
const PAGE_SIZE = 100;
/** Tope de seguridad: con más incidencias asignadas la sincronización se corta aquí. */
const MAX_ISSUES = 1000;
const TIMEOUT_MS = 20_000;

interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    project?: { key?: string; name?: string } | null;
    updated?: string;
  };
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly cloud: boolean;

  constructor(
    private readonly config: JiraConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.cloud = !!config.email;
  }

  private get api() {
    return `${this.baseUrl}/rest/api/${this.cloud ? 3 : 2}`;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T | null }> {
    const url = `${this.api}${path}?${new URLSearchParams(params)}`;
    const authorization = this.cloud
      ? `Basic ${Buffer.from(`${this.config.email}:${this.config.token}`).toString('base64')}`
      : `Bearer ${this.config.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { authorization, accept: 'application/json' },
        // Sin seguir redirecciones: un login corporativo (p. ej. Microsoft) delante de JIRA responde
        // con una redirección a su página, y así se puede explicar en vez de leer HTML como JSON.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new JiraError(`No se pudo conectar con JIRA en ${this.baseUrl}: ${cause}`);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      const location = res.headers.get('location');
      const host = location ? ` (${new URL(location, this.baseUrl).host})` : '';
      throw new JiraError(
        `JIRA redirige a una página de inicio de sesión${host}: desde esta red la API no acepta el token. Prueba desde la red de la empresa o con la VPN.`,
      );
    }
    if (res.status === 401) throw new JiraError('JIRA rechazó las credenciales (401). Revisa JIRA_TOKEN (y JIRA_EMAIL si es JIRA Cloud).');
    if (res.status === 403) throw new JiraError('JIRA no da permiso a este token (403).');
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { errorMessages?: string[] } | null;
      throw new JiraError(`JIRA respondió ${res.status}${data?.errorMessages?.length ? `: ${data.errorMessages.join('; ')}` : ''}`);
    }
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as T };
    } catch {
      throw new JiraError(`JIRA no devolvió datos de la API (respondió una página web). ¿Es correcta JIRA_URL? (${this.baseUrl})`);
    }
  }

  /** Usuario con el que entra el token: confirma que JIRA lo acepta (y no lo trata como anónimo). */
  async myself(): Promise<string> {
    const { body } = await this.get<{ displayName?: string; name?: string; emailAddress?: string }>('/myself', {});
    if (!body) throw new JiraError(`JIRA no encontró la API en ${this.baseUrl}. ¿Es correcta JIRA_URL?`);
    return body.displayName ?? body.name ?? body.emailAddress ?? 'desconocido';
  }

  /** Todas las incidencias de una JQL (hasta 1000). */
  async search(jql: string): Promise<JiraIssue[]> {
    const issues: RawIssue[] = [];
    const fields = FIELDS.join(',');
    if (this.cloud) {
      let nextPageToken: string | undefined;
      do {
        const params: Record<string, string> = { jql, fields, maxResults: String(PAGE_SIZE) };
        if (nextPageToken) params.nextPageToken = nextPageToken;
        const { body } = await this.get<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('/search/jql', params);
        issues.push(...(body?.issues ?? []));
        nextPageToken = body?.isLast ? undefined : body?.nextPageToken;
      } while (nextPageToken && issues.length < MAX_ISSUES);
    } else {
      let startAt = 0;
      for (;;) {
        const { body } = await this.get<{ issues: RawIssue[]; total: number }>('/search', {
          jql,
          fields,
          startAt: String(startAt),
          maxResults: String(PAGE_SIZE),
        });
        const page = body?.issues ?? [];
        issues.push(...page);
        startAt += page.length;
        if (!page.length || startAt >= (body?.total ?? 0) || issues.length >= MAX_ISSUES) break;
      }
    }
    return issues.slice(0, MAX_ISSUES).map((i) => this.normalize(i));
  }

  /** Una incidencia por clave; null si no existe o no se puede ver. */
  async getIssue(key: string): Promise<JiraIssue | null> {
    const { body } = await this.get<RawIssue>(`/issue/${encodeURIComponent(key)}`, { fields: FIELDS.join(',') });
    return body ? this.normalize(body) : null;
  }

  private normalize({ key, fields: f }: RawIssue): JiraIssue {
    const category = f.status?.statusCategory?.key;
    const description = typeof f.description === 'string' ? f.description : f.description ? adfToText(f.description) : '';
    return {
      key,
      summary: f.summary ?? key,
      description: description.trim() || null,
      status: f.status?.name ?? 'Desconocido',
      statusCategory: category === 'new' || category === 'indeterminate' || category === 'done' ? category : null,
      priority: f.priority?.name ?? null,
      issueType: f.issuetype?.name ?? null,
      project: f.project?.name ?? f.project?.key ?? null,
      updated: f.updated ?? null,
      url: `${this.baseUrl}/browse/${key}`,
    };
  }
}
