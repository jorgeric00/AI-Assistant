// JIRA por su API REST: lectura de tareas y, desde "Actualizar JIRA", comentario y cambio de estado.
// (Decisión de Jorge: lo que hace él a mano va por la API; el MCP de JIRA queda para lo automático de opencode.)
// - JIRA Cloud (*.atlassian.net): JIRA_EMAIL + token de API, autenticación Basic, API v3.
// - JIRA Server / Data Center: token personal (PAT) como Bearer, API v2.
import { t } from '../../i18n/index.js';
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

/** Paso de estado que JIRA permite desde el estado actual. */
export interface JiraTransition {
  id: string;
  /** Nombre de la transición (p. ej. "Enviar a revisión"). */
  name: string;
  /** Estado al que lleva (p. ej. "En revisión"). */
  to: string;
  toCategory: JiraStatusCategory | null;
}

interface RawTransition {
  id: string | number;
  name?: string;
  to?: { name?: string; statusCategory?: { key?: string } };
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

  private get<T>(path: string, params: Record<string, string>) {
    return this.request<T>('GET', `${path}?${new URLSearchParams(params)}`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<{ status: number; body: T | null }> {
    const url = `${this.api}${path}`;
    const authorization = this.cloud
      ? `Basic ${Buffer.from(`${this.config.email}:${this.config.token}`).toString('base64')}`
      : `Bearer ${this.config.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { authorization, accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        // Sin seguir redirecciones: un login corporativo (p. ej. Microsoft) delante de JIRA responde
        // con una redirección a su página, y así se puede explicar en vez de leer HTML como JSON.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new JiraError(t('jira.connectFailed', { url: this.baseUrl, cause }));
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      const location = res.headers.get('location');
      const host = location ? ` (${new URL(location, this.baseUrl).host})` : '';
      throw new JiraError(t('jira.loginRedirect', { host }));
    }
    if (res.status === 401) throw new JiraError(t('jira.unauthorized'));
    if (res.status === 403) throw new JiraError(t('jira.forbidden'));
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null;
      const messages = [...(data?.errorMessages ?? []), ...Object.values(data?.errors ?? {})];
      throw new JiraError(`${t('jira.httpError', { status: res.status })}${messages.length ? `: ${messages.join('; ')}` : ''}`);
    }
    const text = await res.text();
    if (!text) return { status: res.status, body: null };
    try {
      return { status: res.status, body: JSON.parse(text) as T };
    } catch {
      throw new JiraError(t('jira.notJson', { url: this.baseUrl }));
    }
  }

  /** Usuario con el que entra el token: confirma que JIRA lo acepta (y no lo trata como anónimo). */
  async myself(): Promise<string> {
    const me = this.required(await this.get<{ displayName?: string; name?: string; emailAddress?: string }>('/myself', {}));
    return me.displayName ?? me.name ?? me.emailAddress ?? t('common.unknown');
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
        const body = this.required(await this.get<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('/search/jql', params));
        issues.push(...(body.issues ?? []));
        nextPageToken = body.isLast ? undefined : body.nextPageToken;
      } while (nextPageToken && issues.length < MAX_ISSUES);
    } else {
      let startAt = 0;
      for (;;) {
        const body = this.required(await this.get<{ issues: RawIssue[]; total: number }>('/search', {
          jql,
          fields,
          startAt: String(startAt),
          maxResults: String(PAGE_SIZE),
        }));
        const page = body.issues ?? [];
        issues.push(...page);
        startAt += page.length;
        if (!page.length || startAt >= (body.total ?? 0) || issues.length >= MAX_ISSUES) break;
      }
    }
    return issues.slice(0, MAX_ISSUES).map((i) => this.normalize(i));
  }

  /** Un 404 en la API general significa que JIRA_URL no apunta a JIRA (p. ej. falta /jira al final). */
  private required<T>({ body }: { body: T | null }): T {
    if (!body) {
      throw new JiraError(t('jira.apiNotFound', { url: this.baseUrl }));
    }
    return body;
  }

  /** Una incidencia por clave; null si no existe o no se puede ver. */
  async getIssue(key: string): Promise<JiraIssue | null> {
    const { body } = await this.get<RawIssue>(`/issue/${encodeURIComponent(key)}`, { fields: FIELDS.join(',') });
    return body ? this.normalize(body) : null;
  }

  /** Estados a los que JIRA deja pasar la incidencia desde el actual. */
  async transitions(key: string): Promise<JiraTransition[]> {
    const { body } = await this.get<{ transitions?: RawTransition[] }>(`/issue/${encodeURIComponent(key)}/transitions`, {});
    if (!body) throw new JiraError(t('jira.issueNotVisible', { key }));
    return (body.transitions ?? []).map((t) => {
      const category = t.to?.statusCategory?.key;
      return {
        id: String(t.id),
        name: t.name ?? t.to?.name ?? String(t.id),
        to: t.to?.name ?? t.name ?? String(t.id),
        toCategory: category === 'new' || category === 'indeterminate' || category === 'done' ? category : null,
      };
    });
  }

  /** Añade un comentario (texto plano; en JIRA Cloud se manda como documento ADF, un párrafo por línea). */
  async addComment(key: string, text: string): Promise<void> {
    const body = this.cloud
      ? {
          type: 'doc',
          version: 1,
          content: text.split(/\r?\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph', content: [] })),
        }
      : text;
    const { status } = await this.request('POST', `/issue/${encodeURIComponent(key)}/comment`, { body });
    if (status === 404) throw new JiraError(t('jira.cannotComment', { key }));
  }

  /** Cambia el estado con una de las transiciones que devuelve `transitions`. */
  async transition(key: string, transitionId: string): Promise<void> {
    const { status } = await this.request('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
    if (status === 404) throw new JiraError(t('jira.cannotTransition', { key }));
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
