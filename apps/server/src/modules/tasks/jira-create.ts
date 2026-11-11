// "Nueva tarea en JIRA": el usuario rellena (o la IA redacta) la tarea y se crea por la API REST al confirmar.
// La épica y el sprint se asignan después con la API de JIRA Software, que no depende de la pantalla de creación.
import { eq } from 'drizzle-orm';
import {
  JiraCreateInput,
  type JiraCreateDraft,
  type JiraCreateDraftInput,
  type JiraCreateForm,
  type JiraCreateProjects,
  type JiraCreateResult,
  type JiraEpicOption,
  type JiraExtraField,
  type JiraFieldInput,
  type JiraIssueTypeOption,
  type JiraSprintOption,
} from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { JiraError, type JiraClient, type JiraFieldMeta } from '../../integrations/jira/client.js';
import type { Llm } from '../../integrations/opencode/llm.js';
import { t } from '../../i18n/index.js';
import type { TasksRepository } from './repository.js';

const LAST_KEY = 'jira.lastCreate';
const EPIC_LINK = 'com.pyxis.greenhopper.jira:gh-epic-link';
const SPRINT = 'com.pyxis.greenhopper.jira:gh-sprint';
/** Campos que cubre el formulario o que rellena JIRA solo. */
const HANDLED = new Set(['project', 'issuetype', 'summary', 'description', 'reporter', 'assignee', 'priority', 'labels', 'parent']);
const EPIC_TYPE = /^(epic|épica|epica)$/i;

/** Error de datos que se enseña tal cual (400). */
export class JiraCreateInputError extends Error {}

function inputFor(f: JiraFieldMeta): JiraFieldInput {
  const { type, items, custom } = f.schema;
  if (f.allowedValues.length) return type === 'array' ? 'multi' : 'select';
  if (type === 'string') return custom?.endsWith(':textarea') ? 'textarea' : 'text';
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'array' && items === 'string') return 'list';
  return 'unsupported';
}

