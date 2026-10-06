// Valores cerrados compartidos entre backend, frontend y base de datos.

/** note: nota corta; link: enlace de interés; doc: documento propio (Documentación). */
export const NOTE_KINDS = ['note', 'link', 'doc'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const REMINDER_STATUSES = ['pending', 'done', 'snoozed', 'cancelled'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['app', 'teams', 'both'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const JOURNAL_SOURCES = ['manual', 'auto'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const DEV_SESSION_STATUSES = [
  'analyzing',
  'plan_proposed',
  'plan_approved',
  'coding',
  'review',
  'done',
  'cancelled',
  'failed',
] as const;
export type DevSessionStatus = (typeof DEV_SESSION_STATUSES)[number];

export const DEV_SESSION_REPO_STATUSES = [
  'pending',
  'coding',
  'committed',
  'pushed',
  'pr_open',
  'merged',
] as const;
export type DevSessionRepoStatus = (typeof DEV_SESSION_REPO_STATUSES)[number];

/** Acciones que salen de la app: siempre requieren confirmación de Jorge (R3). */
export const PENDING_ACTION_KINDS = ['commit', 'push', 'pr', 'jira_comment', 'jira_transition'] as const;
export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];

export const PENDING_ACTION_STATUSES = ['proposed', 'approved', 'rejected', 'executed', 'failed'] as const;
export type PendingActionStatus = (typeof PENDING_ACTION_STATUSES)[number];

export const CHANGELOG_KINDS = [
  'plan',
  'commit',
  'push',
  'pr',
  'jira_comment',
  'jira_transition',
  'note',
  'error',
] as const;
export type ChangelogKind = (typeof CHANGELOG_KINDS)[number];

export const FILE_CHANGE_TYPES = ['A', 'M', 'D', 'R'] as const;
export type FileChangeType = (typeof FILE_CHANGE_TYPES)[number];
