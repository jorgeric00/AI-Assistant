import { and, asc, desc, eq, isNull, max, ne, or, sql } from 'drizzle-orm';
import type { JiraProjectOption, Task, TaskDetail } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { notes, noteTasks, tasks } from '../../db/schema.js';
import type { JiraIssue } from '../../integrations/jira/client.js';
import { recordStatusChange } from '../journal/feed.js';
import { UNSYNCED_TASK_STATUS } from './ensure-task.js';
import { jiraUpdatesOf } from './jira-update.js';

/** Datos de JIRA que se guardan en `raw_json` además de las columnas propias. */
type StoredIssue = Pick<JiraIssue, 'issueType' | 'project' | 'updated'>;

type Row = typeof tasks.$inferSelect;

function toTask(row: Row): Task {
  const raw = (row.rawJson ?? {}) as Partial<StoredIssue>;
  const category = row.statusCategory;
  return {
    key: row.jiraKey,
    summary: row.summary,
    status: row.status,
    statusCategory: category === 'new' || category === 'indeterminate' || category === 'done' ? category : null,
    priority: row.priority,
    issueType: raw.issueType ?? null,
    project: raw.project ?? null,
    url: row.url,
    updatedAt: raw.updated ?? null,
    synced: row.status !== UNSYNCED_TASK_STATUS,
  };
}

export class TasksRepository {
  constructor(private readonly db: Db) {}

  /** Tareas de la más recientemente modificada en JIRA a la más antigua; las terminadas solo si se piden. */
  list({ done }: { done: boolean }): Task[] {
    return this.db
      .select()
      .from(tasks)
      .where(done ? undefined : or(isNull(tasks.statusCategory), ne(tasks.statusCategory, 'done')))
      .orderBy(desc(sql`json_extract(${tasks.rawJson}, '$.updated')`), asc(tasks.jiraKey))
      .all()
      .map(toTask);
  }

  get(key: string): TaskDetail | null {
    const row = this.db.select().from(tasks).where(eq(tasks.jiraKey, key)).get();
    if (!row) return null;
    const linked = this.db
      .select({ id: notes.id, title: notes.title, kind: notes.kind })
      .from(noteTasks)
      .innerJoin(notes, eq(notes.id, noteTasks.noteId))
      .where(and(eq(noteTasks.taskId, row.id), eq(notes.archived, false)))
      .orderBy(desc(notes.updatedAt))
      .all();
    return { ...toTask(row), description: row.descriptionMd, notes: linked, jiraUpdates: jiraUpdatesOf(this.db, row.id) };
  }

  /** Claves que existen solo porque se escribieron en una nota y aún no se han traído de JIRA. */
  unsyncedKeys(): string[] {
    return this.db
      .select({ key: tasks.jiraKey })
      .from(tasks)
      .where(eq(tasks.status, UNSYNCED_TASK_STATUS))
      .all()
      .map((r) => r.key);
  }

  lastSyncedAt(): string | null {
    return this.db.select({ at: max(tasks.lastSyncedAt) }).from(tasks).get()?.at ?? null;
  }

  /**
   * Guarda lo que llega de JIRA actualizando por clave: las tareas creadas desde notas se completan
   * y nunca se borra ninguna, para no perder vínculos con notas y recordatorios.
   */
  /** Proyectos de JIRA de las tareas cargadas (por el prefijo de la clave), con su nombre si JIRA lo dio. */
  projects(): JiraProjectOption[] {
    const byKey = new Map<string, string>();
    for (const row of this.db.select({ key: tasks.jiraKey, raw: tasks.rawJson, status: tasks.status }).from(tasks).all()) {
      const key = row.key.replace(/-\d+$/, '');
      const name = row.status === UNSYNCED_TASK_STATUS ? null : ((row.raw ?? {}) as Partial<StoredIssue>).project;
      if (!byKey.has(key) || (name && byKey.get(key) === key)) byKey.set(key, name || key);
    }
    return [...byKey].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key));
  }

  upsertFromJira(issues: JiraIssue[], syncedAt: string) {
    this.db.transaction((tx) => {
      for (const issue of issues) {
        const values = {
          summary: issue.summary,
          descriptionMd: issue.description,
          status: issue.status,
          statusCategory: issue.statusCategory,
          priority: issue.priority,
          url: issue.url,
          rawJson: { issueType: issue.issueType, project: issue.project, updated: issue.updated } satisfies StoredIssue,
          lastSyncedAt: syncedAt,
        };
        const before = tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(eq(tasks.jiraKey, issue.key)).get();
        tx.insert(tasks)
          .values({ jiraKey: issue.key, ...values })
          .onConflictDoUpdate({ target: tasks.jiraKey, set: values })
          .run();
        // Los cambios de estado (hechos desde la app o en JIRA) quedan en el diario; la primera sincronización no cuenta.
        if (before && before.status !== UNSYNCED_TASK_STATUS && before.status !== issue.status) {
          recordStatusChange(tx, before.id, issue.key, before.status, issue.status, syncedAt);
        }
      }
    });
  }
}