/** Valor que espera JIRA para un campo extra, según cómo se rellenó. */
function fieldValue(f: JiraFieldMeta, value: string | string[]): unknown {
  const values = (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
  switch (inputFor(f)) {
    case 'select':
      return values[0] ? { id: values[0] } : undefined;
    case 'multi':
      return values.map((id) => ({ id }));
    case 'number': {
      const n = Number(values[0]);
      if (values[0] === undefined || Number.isNaN(n)) throw new JiraCreateInputError(t('jira.create.notANumber', { field: f.name }));
      return n;
    }
    case 'list':
      return values.flatMap((v) => v.split(',').map((x) => x.trim()).filter(Boolean));
    default:
      return values.length ? values.join('\n') : undefined;
  }
}

const draftSystem = () => `Eres el asistente personal de un desarrollador. A partir de una idea corta redactas una tarea de JIRA.
Reglas:
- ${t('ai.answerLanguage')}
- Primera línea: el resumen (título) de la tarea, como mucho 100 caracteres, sin prefijos como "Resumen:" ni comillas.
- Después una línea en blanco y la descripción.
- La descripción: una o dos frases de contexto (si encaja, en forma de historia de usuario) y una lista de criterios de aceptación, cada uno en una línea que empieza por "- ".
- Texto plano, sin Markdown (nada de #, ** ni bloques de código).
- Usa solo lo que dice la idea. No inventes nombres de sistemas, cifras ni fechas.
- No escribas nada antes del resumen ni después de la descripción.`;

export class JiraCreateService {
  constructor(
    private readonly db: Db,
    private readonly repo: TasksRepository,
    private readonly client: JiraClient | null,
    private readonly llm: Llm,
  ) {}

  private requireClient(): JiraClient {
    if (!this.client) throw new JiraError(t('jira.notConfigured'));
    return this.client;
  }

  private last(): JiraCreateProjects['last'] {
    const value = this.db.select().from(settings).where(eq(settings.key, LAST_KEY)).get()?.valueJson as JiraCreateProjects['last'] | undefined;
    return value && typeof value.project === 'string' ? value : null;
  }

  private remember(value: NonNullable<JiraCreateProjects['last']>) {
    this.db.insert(settings).values({ key: LAST_KEY, valueJson: value }).onConflictDoUpdate({ target: settings.key, set: { valueJson: value } }).run();
  }

  async projects(): Promise<JiraCreateProjects> {
    const projects = await this.requireClient().projects();
    return { projects: projects.sort((a, b) => a.key.localeCompare(b.key)), last: this.last() };
  }

  async issueTypes(project: string): Promise<JiraIssueTypeOption[]> {
    return this.requireClient().issueTypes(project);
  }

  async form(project: string, issueTypeId: string): Promise<JiraCreateForm> {
    const fields = await this.requireClient().createFields(project, issueTypeId);
    const priority = fields.find((f) => f.id === 'priority');
    const extraFields: JiraExtraField[] = fields
      .filter((f) => f.required && !f.hasDefaultValue && !HANDLED.has(f.id) && f.schema.custom !== EPIC_LINK && f.schema.custom !== SPRINT)
      .map((f) => ({ id: f.id, name: f.name, input: inputFor(f), options: f.allowedValues }));
    return {
      priorities: priority?.allowedValues.length ? priority.allowedValues : null,
      // JIRA no dice cuál es la prioridad por defecto; se propone la del medio de la lista.
      defaultPriorityId: priority?.allowedValues.length ? priority.allowedValues[Math.floor((priority.allowedValues.length - 1) / 2)]!.id : null,
      labels: fields.some((f) => f.id === 'labels'),
      assignee: fields.some((f) => f.id === 'assignee'),
      extraFields,
    };
  }

  /** Épicas sin terminar del proyecto, filtradas por texto o clave. */
  async epics(project: string, q?: string): Promise<JiraEpicOption[]> {
    const client = this.requireClient();
    // El tipo épica se busca por su nombre entre los del proyecto y, si no se pueden crear ahí, entre todos
    // los de JIRA (en Cloud, por su nivel). Sin él no hay épicas que ofrecer: buscar «Epic» falla si se llama distinto.
    const isEpic = (it: { name: string; hierarchyLevel?: number }) => EPIC_TYPE.test(it.name) || it.hierarchyLevel === 1;
    const epicType =
      (await client.issueTypes(project).catch(() => [])).find(isEpic) ?? (await client.allIssueTypes().catch(() => [])).find(isEpic);
    if (!epicType) return [];
    const clauses = [`project = "${project}"`, `issuetype = ${epicType.id}`, 'statusCategory != Done'];
    const text = q?.trim().replace(/["\\]/g, '');
    if (text) {
      clauses.push(/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(text) ? `(key = "${text.toUpperCase()}" OR summary ~ "${text}*")` : `summary ~ "${text}*"`);
    }
    const issues = await client.search(`${clauses.join(' AND ')} ORDER BY updated DESC`, 30);
    return issues.map((i) => ({ key: i.key, summary: i.summary }));
  }

  async sprints(project: string): Promise<JiraSprintOption[]> {
    return this.requireClient().sprints(project);
  }

  async draft(input: JiraCreateDraftInput): Promise<JiraCreateDraft> {
    const parts = [`Proyecto de JIRA: ${input.project}`];
    if (input.issueType) parts.push(`Tipo de incidencia: ${input.issueType}`);
    parts.push(`Idea:\n${input.idea}`);
    const answer = await this.llm.complete({ system: draftSystem(), user: parts.join('\n'), title: `Nueva tarea JIRA ${input.project}` });
    const lines = answer.trim().split(/\r?\n/);
    const summary = (lines.shift() ?? '')
      .replace(/^\s*(resumen|summary|t[ií]tulo|title)\s*:\s*/i, '')
      .replace(/^["'«]|["'»]$/g, '')
      .trim()
      .slice(0, 255);
    if (!summary) throw new JiraCreateInputError(t('ai.emptyAnswer'));
    return { summary, description: lines.join('\n').trim() };
  }

  async create(raw: JiraCreateInput): Promise<JiraCreateResult> {
    const input = JiraCreateInput.parse(raw);
    const client = this.requireClient();
    const meta = await client.createFields(input.project, input.issueTypeId);
    const byId = new Map(meta.map((f) => [f.id, f]));

    const fields: Record<string, unknown> = {
      project: { key: input.project },
      issuetype: { id: input.issueTypeId },
      summary: input.summary,
    };
    if (input.description.trim()) fields.description = client.richText(input.description.trim());
    if (input.assignToMe && byId.has('assignee')) fields.assignee = await client.assigneeRef();
    if (input.priorityId && byId.has('priority')) fields.priority = { id: input.priorityId };
    if (input.labels.length && byId.has('labels')) fields.labels = input.labels;
    for (const [id, value] of Object.entries(input.extra)) {
      const f = byId.get(id);
      if (!f || HANDLED.has(id)) continue;
      const v = fieldValue(f, value);
      if (v !== undefined && !(Array.isArray(v) && !v.length)) fields[id] = v;
    }
    const missing = meta.filter((f) => f.required && !f.hasDefaultValue && !HANDLED.has(f.id) && f.schema.custom !== EPIC_LINK && f.schema.custom !== SPRINT && fields[f.id] === undefined);
    if (missing.length) throw new JiraCreateInputError(t('jira.create.missingFields', { fields: missing.map((f) => f.name).join(', ') }));

    const key = await client.createIssue(fields);
    this.remember({ project: input.project, issueTypeId: input.issueTypeId });

    // La tarea ya existe: lo que falle a partir de aquí se avisa, pero no se deshace.
    const warnings: string[] = [];
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
    if (input.epicKey) {
      await client.addToEpic(input.epicKey, key).catch((err) => warnings.push(t('jira.create.epicFailed', { epic: input.epicKey!, message: message(err) })));
    }
    if (input.sprintId) {
      await client.addToSprint(input.sprintId, key).catch((err) => warnings.push(t('jira.create.sprintFailed', { message: message(err) })));
    }

    const issue = await client.getIssue(key).catch(() => null);
    if (issue) this.repo.upsertFromJira([issue], new Date().toISOString());
    return { key, url: issue?.url ?? client.browseUrl(key), warnings };
  }
}
