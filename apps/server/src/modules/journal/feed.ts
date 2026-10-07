// Entradas automáticas del diario: los commits que opencode anota en HISTORIAL.md (skill "dev-assistant-tarea")
// y los cambios de estado de las tareas en JIRA. Cada una lleva un ref_key único para no apuntarla dos veces.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../../db/client.js';
import { journalEntries } from '../../db/schema.js';
import { t } from '../../i18n/index.js';
import { readTaskDevInfo } from '../tasks/dev-files.js';
import { ensureTaskId } from '../tasks/ensure-task.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

/** YYYY-MM-DD en hora local del equipo, como las fechas del diario. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Apunta en el diario un cambio de estado de una tarea en JIRA (lo llama la sincronización). */
export function recordStatusChange(db: Db | Tx, taskId: number, key: string, from: string, to: string, at: string) {
  db.insert(journalEntries)
    .values({
      date: localDay(new Date(at)),
      source: 'auto',
      taskId,
      text: t('journal.statusChange', { from, to }),
      refKey: `jira:${key}:${at}`,
      createdAt: at,
    })
    .onConflictDoNothing()
    .run();
}

export class DiaryFeed {
  constructor(
    private readonly db: Db,
    private readonly devAssistantHome: string,
  ) {}

  /** Añade al diario los commits de HISTORIAL.md de todas las tareas que aún no estén. Devuelve cuántos añadió. */
  async importCommits(): Promise<number> {
    let keys: string[];
    try {
      keys = (await readdir(join(this.devAssistantHome, 'worktrees'))).filter((k) => KEY_RE.test(k));
    } catch {
      return 0;
    }
    let added = 0;
    for (const key of keys) {
      const { history } = await readTaskDevInfo(this.devAssistantHome, key);
      if (!history.length) continue;
      const taskId = ensureTaskId(this.db, key);
      for (const h of history) {
        // La hora de HISTORIAL.md es local ("AAAA-MM-DD HH:MM").
        const when = new Date(`${h.date.trim().replace(' ', 'T')}:00`);
        if (Number.isNaN(when.getTime())) continue;
        const row = this.db
          .insert(journalEntries)
          .values({
            date: localDay(when),
            source: 'auto',
            taskId,
            text: t('journal.commit', { repo: h.repo, text: h.text }),
            refKey: `commit:${key}:${h.repo}@${h.sha}`,
            url: h.url,
            createdAt: when.toISOString(),
          })
          .onConflictDoNothing()
          .returning({ id: journalEntries.id })
          .get();
        if (row) added++;
      }
    }
    return added;
  }
}
