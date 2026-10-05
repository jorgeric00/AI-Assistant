import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { NoteInput, NoteUpdate, type Note, type NoteListQuery, type TagCount } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { notes, noteTags, noteTasks, tags, tasks } from '../../db/schema.js';
import { UNSYNCED_TASK_STATUS, ensureTaskId } from '../tasks/ensure-task.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type NoteRow = typeof notes.$inferSelect;

const now = () => new Date().toISOString();

/**
 * Convierte lo que escribe el usuario en una consulta FTS5 segura: cada palabra entre comillas
 * y como prefijo ("desp" encuentra "despliegue"). Todas las palabras deben aparecer.
 */
export function toFtsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}_]+/gu);
  if (!words?.length) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

// Palabras que no ayudan a encontrar notas relacionadas con una pregunta.
const STOPWORDS = new Set(
  (
    'que qué cual cuál cuales cómo como donde dónde cuando cuándo quien quién para por con sin sobre entre desde hasta ' +
    'los las del una uno unos unas este esta esto estos estas ese esa eso esos esas aquel mis tus sus nuestro nuestra ' +
    'hay has han hemos tengo tiene tienen tenía puedo puede pueden hacer hago hice hizo ser son era fue está están estaba ' +
    'mas más muy pero también tambien algo alguna alguno todo toda todos todas cosa cosas nota notas apunté apunte ' +
    'dime sabes recuerdas qué the and for what how'
  ).split(' '),
);

/**
 * Consulta FTS5 para una pregunta en lenguaje natural: las palabras significativas como
 * prefijos unidos con OR, para que baste con que una nota comparta alguna.
 */
export function toRelatedFtsQuery(question: string): string | null {
  const words = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
  if (!words.length) return null;
  // Raíz aproximada: sin las últimas letras, "despliega" encuentra también "despliegue".
  return [...new Set(words.map((w) => (w.length > 5 ? w.slice(0, Math.max(5, w.length - 3)) : w)))].map((w) => `"${w}"*`).join(' OR ');
}

export class NotesRepository {
  constructor(private readonly db: Db) {}

  list(query: NoteListQuery): Note[] {
    const conditions = [eq(notes.archived, query.archived)];
    if (query.tag) {
      conditions.push(
        inArray(
          notes.id,
          this.db.select({ id: noteTags.noteId }).from(noteTags).innerJoin(tags, eq(tags.id, noteTags.tagId)).where(eq(tags.name, query.tag)),
        ),
      );
    }

    const fts = query.q ? toFtsQuery(query.q) : null;
    let rows: NoteRow[];
    if (fts) {
      // Con búsqueda, ordena por relevancia (bm25: menor es mejor; el título pesa más).
      rows = this.db
        .select({ note: notes })
        .from(notes)
        .innerJoin(sql`notes_fts`, sql`notes_fts.rowid = ${notes.id}`)
        .where(and(sql`notes_fts match ${fts}`, ...conditions))
        .orderBy(sql`bm25(notes_fts, 5.0, 1.0, 1.0)`)
        .all()
        .map((r) => r.note);
    } else if (query.q) {
      rows = []; // solo signos de puntuación: nada que buscar
    } else {
      rows = this.db
        .select()
        .from(notes)
        .where(and(...conditions))
        .orderBy(desc(notes.pinned), desc(notes.updatedAt), desc(notes.id))
        .all();
    }
    return this.hydrate(rows);
  }

  /** Notas no archivadas que más se parecen a una pregunta (como mucho `limit`), por relevancia. */
  related(question: string, limit: number): Note[] {
    const fts = toRelatedFtsQuery(question);
    if (!fts) return [];
    const rows = this.db
      .select({ note: notes })
      .from(notes)
      .innerJoin(sql`notes_fts`, sql`notes_fts.rowid = ${notes.id}`)
      .where(and(sql`notes_fts match ${fts}`, eq(notes.archived, false)))
      .orderBy(sql`bm25(notes_fts, 5.0, 1.0, 1.0)`)
      .limit(limit)
      .all()
      .map((r) => r.note);
    return this.hydrate(rows);
  }

