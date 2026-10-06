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
};

export const NoteInput = z.object({
  ...noteFields,
  kind: noteFields.kind.default('note'),
  bodyMd: noteFields.bodyMd.default(''),
  pinned: noteFields.pinned.default(false),
  archived: noteFields.archived.default(false),
  tags: noteFields.tags.default([]),
  taskKeys: noteFields.taskKeys.default([]),
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
}

export const NoteListQuery = z.object({
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

export const AskInput = z.object({
  question: z.string().trim().min(3, 'Escribe una pregunta').max(500, 'La pregunta es demasiado larga'),
});
export type AskInput = z.input<typeof AskInput>;

export interface AskSource {
  /** Número con el que la respuesta cita la nota: [1], [2]... */
  ref: number;
  id: number;
  title: string;
  kind: NoteKind;
  /** true si la respuesta cita esta nota. */
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
}

/** Un envío a JIRA desde la app (registro en la ficha de la tarea). */
export interface JiraUpdateEntry {
  at: string;
  comment: string | null;
  transition: { from: string; to: string } | null;
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

export interface OpencodeSkillStatus {
  installed: boolean;
  /** false si la instalada es distinta de la versión de la app. */
  upToDate: boolean;
  path: string;
}

// ── Repositorios y su ficha (R17) ───────────────────────────────────────────

const ProjectKey = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/, 'Clave de proyecto de JIRA no válida (ej.: ABC)');

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
