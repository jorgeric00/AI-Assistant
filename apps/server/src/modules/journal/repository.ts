import { and, desc, eq } from 'drizzle-orm';
import { JournalEntryInput, type JournalEntry } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { journalEntries, tasks } from '../../db/schema.js';

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
      .map(({ e, taskKey }) => ({ id: e.id, date: e.date, source: e.source, text: e.text, taskKey, createdAt: e.createdAt }));
  }

  createManual(input: JournalEntryInput): JournalEntry {
    const data = JournalEntryInput.parse(input);
    const row = this.db.insert(journalEntries).values({ date: data.date, text: data.text, source: 'manual' }).returning().get();
    return { id: row.id, date: row.date, source: row.source, text: row.text, taskKey: null, createdAt: row.createdAt };
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
