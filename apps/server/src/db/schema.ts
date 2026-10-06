// Esquema de la base de datos local (ver arquitectura/diseno-arquitectura.md, sección 4).
// Las tablas virtuales FTS5 y sqlite-vec no las gestiona Drizzle: van en migraciones SQL propias.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  CHANGELOG_KINDS,
  DEV_SESSION_REPO_STATUSES,
  DEV_SESSION_STATUSES,
  FILE_CHANGE_TYPES,
  JOURNAL_SOURCES,
  NOTE_KINDS,
  NOTIFICATION_CHANNELS,
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATUSES,
  REMINDER_STATUSES,
  type CommitRef,
} from '@dev-assistant/shared';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const updatedAt = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ── Notas y enlaces (R6, R8, R18) ───────────────────────────────────────────

export const notes = sqliteTable('notes', {
  id: id(),
  kind: text('kind', { enum: NOTE_KINDS }).notNull().default('note'),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  url: text('url'),
  urlTitle: text('url_title'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  /** Commit de la tarea al que se refiere la nota. */
  commitJson: text('commit_json', { mode: 'json' }).$type<CommitRef>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tags = sqliteTable('tags', {
  id: id(),
  name: text('name').notNull().unique(),
});

export const noteTags = sqliteTable(
  'note_tags',
  {
    noteId: integer('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] })],
);

export const noteTasks = sqliteTable(
  'note_tasks',
  {
    noteId: integer('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
    taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.taskId] })],
);

/** Fragmentos de notas para búsqueda semántica; el vector vive en la tabla virtual note_chunks_vec. */
export const noteChunks = sqliteTable('note_chunks', {
  id: id(),
  noteId: integer('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  chunkText: text('chunk_text').notNull(),
});

// ── Recordatorios (R4, R12) ─────────────────────────────────────────────────

export const reminders = sqliteTable(
  'reminders',
  {
    id: id(),
    title: text('title').notNull(),
    body: text('body'),
    dueAt: text('due_at').notNull(),
    rrule: text('rrule'),
    channels: text('channels', { enum: NOTIFICATION_CHANNELS }).notNull().default('app'),
    status: text('status', { enum: REMINDER_STATUSES }).notNull().default('pending'),
    nextFireAt: text('next_fire_at'),
    snoozedUntil: text('snoozed_until'),
    noteId: integer('note_id').references(() => notes.id, { onDelete: 'set null' }),
    taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    commitJson: text('commit_json', { mode: 'json' }).$type<CommitRef>(),
    createdAt: createdAt(),
  },
  (t) => [index('reminders_next_fire_idx').on(t.status, t.nextFireAt)],
);

export const reminderFires = sqliteTable('reminder_fires', {
  id: id(),
  reminderId: integer('reminder_id').notNull().references(() => reminders.id, { onDelete: 'cascade' }),
  firedAt: text('fired_at').notNull(),
  channel: text('channel', { enum: ['app', 'teams'] }).notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  error: text('error'),
  /** Momento previsto del aviso que se disparó (para marcarlo como atrasado si llega tarde). */
  scheduledFor: text('scheduled_for'),
  /** Cuándo viste o atendiste el aviso en la app; null = pendiente de mostrar. */
  seenAt: text('seen_at'),
});

// ── Diario de trabajo (R5, R16) ─────────────────────────────────────────────

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: id(),
    date: text('date').notNull(), // YYYY-MM-DD en hora local
    source: text('source', { enum: JOURNAL_SOURCES }).notNull(),
    taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    refTable: text('ref_table'),
    refId: integer('ref_id'),
    /** Origen de una entrada automática ("commit:CLAVE:repo@sha", "jira:CLAVE:fecha"): evita apuntarla dos veces. */
    refKey: text('ref_key'),
    /** Enlace de la entrada automática (p. ej. el commit en GitHub). */
    url: text('url'),
    createdAt: createdAt(),
  },
  (t) => [index('journal_date_idx').on(t.date), uniqueIndex('journal_ref_key_idx').on(t.refKey)],
);

export const dailySummaries = sqliteTable('daily_summaries', {
  id: id(),
  date: text('date').notNull(),
  contentMd: text('content_md').notNull(),
  generatedAt: createdAt(),
});

// ── JIRA y repositorios (R9, R10, R17) ──────────────────────────────────────

export const tasks = sqliteTable('tasks', {
  id: id(),
  jiraKey: text('jira_key').notNull().unique(),
  summary: text('summary').notNull(),
  descriptionMd: text('description_md'),
  status: text('status').notNull(),
  statusCategory: text('status_category'),
  priority: text('priority'),
  url: text('url'),
  rawJson: text('raw_json', { mode: 'json' }),
  lastSyncedAt: text('last_synced_at'),
  localNotesMd: text('local_notes_md'),
});

export const repos = sqliteTable('repos', {
  id: id(),
  name: text('name').notNull().unique(),
  localPath: text('local_path').notNull(),
  githubOwner: text('github_owner').notNull(),
  githubRepo: text('github_repo').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  jiraProjectKeys: text('jira_project_keys', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
});

export const repoProfiles = sqliteTable('repo_profiles', {
  repoId: integer('repo_id').primaryKey().references(() => repos.id, { onDelete: 'cascade' }),
  conventionsMd: text('conventions_md').notNull().default(''),
  testCommandsMd: text('test_commands_md').notNull().default(''),
  architectureMd: text('architecture_md').notNull().default(''),
  /** true mientras la ficha es el borrador de la IA y Jorge no la ha revisado y guardado. */
  aiDraft: integer('ai_draft', { mode: 'boolean' }).notNull().default(false),
  updatedAt: updatedAt(),
});

// ── Desarrollo con opencode (R10, R11, R14, R15) ────────────────────────────

export const devSessions = sqliteTable('dev_sessions', {
  id: id(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  opencodeSessionId: text('opencode_session_id'),
  status: text('status', { enum: DEV_SESSION_STATUSES }).notNull().default('analyzing'),
  planMd: text('plan_md'),
  planApprovedAt: text('plan_approved_at'),
  startedAt: createdAt(),
  endedAt: text('ended_at'),
});

export const devSessionRepos = sqliteTable(
  'dev_session_repos',
  {
    id: id(),
    devSessionId: integer('dev_session_id').notNull().references(() => devSessions.id, { onDelete: 'cascade' }),
    repoId: integer('repo_id').notNull().references(() => repos.id),
    branch: text('branch').notNull(),
    worktreePath: text('worktree_path'),
    status: text('status', { enum: DEV_SESSION_REPO_STATUSES }).notNull().default('pending'),
    prNumber: integer('pr_number'),
    prUrl: text('pr_url'),
  },
  (t) => [uniqueIndex('dev_session_repo_unique').on(t.devSessionId, t.repoId)],
);

/** "La IA propone, Jorge confirma" (R3, R14): nada sale de la app sin pasar por aquí. */
export const pendingActions = sqliteTable('pending_actions', {
  id: id(),
  devSessionId: integer('dev_session_id').references(() => devSessions.id, { onDelete: 'cascade' }),
  devSessionRepoId: integer('dev_session_repo_id').references(() => devSessionRepos.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: PENDING_ACTION_KINDS }).notNull(),
  proposalJson: text('proposal_json', { mode: 'json' }).notNull(),
  status: text('status', { enum: PENDING_ACTION_STATUSES }).notNull().default('proposed'),
  createdAt: createdAt(),
  decidedAt: text('decided_at'),
});

export const changelog = sqliteTable(
  'changelog',
  {
    id: id(),
    taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    devSessionId: integer('dev_session_id').references(() => devSessions.id, { onDelete: 'set null' }),
    repoId: integer('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: CHANGELOG_KINDS }).notNull(),
    title: text('title').notNull(),
    payloadJson: text('payload_json', { mode: 'json' }),
    externalUrl: text('external_url'),
    createdAt: createdAt(),
  },
  (t) => [index('changelog_task_idx').on(t.taskId, t.createdAt)],
);

export const commitFiles = sqliteTable('commit_files', {
  changelogId: integer('changelog_id').notNull().references(() => changelog.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  changeType: text('change_type', { enum: FILE_CHANGE_TYPES }).notNull(),
  additions: integer('additions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
});

// ── Avisos de PR propias (R13) ──────────────────────────────────────────────

export const prWatch = sqliteTable(
  'pr_watch',
  {
    id: id(),
    repoId: integer('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    lastHeadSha: text('last_head_sha'),
    lastCiState: text('last_ci_state'),
    lastCommentId: text('last_comment_id'),
    lastCheckedAt: text('last_checked_at'),
  },
  (t) => [uniqueIndex('pr_watch_unique').on(t.repoId, t.prNumber)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).notNull(),
});
