import { z } from 'zod';
import { NOTE_KINDS, type JournalSource, type NoteKind, type ReminderStatus } from './enums.js';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.enum(['ok', 'error']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const BRANCH_PREFIX = 'feature/';

/** Rama de una tarea: feature/<ID_JIRA>-<nombre> (R15). */
export function branchNameForTask(jiraKey: string, summary: string, maxSlug = 40): string {
  const slug = summary
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxSlug)
    .replace(/-+$/g, '');
  return `${BRANCH_PREFIX}${jiraKey.toUpperCase()}${slug ? `-${slug}` : ''}`;
}

/** Clave de tarea de JIRA, p. ej. ABC-123. Se normaliza a mayúsculas. */
export const JiraKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'Clave de JIRA no válida (ej.: ABC-123)');

/** Clave de proyecto de JIRA, p. ej. ABC. */
export const ProjectKey = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/, 'Clave de proyecto de JIRA no válida (ej.: ABC)');

/** Commit de una tarea (de su HISTORIAL.md) al que se asocia una nota o un recordatorio. */
export const CommitRef = z.object({
  repo: z.string().trim().min(1),
  sha: z.string().trim().min(4),
  url: z.httpUrl().nullable(),
  text: z.string(),
});
export type CommitRef = z.infer<typeof CommitRef>;

const noteFields = {
  kind: z.enum(NOTE_KINDS),
  title: z.string().trim().min(1, 'El título es obligatorio'),
  bodyMd: z.string(),
  url: z.httpUrl().nullish(),
  urlTitle: z.string().nullish(),
  pinned: z.boolean(),
  archived: z.boolean(),
  tags: z.array(z.string().trim().toLowerCase().min(1)),
  taskKeys: z.array(JiraKey),
  commit: CommitRef.nullable(),
};

export const NoteInput = z.object({
  ...noteFields,
  kind: noteFields.kind.default('note'),
  bodyMd: noteFields.bodyMd.default(''),
  pinned: noteFields.pinned.default(false),
  archived: noteFields.archived.default(false),
  tags: noteFields.tags.default([]),
  taskKeys: noteFields.taskKeys.default([]),
  commit: noteFields.commit.default(null),
});
export type NoteInput = z.input<typeof NoteInput>;

/** Cambios parciales: sin valores por defecto, para no pisar campos que no se envían. */
export const NoteUpdate = z.object(noteFields).partial();
export type NoteUpdate = z.input<typeof NoteUpdate>;

export interface NoteTaskLink {
  key: string;
  summary: string;
  /** false mientras la tarea solo existe como clave escrita a mano (aún no sincronizada con JIRA). */
  synced: boolean;
}

export interface Note {
  id: number;
  kind: NoteKind;
  title: string;
  bodyMd: string;
  url: string | null;
  urlTitle: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  tasks: NoteTaskLink[];
  commit: CommitRef | null;
}

export const NoteListQuery = z.object({
  kind: z.enum(NOTE_KINDS).optional(),
  /** con: solo las vinculadas a alguna tarea; sin: solo las que no tienen tarea. */
  task: z.enum(['con', 'sin']).optional(),
  q: z.string().trim().optional(),
  tag: z.string().trim().toLowerCase().optional(),
  archived: z.stringbool().default(false),
});
export type NoteListQuery = z.output<typeof NoteListQuery>;

export interface TagCount {
  name: string;
  count: number;
}

export interface LinkTitleResponse {
  title: string | null;
}

// ── Recordatorios (R4, R12) ─────────────────────────────────────────────────

/** Día ISO de la semana: 1 = lunes … 7 = domingo. */
export const IsoWeekday = z.number().int().min(1).max(7);

export const Repeat = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('weekdays') }),
  z.object({ kind: z.literal('weekly'), days: z.array(IsoWeekday).min(1, 'Elige al menos un día') }),
]);
export type Repeat = z.infer<typeof Repeat>;

