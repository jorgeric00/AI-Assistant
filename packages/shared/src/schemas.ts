import { z } from 'zod';
import { NOTE_KINDS, NOTIFICATION_CHANNELS } from './enums.js';

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

export const NoteInput = z.object({
  kind: z.enum(NOTE_KINDS).default('note'),
  title: z.string().min(1),
  bodyMd: z.string().default(''),
  url: z.url().optional(),
  tags: z.array(z.string().min(1)).default([]),
  taskKeys: z.array(z.string()).default([]),
});
export type NoteInput = z.infer<typeof NoteInput>;

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
