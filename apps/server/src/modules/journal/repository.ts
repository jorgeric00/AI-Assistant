import { and, desc, eq } from 'drizzle-orm';
import { JournalEntryInput, type JournalEntry } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { journalEntries, tasks } from '../../db/schema.js';

function originOf(source: JournalEntry['source'], refKey: string | null): JournalEntry['origin'] {
  if (source === 'manual') return 'manual';
  if (refKey?.startsWith('commit:')) return 'commit';
  if (refKey?.startsWith('jira:')) return 'jira';
  return 'auto';
}

export class JournalRepository {
  constructor(private readonly db: Db) {}

  /** Entradas de un día (YYYY-MM-DD local), de la más reciente a la más antigua. */
  list(date: string): JournalEntry[] {
    return this.db
      .select({ e: journalEntries, taskKey: tasks.jiraKey })
      .from(journalEntries)
      .leftJoin(tasks, eq(tasks.id, journalEntries.taskId))
      .where(eq(journalEntries.date, date))
      .orderBy(desc(journalEntries.createdAt), desc(journalEntries.id))
      .all()
      .map(({ e, taskKey }) => ({ id: e.id, date: e.date, source: e.source, origin: originOf(e.source, e.refKey), text: e.text, taskKey, url: e.url, createdAt: e.createdAt }));
  }

  createManual(input: JournalEntryInput): JournalEntry {
    const data = JournalEntryInput.parse(input);
    const row = this.db.insert(journalEntries).values({ date: data.date, text: data.text, source: 'manual' }).returning().get();
    return { id: row.id, date: row.date, source: row.source, origin: 'manual', text: row.text, taskKey: null, url: null, createdAt: row.createdAt };
  }

  /** Solo se borran entradas manuales; las automáticas vienen del registro de cambios. */
  deleteManual(id: number): boolean {
    return !!this.db
      .delete(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.source, 'manual')))
      .returning({ id: journalEntries.id })
      .get();
  }
}
