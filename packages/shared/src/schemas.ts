import { z } from 'zod';
import { NOTE_KINDS, NOTIFICATION_CHANNELS, type NoteKind } from './enums.js';

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

export const ReminderInput = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  dueAt: z.iso.datetime(),
  rrule: z.string().optional(),
  channels: z.enum(NOTIFICATION_CHANNELS).default('app'),
  noteId: z.number().int().optional(),
  taskId: z.number().int().optional(),
});
export type ReminderInput = z.infer<typeof ReminderInput>;