const reminderFields = {
  title: z.string().trim().min(1, 'Escribe qué quieres recordar'),
  body: z.string().nullish(),
  /** Primera vez que avisa (ISO con zona). En los recurrentes, la primera repetición. */
  dueAt: z.iso.datetime({ offset: true }),
  repeat: Repeat,
  taskKey: JiraKey.nullish(),
  commit: CommitRef.nullish(),
};

export const ReminderInput = z.object({ ...reminderFields, repeat: reminderFields.repeat.default({ kind: 'none' }) });
export type ReminderInput = z.input<typeof ReminderInput>;

export const ReminderUpdate = z.object(reminderFields).partial();
export type ReminderUpdate = z.input<typeof ReminderUpdate>;

/** Opciones de "Posponer" (decisión de Jorge): 10 min, 1 hora o mañana a las 9:00. */
export const SNOOZE_OPTIONS = ['10m', '1h', 'tomorrow'] as const;
export const SnoozeInput = z.object({ until: z.enum(SNOOZE_OPTIONS) });
export type SnoozeInput = z.infer<typeof SnoozeInput>;

export interface Reminder {
  id: number;
  title: string;
  body: string | null;
  /** Próxima vez que toca (en los recurrentes avanza tras cada aviso). */
  dueAt: string;
  repeat: Repeat;
  status: ReminderStatus;
  nextFireAt: string | null;
  snoozedUntil: string | null;
  taskKey: string | null;
  commit: CommitRef | null;
  createdAt: string;
}

/** Aviso disparado por el planificador que la app aún no te ha mostrado o que no has atendido. */
export interface ReminderAlert {
  id: number;
  reminderId: number;
  title: string;
  repeat: Repeat;
  firedAt: string;
  scheduledFor: string | null;
  /** true si se disparó con más de 2 minutos de retraso (p. ej. el ordenador estaba apagado). */
  late: boolean;
}

// ── Diario de trabajo (R5) ──────────────────────────────────────────────────

export const IsoDate = z.iso.date();

export const JournalEntryInput = z.object({
  date: IsoDate,
  text: z.string().trim().min(1, 'Escribe la entrada'),
});
export type JournalEntryInput = z.input<typeof JournalEntryInput>;

export interface JournalEntry {
  id: number;
  date: string;
  source: JournalSource;
  text: string;
  taskKey: string | null;
  /** De dónde sale: escrita a mano, un commit de opencode, un cambio de estado en JIRA u otra automática. */
  origin: 'manual' | 'commit' | 'jira' | 'auto';
  /** Enlace de una entrada automática: el commit en GitHub. */
  url: string | null;
  createdAt: string;
}

// ── IA: resumen para la daily y preguntas sobre las notas ───────────────────

export const DailySummaryInput = z.object({ date: IsoDate });
export type DailySummaryInput = z.input<typeof DailySummaryInput>;

export interface DailySummary {
  id: number;
  date: string;
  /** Día laborable anterior que se usó como "Ayer". */
  since: string;
  contentMd: string;
  generatedAt: string;
}

/** Dónde busca "Pregunta": notas, enlaces, documentación (propia y resúmenes de tareas), tareas de JIRA y diario. */
export const ASK_SOURCES = ['notes', 'links', 'docs', 'tasks', 'diary'] as const;
export type AskSourceType = (typeof ASK_SOURCES)[number];

export const AskInput = z.object({
  question: z.string().trim().min(3, 'Escribe una pregunta').max(500, 'La pregunta es demasiado larga'),
  sources: z.array(z.enum(ASK_SOURCES)).min(1).default([...ASK_SOURCES]),
});
export type AskInput = z.input<typeof AskInput>;

export const RewriteInput = z.object({
  text: z.string().trim().min(1, 'Escribe algo y la IA lo redacta mejor').max(20000, 'El texto es demasiado largo'),
});
export type RewriteInput = z.input<typeof RewriteInput>;

export interface RewriteResult {
  text: string;
}

export interface AskSource {
  /** Número con el que la respuesta la cita: [1], [2]... */
  ref: number;
  type: AskSourceType;
  title: string;
  /** Ruta de la app donde se ve (#/...). */
  href: string;
  /** Fecha de la fuente (ISO o AAAA-MM-DD), si la tiene. */
  date: string | null;
  /** true si la respuesta la cita. */
  cited: boolean;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
}

