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
  /** Nombre de la persona a la que está asignada, si lo hay. */
  assignee?: string | null;
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
export interface JiraTicketExtras {
  comments: { author: string; created: string; body: string }[];
  attachments: { id: string; filename: string; size: number; mimeType: string; url: string; created: string }[];
}

export class JiraError extends Error {}

/** Metadatos de un campo al crear una incidencia (createmeta). */
export interface JiraFieldMeta {
  id: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
  schema: { type?: string; items?: string; system?: string; custom?: string };
  allowedValues: { id: string; name: string }[];
}

interface RawFieldMeta {
  fieldId?: string;
  key?: string;
  name?: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: JiraFieldMeta['schema'];
  allowedValues?: { id?: string | number; name?: string; value?: string; key?: string }[];
}

interface RawIssueType {
  id: string | number;
  name?: string;
  subtask?: boolean;
}

const FIELDS = ['summary', 'description', 'status', 'priority', 'issuetype', 'project', 'updated', 'assignee'];
const PAGE_SIZE = 100;
/** Tope de seguridad: con más incidencias asignadas la sincronización se corta aquí. */
const MAX_ISSUES = 1000;
const TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

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
    assignee?: { displayName?: string } | null;
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

  /** API de JIRA Software (tableros, sprints y épicas). */
  private get agile() {
    return `${this.baseUrl}/rest/agile/1.0`;
  }

  private get<T>(path: string, params: Record<string, string>, base = this.api) {
    return this.request<T>('GET', `${path}?${new URLSearchParams(params)}`, undefined, base);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, payload?: unknown, base = this.api): Promise<{ status: number; body: T | null }> {
    const url = `${base}${path}`;
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

  /** Todas las incidencias de una JQL (hasta 1000, o `limit`). */
  async search(jql: string, limit = MAX_ISSUES): Promise<JiraIssue[]> {
    const issues: RawIssue[] = [];
    const fields = FIELDS.join(',');
    const max = Math.min(limit, MAX_ISSUES);
    if (this.cloud) {
      let nextPageToken: string | undefined;
      do {
        const params: Record<string, string> = { jql, fields, maxResults: String(Math.min(PAGE_SIZE, max)) };
        if (nextPageToken) params.nextPageToken = nextPageToken;
        const body = this.required(await this.get<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('/search/jql', params));
        issues.push(...(body.issues ?? []));
        nextPageToken = body.isLast ? undefined : body.nextPageToken;
      } while (nextPageToken && issues.length < max);
    } else {
      let startAt = 0;
      for (;;) {
        const body = this.required(await this.get<{ issues: RawIssue[]; total: number }>('/search', {
          jql,
          fields,
          startAt: String(startAt),
          maxResults: String(Math.min(PAGE_SIZE, max)),
        }));
        const page = body.issues ?? [];
        issues.push(...page);
        startAt += page.length;
        if (!page.length || startAt >= (body.total ?? 0) || issues.length >= max) break;
      }
    }
    return issues.slice(0, max).map((i) => this.normalize(i));
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

  /** Comentarios y adjuntos de la incidencia (lo que suele traer una incidencia: logs, reportes...). */
  async ticketExtras(key: string): Promise<JiraTicketExtras | null> {
    const { body } = await this.get<{
      fields?: {
        comment?: { comments?: { author?: { displayName?: string }; created?: string; body?: unknown }[] };
        attachment?: { id: string | number; filename?: string; size?: number; mimeType?: string; content?: string; created?: string }[];
      };
    }>(`/issue/${encodeURIComponent(key)}`, { fields: 'comment,attachment' });
    if (!body) return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : value ? adfToText(value) : '').trim();
    return {
      comments: (body.fields?.comment?.comments ?? [])
        .map((c) => ({ author: c.author?.displayName ?? '', created: c.created ?? '', body: text(c.body) }))
        .filter((c) => c.body),
      attachments: (body.fields?.attachment ?? [])
        .filter((a) => a.content && a.filename)
        .map((a) => ({ id: String(a.id), filename: a.filename!, size: a.size ?? 0, mimeType: a.mimeType ?? '', url: a.content!, created: a.created ?? '' })),
    };
  }

  /** Contenido de un adjunto (la URL `content` que da JIRA). */
  async downloadAttachment(url: string): Promise<Buffer> {
    const authorization = this.cloud
      ? `Basic ${Buffer.from(`${this.config.email}:${this.config.token}`).toString('base64')}`
      : `Bearer ${this.config.token}`;
    let res: Response;
    try {
      // JIRA Cloud redirige a su almacén de ficheros: aquí sí se sigue la redirección.
      res = await this.fetchImpl(url, { headers: { authorization }, redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new JiraError(t('jira.connectFailed', { url: this.baseUrl, cause }));
    }
    if (!res.ok) throw new JiraError(t('jira.httpError', { status: res.status }));
    return Buffer.from(await res.arrayBuffer());
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
    const { status } = await this.request('POST', `/issue/${encodeURIComponent(key)}/comment`, { body: this.richText(text) });
    if (status === 404) throw new JiraError(t('jira.cannotComment', { key }));
  }

  /** Registra tiempo trabajado en una tarea. `started` es la fecha y hora de inicio con zona horaria. */
  async addWorklog(key: string, started: string, timeSpentSeconds: number): Promise<void> {
    const { status } = await this.request('POST', `/issue/${encodeURIComponent(key)}/worklog`, { started, timeSpentSeconds });
    if (status === 404) throw new JiraError(t('jira.cannotLogWork', { key }));
  }

  /** Cambia el estado con una de las transiciones que devuelve `transitions`. */
  async transition(key: string, transitionId: string): Promise<void> {
    const { status } = await this.request('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
    if (status === 404) throw new JiraError(t('jira.cannotTransition', { key }));
  }

  browseUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  /** Texto plano tal cual (Server) o como documento ADF, un párrafo por línea (Cloud). */
  richText(text: string): unknown {
    if (!this.cloud) return text;
    return {
      type: 'doc',
      version: 1,
      content: text.split(/\r?\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph', content: [] })),
    };
  }

  // ── Crear incidencias ──────────────────────────────────────────────────────

  /** Usuario del token, como lo pide el campo "assignee" (name en Server, accountId en Cloud). */
  async assigneeRef(): Promise<{ name: string } | { accountId: string }> {
    const me = this.required(await this.get<{ name?: string; accountId?: string }>('/myself', {}));
    if (this.cloud && me.accountId) return { accountId: me.accountId };
    if (me.name) return { name: me.name };
    throw new JiraError(t('jira.create.noUser'));
  }

  /** Proyectos que ve el token. */
  async projects(): Promise<{ key: string; name: string }[]> {
    const body = this.required(await this.get<{ key: string; name?: string }[]>('/project', {}));
    return body.map((p) => ({ key: p.key, name: p.name ?? p.key }));
  }

  /** Tipos de incidencia que se pueden crear en el proyecto (sin subtareas). */
  async issueTypes(project: string): Promise<{ id: string; name: string }[]> {
    const p = encodeURIComponent(project);
    let raw: RawIssueType[];
    const { body } = await this.get<{ values?: RawIssueType[]; issueTypes?: RawIssueType[] }>(`/issue/createmeta/${p}/issuetypes`, { maxResults: '100' });
    if (body) raw = body.values ?? body.issueTypes ?? [];
    else {
      // JIRA anterior a 8.4: solo el createmeta antiguo.
      const old = await this.get<{ projects?: { issuetypes?: RawIssueType[] }[] }>('/issue/createmeta', { projectKeys: project });
      const proj = old.body?.projects?.[0];
      if (!proj) throw new JiraError(t('jira.create.projectNotVisible', { project }));
      raw = proj.issuetypes ?? [];
    }
    return raw.filter((i) => !i.subtask).map((i) => ({ id: String(i.id), name: i.name ?? String(i.id) }));
  }

  /** Todos los tipos de incidencia de JIRA (no solo los que se pueden crear en un proyecto). */
  async allIssueTypes(): Promise<{ id: string; name: string; hierarchyLevel?: number }[]> {
    const { body } = await this.get<(RawIssueType & { hierarchyLevel?: number })[]>('/issuetype', {});
    return (body ?? []).filter((i) => !i.subtask).map((i) => ({ id: String(i.id), name: i.name ?? String(i.id), hierarchyLevel: i.hierarchyLevel }));
  }

  /** Campos de la pantalla de creación de un proyecto y tipo. */
  async createFields(project: string, issueTypeId: string): Promise<JiraFieldMeta[]> {
    const p = encodeURIComponent(project);
    let raw: RawFieldMeta[];
    const { body } = await this.get<{ values?: RawFieldMeta[]; fields?: RawFieldMeta[] }>(`/issue/createmeta/${p}/issuetypes/${encodeURIComponent(issueTypeId)}`, { maxResults: '200' });
    if (body) raw = body.values ?? body.fields ?? [];
    else {
      const old = await this.get<{ projects?: { issuetypes?: { fields?: Record<string, RawFieldMeta> }[] }[] }>('/issue/createmeta', {
        projectKeys: project,
        issuetypeIds: issueTypeId,
        expand: 'projects.issuetypes.fields',
      });
      const fields = old.body?.projects?.[0]?.issuetypes?.[0]?.fields;
      if (!fields) throw new JiraError(t('jira.create.projectNotVisible', { project }));
      raw = Object.entries(fields).map(([id, f]) => ({ ...f, fieldId: f.fieldId ?? f.key ?? id }));
    }
    return raw.map((f) => ({
      id: f.fieldId ?? f.key ?? '',
      name: f.name ?? f.fieldId ?? f.key ?? '',
      required: !!f.required,
      hasDefaultValue: !!f.hasDefaultValue,
      schema: f.schema ?? {},
      allowedValues: (f.allowedValues ?? [])
        .filter((v) => v.id !== undefined)
        .map((v) => ({ id: String(v.id), name: v.name ?? v.value ?? v.key ?? String(v.id) })),
    }));
  }

  /** Crea la incidencia y devuelve su clave. */
  async createIssue(fields: Record<string, unknown>): Promise<string> {
    const { body } = await this.request<{ key?: string }>('POST', '/issue', { fields });
    if (!body?.key) throw new JiraError(t('jira.create.noKey'));
    return body.key;
  }

  /** Sprints activos y futuros de los tableros scrum del proyecto. */
  async sprints(project: string): Promise<{ id: number; name: string; state: 'active' | 'future' }[]> {
    const { body } = await this.get<{ values?: { id: number; type?: string }[] }>('/board', { projectKeyOrId: project, maxResults: '50' }, this.agile);
    const boards = (body?.values ?? []).filter((b) => b.type !== 'kanban');
    const byId = new Map<number, { id: number; name: string; state: 'active' | 'future' }>();
    for (const board of boards) {
      const res = await this.get<{ values?: { id: number; name?: string; state?: string }[] }>(`/board/${board.id}/sprint`, { state: 'active,future', maxResults: '50' }, this.agile).catch(() => null);
      for (const s of res?.body?.values ?? []) {
        if (s.state === 'active' || s.state === 'future') byId.set(s.id, { id: s.id, name: s.name ?? String(s.id), state: s.state });
      }
    }
    return [...byId.values()].sort((a, b) => (a.state === b.state ? a.id - b.id : a.state === 'active' ? -1 : 1));
  }

  async addToSprint(sprintId: number, key: string): Promise<void> {
    const { status } = await this.request('POST', `/sprint/${sprintId}/issue`, { issues: [key] }, this.agile);
    if (status === 404) throw new JiraError(t('jira.create.sprintNotFound'));
  }

  async addToEpic(epicKey: string, key: string): Promise<void> {
    const { status } = await this.request('POST', `/epic/${encodeURIComponent(epicKey)}/issue`, { issues: [key] }, this.agile);
    if (status === 404) throw new JiraError(t('jira.create.epicNotFound', { epic: epicKey }));
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
      assignee: f.assignee?.displayName ?? null,
      url: this.browseUrl(key),
    };
  }
}