  get(id: number): Note | undefined {
    const row = this.db.select().from(notes).where(eq(notes.id, id)).get();
    return row ? this.hydrate([row])[0] : undefined;
  }

  create(input: NoteInput): Note {
    const data = NoteInput.parse(input);
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(notes)
        .values({
          kind: data.kind,
          title: data.title,
          bodyMd: data.bodyMd,
          url: data.url ?? null,
          urlTitle: data.urlTitle ?? null,
          pinned: data.pinned,
          archived: data.archived,
        })
        .returning({ id: notes.id })
        .get();
      this.setTags(tx, row.id, data.tags);
      this.setTasks(tx, row.id, data.taskKeys);
      return row.id;
    });
    return this.get(id)!;
  }

  update(id: number, input: NoteUpdate): Note | undefined {
    const data = NoteUpdate.parse(input);
    const found = this.db.transaction((tx) => {
      const { tags: tagNames, taskKeys, ...fields } = data;
      const res = tx
        .update(notes)
        .set({ ...fields, updatedAt: now() })
        .where(eq(notes.id, id))
        .returning({ id: notes.id })
        .get();
      if (!res) return false;
      if (tagNames) this.setTags(tx, id, tagNames);
      if (taskKeys) this.setTasks(tx, id, taskKeys);
      return true;
    });
    return found ? this.get(id) : undefined;
  }

  delete(id: number): boolean {
    return this.db.transaction((tx) => {
      const res = tx.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id }).get();
      this.deleteOrphanTags(tx);
      return !!res;
    });
  }

  /** Etiquetas usadas en notas no archivadas, de más a menos usada. */
  tagCounts(): TagCount[] {
    const count = sql<number>`count(*)`.mapWith(Number);
    return this.db
      .select({ name: tags.name, count })
      .from(tags)
      .innerJoin(noteTags, eq(noteTags.tagId, tags.id))
      .innerJoin(notes, eq(notes.id, noteTags.noteId))
      .where(eq(notes.archived, false))
      .groupBy(tags.id)
      .orderBy(desc(count), tags.name)
      .all();
  }

  private setTags(tx: Tx, noteId: number, names: string[]) {
    tx.delete(noteTags).where(eq(noteTags.noteId, noteId)).run();
    for (const name of new Set(names)) {
      tx.insert(tags).values({ name }).onConflictDoNothing().run();
      const tag = tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get()!;
      tx.insert(noteTags).values({ noteId, tagId: tag.id }).run();
    }
    this.deleteOrphanTags(tx);
  }

  /** Vincula tareas por clave; si aún no existen (JIRA sin sincronizar) se crea la tarea solo con su clave. */
  private setTasks(tx: Tx, noteId: number, keys: string[]) {
    tx.delete(noteTasks).where(eq(noteTasks.noteId, noteId)).run();
    for (const jiraKey of new Set(keys)) {
      tx.insert(noteTasks).values({ noteId, taskId: ensureTaskId(tx, jiraKey) }).run();
    }
  }

  private deleteOrphanTags(tx: Tx) {
    tx.delete(tags)
      .where(notExists(tx.select({ one: sql`1` }).from(noteTags).where(eq(noteTags.tagId, tags.id))))
      .run();
  }

  private hydrate(rows: NoteRow[]): Note[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const tagRows = this.db
      .select({ noteId: noteTags.noteId, name: tags.name })
      .from(noteTags)
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(inArray(noteTags.noteId, ids))
      .orderBy(tags.name)
      .all();
    const taskRows = this.db
      .select({ noteId: noteTasks.noteId, key: tasks.jiraKey, summary: tasks.summary, status: tasks.status })
      .from(noteTasks)
      .innerJoin(tasks, eq(tasks.id, noteTasks.taskId))
      .where(inArray(noteTasks.noteId, ids))
      .orderBy(tasks.jiraKey)
      .all();

    return rows.map((r) => ({
      ...r,
      tags: tagRows.filter((t) => t.noteId === r.id).map((t) => t.name),
      tasks: taskRows
        .filter((t) => t.noteId === r.id)
        .map((t) => ({ key: t.key, summary: t.summary, synced: t.status !== UNSYNCED_TASK_STATUS })),
    }));
  }
}