// ── Tareas de JIRA (R9) ─────────────────────────────────────────────────────

export const TaskListQuery = z.object({ done: z.stringbool().default(false) });
export type TaskListQuery = z.output<typeof TaskListQuery>;

/** Categoría de estado de JIRA: por hacer, en curso o terminada. */
export type TaskStatusCategory = 'new' | 'indeterminate' | 'done';

export interface Task {
  key: string;
  summary: string;
  status: string;
  statusCategory: TaskStatusCategory | null;
  priority: string | null;
  issueType: string | null;
  project: string | null;
  url: string | null;
  /** Última modificación en JIRA. */
  updatedAt: string | null;
  /** false mientras la tarea solo existe como clave escrita en una nota. */
  synced: boolean;
  /** Tarea que no era mía y se trajo con «Importar de JIRA». */
  imported: boolean;
  /** A quién está asignada en JIRA, si se sabe. */
  assignee: string | null;
}

/** ID o enlace de JIRA de la tarea que se quiere importar. */
export const TaskImportInput = z.object({ ref: z.string().trim().min(1, 'Escribe el ID o el enlace de la tarea').max(500) });
export type TaskImportInput = z.input<typeof TaskImportInput>;

export interface TaskImportPreview {
  key: string;
  summary: string;
  issueType: string | null;
  status: string;
  assignee: string | null;
  project: string | null;
  /** Ya está en la app: en vez de importarla se abre. */
  inApp: boolean;
}

export interface TaskNoteLink {
  id: number;
  title: string;
  kind: NoteKind;
}

export interface TaskDetail extends Task {
  description: string | null;
  notes: TaskNoteLink[];
  /** Lo que se ha enviado a JIRA desde la app, del más reciente al más antiguo. */
  jiraUpdates: JiraUpdateEntry[];
}

export interface JiraSyncStatus {
  /** false si faltan JIRA_URL o JIRA_TOKEN en .env. */
  configured: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  /** Usuario de JIRA con el que entró el token en la última sincronización correcta. */
  user: string | null;
  /** Tareas que devolvió la última sincronización correcta. */
  lastCount: number | null;
  /** Error de la última sincronización, si falló. */
  lastError: string | null;
  /** Por qué no se puede escribir en JIRA (falta configurarlo en .env), o null. */
  writeProblem: string | null;
}

// ── Actualizar JIRA (comentario y cambio de estado por el MCP de JIRA) ──────

/** Estado al que JIRA deja pasar la tarea desde el actual. */
export interface JiraTransitionOption {
  id: string;
  /** Nombre de la transición en JIRA. */
  name: string;
  /** Estado al que lleva. */
  to: string;
  toCategory: 'new' | 'indeterminate' | 'done' | null;
}

export const JiraUpdateInput = z
  .object({
    comment: z.string().trim().min(1, 'El comentario está vacío').max(32_000).optional(),
    transitionId: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.comment !== undefined || v.transitionId !== undefined, 'No hay nada que enviar a JIRA');
export type JiraUpdateInput = z.input<typeof JiraUpdateInput>;

export const JiraDraftInput = z.object({
  /** Estado al que se va a pasar, si se cambia a la vez: la IA lo tiene en cuenta. */
  targetStatus: z.string().trim().min(1).optional(),
});
export type JiraDraftInput = z.input<typeof JiraDraftInput>;

export interface JiraDraft {
  comment: string;
  /** Fecha del último envío a JIRA: el borrador solo usa lo nuevo desde entonces. null si es el primero. */
  since: string | null;
}

/** Un envío a JIRA desde la app (registro en la ficha de la tarea). */
export interface JiraUpdateEntry {
  at: string;
  comment: string | null;
  transition: { from: string; to: string } | null;
}

// ── Nueva tarea en JIRA (API REST, con confirmación) ─────────────────────────

export interface JiraProjectOption {
  key: string;
  name: string;
}

export interface JiraIssueTypeOption {
  id: string;
  name: string;
}

/** Proyectos donde crear y lo último que se usó (para volver a proponerlo). */
export interface JiraCreateProjects {
  projects: JiraProjectOption[];
  last: { project: string; issueTypeId: string | null } | null;
}

/** Cómo se rellena un campo obligatorio extra del proyecto en el diálogo. */
export type JiraFieldInput = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multi' | 'list' | 'unsupported';

export interface JiraExtraField {
  id: string;
  name: string;
  input: JiraFieldInput;
  options: { id: string; name: string }[];
}

/** Campos del formulario según proyecto y tipo, sacados de los metadatos de creación de JIRA. */
export interface JiraCreateForm {
  /** null si el proyecto no deja elegir prioridad al crear. */
  priorities: { id: string; name: string }[] | null;
  defaultPriorityId: string | null;
  labels: boolean;
  assignee: boolean;
  /** Obligatorios del proyecto que no cubre el formulario básico. */
  extraFields: JiraExtraField[];
}

export interface JiraEpicOption {
  key: string;
  summary: string;
}

export interface JiraSprintOption {
  id: number;
  name: string;
  state: 'active' | 'future';
}

export const JiraCreateDraftInput = z.object({
  idea: z.string().trim().min(1).max(4000),
  project: ProjectKey,
  issueType: z.string().trim().max(100).optional(),
});
export type JiraCreateDraftInput = z.input<typeof JiraCreateDraftInput>;

export interface JiraCreateDraft {
  summary: string;
  description: string;
}

export const JiraCreateInput = z.object({
  project: ProjectKey,
  issueTypeId: z.string().trim().min(1),
  summary: z.string().trim().min(1, 'El título es obligatorio').max(255),
  description: z.string().max(32_000).default(''),
  assignToMe: z.boolean().default(true),
  priorityId: z.string().trim().min(1).optional(),
  labels: z.array(z.string().trim().min(1).max(255).regex(/^\S+$/)).max(50).default([]),
  epicKey: JiraKey.optional(),
  sprintId: z.number().int().positive().optional(),
  /** Valores de los campos obligatorios extra: texto, o ids de opciones. */
  extra: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
});
export type JiraCreateInput = z.input<typeof JiraCreateInput>;

export interface JiraCreateResult {
  key: string;
  url: string;
  /** Lo que no se pudo hacer después de crearla (épica o sprint), para avisar. */
  warnings: string[];
}

// ── Desarrollo de una tarea: PLAN.md e HISTORIAL.md que mantiene opencode ───

/** Fases del plan, en orden (skill de opencode "dev-assistant-tarea"). */
export const PLAN_PHASES = ['Análisis', 'Plan aprobado', 'Implementación', 'Pruebas y PR'] as const;

export interface PlanStep {
  text: string;
  done: boolean;
}

export interface PlanSection {
  /** Título completo de la sección, p. ej. "Implementación · orders-api". */
  title: string;
  /** Fase a la que pertenece (parte del título antes de " · "). */
  phase: string;
  steps: PlanStep[];
}

export interface PlanPhase {
  name: string;
  done: number;
  total: number;
}

export interface DevPlan {
  sections: PlanSection[];
  phases: PlanPhase[];
  /** Primera fase con pasos pendientes; null si todo está hecho. */
  currentPhase: string | null;
  done: number;
  total: number;
  updatedAt: string;
}

export interface HistoryEntry {
  /** Un commit subido, o el análisis validado de una incidencia (sin commit). */
  kind: 'commit' | 'analysis';
  /** "AAAA-MM-DD HH:MM" tal como lo escribe opencode (hora local). */
  date: string;
  repo: string;
  sha: string;
  url: string | null;
  text: string;
}

export interface TaskDevInfo {
  plan: DevPlan | null;
  /** Del más reciente al más antiguo. */
  history: HistoryEntry[];
  /** Carpeta de la tarea donde opencode escribe los ficheros. */
  folder: string;
}

/** Un repositorio de la tarea, visto en el clon de siempre de Jorge. */
export interface SessionRepo {
  name: string;
  /** null si el repo no está dado de alta en Repositorios. */
  localPath: string | null;
  defaultBranch: string | null;
  /** false si la carpeta no existe o no es un repo git. */
  pathOk: boolean;
  /** Rama en la que está el clon ahora mismo. */
  currentBranch: string | null;
  /** Cambios sin guardar en el clon (opencode no cambia de rama con ellos). */
  dirty: boolean;
  /** Commits de la rama de la tarea sobre la rama base; null si la rama aún no existe. */
  commits: number | null;
  prUrl: string | null;
}

/** Sesión de desarrollo de una tarea: opencode en la terminal y lo que la app ve de los repos. */
export interface DevSession {
  /** Carpeta de la tarea (PLAN.md, HISTORIAL.md y TAREA.md). */
  folder: string;
  /** Rama de la tarea (línea "Rama:" de PLAN.md). */
  branch: string | null;
  /** La tarea es solo el análisis de una incidencia (línea "Tipo: análisis" de PLAN.md). */
  analysis: boolean;
  /** true si opencode ya ha fijado los repos en PLAN.md; si no, son los dados de alta para el proyecto de JIRA. */
  reposConfirmed: boolean;
  repos: SessionRepo[];
  /** Comando para abrir opencode a mano en la carpeta de la tarea. */
  command: string;
  /** true si la app puede abrir la terminal ella misma (Windows). */
  canOpen: boolean;
}

export interface SessionOpenResult {
  opened: boolean;
  command: string;
}

/** RESUMEN.md que escribe opencode al cerrar una tarea (Documentación › De tareas). */
export interface TaskDoc {
  key: string;
  /** Título del resumen (su primera cabecera, sin la clave). */
  title: string;
  repos: string[];
  /** Enlaces a PR que aparecen en el resumen. */
  prCount: number;
  updatedAt: string;
}

export interface TaskDocDetail extends TaskDoc {
  markdown: string;
}

export interface OpencodeSkillStatus {
  installed: boolean;
  /** false si la instalada es distinta de la versión de la app. */
  upToDate: boolean;
  path: string;
}

// ── Repositorios y su ficha (R17) ───────────────────────────────────────────


export const RepoProfileInput = z.object({
  conventionsMd: z.string(),
  testCommandsMd: z.string(),
  architectureMd: z.string(),
});
export type RepoProfileInput = z.infer<typeof RepoProfileInput>;

const repoFields = {
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  localPath: z.string().trim().min(1, 'La carpeta es obligatoria'),
  /** "dueño/repo" de GitHub; vacío si el repo no tiene remoto en GitHub. */
  github: z
    .string()
    .trim()
    .regex(/^$|^[\w.-]+\/[\w.-]+$/, 'El repo de GitHub debe ser dueño/nombre'),
  defaultBranch: z.string().trim().min(1, 'La rama base es obligatoria'),
  jiraProjectKeys: z.array(ProjectKey),
};

export const RepoInput = z.object({
  ...repoFields,
  github: repoFields.github.default(''),
  defaultBranch: repoFields.defaultBranch.default('main'),
  jiraProjectKeys: repoFields.jiraProjectKeys.default([]),
});
export type RepoInput = z.input<typeof RepoInput>;

export const RepoUpdate = z.object({ ...repoFields, profile: RepoProfileInput }).partial();
export type RepoUpdate = z.input<typeof RepoUpdate>;

export const REPO_PROFILE_STATUSES = ['completa', 'por_revisar', 'sin_ficha'] as const;
export type RepoProfileStatus = (typeof REPO_PROFILE_STATUSES)[number];

export interface Repo {
  id: number;
  name: string;
  localPath: string;
  github: string;
  defaultBranch: string;
  jiraProjectKeys: string[];
  profileStatus: RepoProfileStatus;
}

export interface RepoProfile extends RepoProfileInput {
  /** Borrador de la IA aún sin revisar. */
  aiDraft: boolean;
  updatedAt: string;
}

export interface RepoDetail extends Repo {
  profile: RepoProfile | null;
  /** false si la carpeta ya no existe o no es un repo git. */
  pathOk: boolean;
}

export const RepoInspectInput = z.object({ localPath: z.string().trim().min(1, 'Indica la carpeta') });

/** Lo que la app deduce de una carpeta para rellenar el alta. */
export interface RepoInspection {
  isGitRepo: boolean;
  name: string;
  github: string;
  defaultBranch: string | null;
}

// ── Avisos de tus PR (GitHub) ───────────────────────────────────────────────

export const PR_ALERT_KINDS = ['ci_failed', 'comments', 'changes_requested', 'approved', 'merged'] as const;
export type PrAlertKind = (typeof PR_ALERT_KINDS)[number];

export type PrState = 'open' | 'merged' | 'closed';
export type PrChecksState = 'success' | 'failure' | 'pending';

/** Una PR tuya tal como la vio la última consulta a GitHub. */
export interface PullRequestInfo {
  id: string;
  /** owner/repo */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  headRef: string;
  /** Clave de JIRA sacada de la rama o del título. */
  taskKey: string | null;
  checks: PrChecksState | null;
  failingChecks: string[];
  /** Revisión vigente: quién aprobó, quién pidió cambios y cuántos comentarios de otros hay. */
  approvedBy: string[];
  changesRequestedBy: string[];
  comments: number;
  updatedAt: string;
  /** false = no avisa en Hoy ni con notificaciones. */
  watched: boolean;
}

export const PR_LIST_FILTERS = ['open', 'merged', 'closed', 'all'] as const;
export type PrListFilter = (typeof PR_LIST_FILTERS)[number];

export interface PrList {
  prs: PullRequestInfo[];
  /** Si no se pudo leer de GitHub (las mergeadas y cerradas se piden al momento). */
  error: string | null;
}

export const PrWatchInput = z.object({ watched: z.boolean() });
export type PrWatchInput = z.infer<typeof PrWatchInput>;

export interface PrAlert {
  id: number;
  kind: PrAlertKind;
  /** Id de la PR en GitHub. */
  prId: string;
  repo: string;
  number: number;
  url: string;
  taskKey: string | null;
  /** "CI en rojo", "2 comentarios nuevos"... */
  title: string;
  /** Título de la PR. */
  prTitle: string;
  detail: string | null;
  createdAt: string;
}

/** Una línea que un check marca en el código (Checkstyle, el compilador...). */
export interface PrCheckAnnotation {
  path: string;
  line: number | null;
  message: string;
  title: string | null;
  level: 'failure' | 'warning' | 'notice';
}

/** Un check en rojo con lo que publica en GitHub. */
export interface PrCheckFailure {
  name: string;
  /** Título que da el check ("3 errores de Checkstyle"); en un estado clásico, su descripción. */
  title: string | null;
  /** Resumen o texto del check (markdown, recortado). */
  summary: string | null;
  url: string | null;
  annotations: PrCheckAnnotation[];
  /** Cuántas anotaciones tiene en total (puede haber más de las que se enseñan). */
  annotationsTotal: number;
}

/** Los checks en rojo de una PR, leídos de GitHub en el momento. */
export interface PrFailures {
  prId: string;
  repo: string;
  number: number;
  url: string;
  taskKey: string | null;
  checks: PrChecksState | null;
  failures: PrCheckFailure[];
  /** Nombres de los checks en verde y de los que aún no han terminado. */
  passing: string[];
  pending: string[];
}

/** Página de una PR: lo último que se vio en GitHub y sus avisos. */
export interface PrDetail extends PullRequestInfo {
  alerts: PrAlert[];
}

/** Dónde se mandaron los fallos con "Arreglar con opencode". */
export type PrFixResult = { target: 'task'; taskKey: string } | { target: 'chat'; conversationId: string };

export interface PrWatchStatus {
  configured: boolean;
  user: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

// ── Ajustes: arranque automático y copias de seguridad ─────────────────────

export interface AutostartStatus {
  /** false fuera de Windows: no hay carpeta Inicio en la que dejar el script. */
  supported: boolean;
  enabled: boolean;
  openBrowser: boolean;
  /** Fichero donde escribe la app cuando arranca sola. */
  logFile: string;
}

export const AutostartUpdate = z.object({ enabled: z.boolean().optional(), openBrowser: z.boolean().optional() });
export type AutostartUpdate = z.infer<typeof AutostartUpdate>;

export interface BackupStatus {
  supported: boolean;
  dir: string;
  count: number;
  last: { name: string; at: string; bytes: number } | null;
}

// ── Idioma de la app (Ajustes > Idioma) ─────────────────────────────────────

export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** `language` es null hasta que se elige (la web propone el del navegador). */
export interface LanguageSetting {
  language: Language | null;
}

export const LanguageUpdate = z.object({ language: z.enum(LANGUAGES) });
export type LanguageUpdate = z.infer<typeof LanguageUpdate>;

// ── IA: modelos y modos de opencode (Ajustes > Inteligencia artificial) ─────

/** Un modelo se nombra como en opencode: "proveedor/modelo". */
const ModelRef = z.string().trim().regex(/^[^/\s]+\/\S+$/, 'Modelo no válido').max(200);

export interface AiModelOption {
  /** "proveedor/modelo". */
  id: string;
  name: string;
}

export interface AiProviderOption {
  id: string;
  name: string;
  models: AiModelOption[];
}

export interface AiAgentOption {
  /** Nombre del agente en opencode ("build", "plan" o uno propio). */
  name: string;
  description: string | null;
}

/** Lo que ofrece el opencode del usuario; `available` es false si no se pudo hablar con él. */
export interface AiOptions {
  available: boolean;
  error: string | null;
  providers: AiProviderOption[];
  /** El modelo por defecto de la configuración de opencode ("model"), si lo tiene. */
  defaultModel: string | null;
  agents: AiAgentOption[];
}

/** Estado de un servidor MCP en opencode. `needs_auth`: falta iniciar sesión (`opencode mcp auth <nombre>`). */
export type McpState = 'connected' | 'failed' | 'needs_auth' | 'disabled' | 'unknown';

export interface McpServer {
  name: string;
  state: McpState;
  /** Error que da opencode al arrancarlo (solo si `failed`). */
  error: string | null;
}

/** Herramientas MCP que ve el opencode de la app (Ajustes > Inteligencia artificial). */
export interface McpOverview {
  available: boolean;
  error: string | null;
  /** Versión de opencode. */
  version: string | null;
  /** Ejecutable de opencode que arranca la app; null si se usa OPENCODE_URL o no se encuentra. */
  binary: string | null;
  /** OPENCODE_URL, si se usa un opencode ya arrancado. */
  url: string | null;
  /** Carpeta de configuración global que lee opencode. */
  configDir: string | null;
  servers: McpServer[];
}

/** `null` = el predeterminado de opencode. */
export const AiSettings = z.object({
  /** Modelo de Pregunta, Redactar con IA y resúmenes. */
  appModel: ModelRef.nullable(),
  /** Modelo y modo con los que empieza cada sesión de desarrollo. */
  sessionModel: ModelRef.nullable(),
  sessionAgent: z.string().trim().min(1).max(60),
});
export type AiSettings = z.infer<typeof AiSettings>;
export const AiSettingsUpdate = AiSettings.partial();
export type AiSettingsUpdate = z.infer<typeof AiSettingsUpdate>;

// ── Sesión con opencode dentro de la app (chat de la tarea) ─────────────────

export const CHAT_TOOL_STATUSES = ['pending', 'running', 'completed', 'error'] as const;
export type ChatToolStatus = (typeof CHAT_TOOL_STATUSES)[number];

export type ChatPart =
  | { type: 'text'; id: string; text: string }
  | {
      type: 'tool';
      id: string;
      /** Herramienta de opencode: bash, read, edit, write, grep... o una de un MCP. */
      tool: string;
      status: ChatToolStatus;
      /** Lo que hace, en corto: el comando, el fichero, el patrón... */
      detail: string;
      /** Salida o error (recortado). */
      output: string | null;
      seconds: number | null;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Modo (agente) y modelo con los que se envió o se generó. */
  agent: string | null;
  model: string | null;
  createdAt: string;
  error: string | null;
  parts: ChatPart[];
}

export interface ChatPermission {
  id: string;
  /** Qué pide: bash, edit, webfetch... */
  permission: string;
  /** Lo concreto: el comando, el fichero... */
  detail: string;
  /** El cambio que quiere hacer en un fichero, si lo da opencode. */
  diff: string | null;
  /** A qué se extiende "Permitir siempre" (patrones de opencode). */
  always: string[];
}

/** Una opción de una pregunta de opencode. */
export interface ChatQuestionOption {
  /** Lo que se le devuelve a opencode si se elige. */
  value: string;
  label: string;
  description: string | null;
  /** opencode la recomienda. */
  recommended: boolean;
}

/** Una de las preguntas que opencode hace a la vez. */
export interface ChatQuestionItem {
  key: string;
  /** Nombre corto (Rama, Tests...). */
  header: string;
  question: string;
  options: ChatQuestionOption[];
  /** Se pueden elegir varias opciones. */
  multiple: boolean;
  /** Se puede escribir otra respuesta. */
  custom: boolean;
}

/** Preguntas de opencode pendientes de respuesta (solo opencode 2.x). */
export interface ChatQuestion {
  id: string;
  items: ChatQuestionItem[];
}

export const ChatQuestionReplyInput = z.union([
  z.object({ answers: z.record(z.string().max(100), z.union([z.string().trim().min(1).max(2000), z.array(z.string().max(2000)).min(1).max(50)])) }),
  z.object({ skip: z.literal(true) }),
]);
export type ChatQuestionReplyInput = z.infer<typeof ChatQuestionReplyInput>;

/** Estado de un chat con opencode en la app (el de una tarea o uno del chat general). */
export interface ChatState {
  /** false si no se pudo hablar con opencode (`error` dice por qué). */
  available: boolean;
  error: string | null;
  /** Hay una sesión de opencode creada. */
  started: boolean;
  /** opencode está trabajando (o esperando un permiso). */
  busy: boolean;
  messages: ChatMessage[];
  permissions: ChatPermission[];
  questions: ChatQuestion[];
  /** Selección actual de la sesión (la última usada o la de Ajustes). */
  model: string | null;
  agent: string;
  /** Porcentaje de la ventana de contexto usado, si se conoce. */
  contextPercent: number | null;
}

export interface TaskChat extends ChatState {
  /** Mensaje con el que se empieza la tarea. */
  starterPrompt: string;
  /** Mensaje con el que se empieza solo el análisis de una incidencia. */
  analysisPrompt: string;
  /** La tarea parece una incidencia (por su tipo en JIRA): se recomienda empezar por el análisis. */
  suggestAnalysis: boolean;
}

// ── Chat general con opencode (sin tarea) ────────────────────────────────────

export interface Conversation {
  /** Id de la sesión de opencode. */
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationList {
  available: boolean;
  error: string | null;
  conversations: Conversation[];
}

export interface GeneralChat extends ChatState {
  /** null = conversación nueva, aún sin mensajes. */
  id: string | null;
  title: string | null;
}

export const ConversationId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const ChatSendInput = z.object({
  text: z.string().trim().min(1, 'Escribe un mensaje').max(20_000),
  model: ModelRef.nullable().optional(),
  agent: z.string().trim().min(1).max(60).optional(),
});
export type ChatSendInput = z.infer<typeof ChatSendInput>;

export const CHAT_PERMISSION_REPLIES = ['once', 'always', 'reject'] as const;
export type ChatPermissionReply = (typeof CHAT_PERMISSION_REPLIES)[number];
export const ChatPermissionReplyInput = z.object({ reply: z.enum(CHAT_PERMISSION_REPLIES) });
export type ChatPermissionReplyInput = z.infer<typeof ChatPermissionReplyInput>;
