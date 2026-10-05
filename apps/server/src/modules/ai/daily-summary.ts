import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { DailySummary, Reminder } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { dailySummaries, journalEntries, tasks } from '../../db/schema.js';
import type { Llm } from '../../integrations/opencode/llm.js';
import { RemindersRepository } from '../reminders/repository.js';

/** Error de datos que se enseña tal cual (p. ej. no hay nada que resumir). */
export class NothingToSummarizeError extends Error {}

/** Día laborable anterior a una fecha YYYY-MM-DD: el lunes mira al viernes. */
export function previousWorkday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const SYSTEM = `Eres el asistente personal de un desarrollador. Preparas lo que va a contar en la daily (reunión diaria de 15 minutos).
Responde en español, en Markdown, con exactamente estas tres secciones y en este orden:
## Ayer
## Hoy
## Bloqueos
Reglas:
- Usa solo la información que te doy. No inventes tareas, avances ni bloqueos.
- "Ayer" resume lo hecho desde el día laborable anterior. "Hoy" recoge lo apuntado para hoy y los recordatorios del día.
- Agrupa lo que sea de la misma tarea y menciona la clave de JIRA (por ejemplo ABC-123) cuando la haya.
- Viñetas cortas, en primera persona, como se diría en voz alta. Máximo 5 viñetas por sección.
- Pon un bloqueo solo si las entradas lo dicen claramente (bloqueado, esperando a, no puedo...).
- Si una sección no tiene nada, escribe "- Nada".
- No añadas nada antes ni después de las tres secciones.`;

type EntryRow = { date: string; text: string; taskKey: string | null; createdAt: string };

export class DailySummaryService {
  private readonly reminders: RemindersRepository;

  constructor(
    private readonly db: Db,
    private readonly llm: Llm,
  ) {
    this.reminders = new RemindersRepository(db);
  }

  /** Último resumen generado para la fecha, o null. */
  latest(date: string): DailySummary | null {
    const row = this.db
      .select()
      .from(dailySummaries)
      .where(eq(dailySummaries.date, date))
      .orderBy(desc(dailySummaries.generatedAt), desc(dailySummaries.id))
      .get();
    return row ? { id: row.id, date: row.date, since: previousWorkday(row.date), contentMd: row.contentMd, generatedAt: row.generatedAt } : null;
  }

  async generate(date: string): Promise<DailySummary> {
    const since = previousWorkday(date);
    const entries: EntryRow[] = this.db
      .select({ date: journalEntries.date, text: journalEntries.text, taskKey: tasks.jiraKey, createdAt: journalEntries.createdAt })
      .from(journalEntries)
      .leftJoin(tasks, eq(tasks.id, journalEntries.taskId))
      .where(and(gte(journalEntries.date, since), lte(journalEntries.date, date)))
      .orderBy(asc(journalEntries.date), asc(journalEntries.createdAt), asc(journalEntries.id))
      .all();
    const todays = remindersOn(this.reminders.list(), date);

    if (entries.length === 0 && todays.length === 0) {
      throw new NothingToSummarizeError('No hay entradas en el diario desde el último día laborable ni recordatorios para hoy. Apunta qué hiciste y vuelve a generarlo.');
    }

    const contentMd = await this.llm.complete({ system: SYSTEM, user: buildPrompt(date, since, entries, todays), title: `Resumen daily ${date}` });
    const row = this.db.insert(dailySummaries).values({ date, contentMd }).returning().get();
    return { id: row.id, date: row.date, since, contentMd: row.contentMd, generatedAt: row.generatedAt };
  }
}

/** Recordatorios activos cuyo próximo aviso cae en el día local indicado. */
function remindersOn(list: Reminder[], date: string): Reminder[] {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!).getTime();
  const end = new Date(y!, m! - 1, d! + 1).getTime();
  return list.filter((r) => {
    if (!r.nextFireAt) return false;
    const at = new Date(r.nextFireAt).getTime();
    return at >= start && at < end;
  });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function line(e: EntryRow): string {
  return `- ${e.taskKey ? `[${e.taskKey}] ` : ''}${e.text.replace(/\s+/g, ' ').trim()}`;
}

function buildPrompt(date: string, since: string, entries: EntryRow[], reminders: Reminder[]): string {
  const done = entries.filter((e) => e.date < date);
  const today = entries.filter((e) => e.date === date);
  const parts = [`Fecha de la daily: ${date}. Día laborable anterior: ${since}.`];
  parts.push(`\nEntradas del diario desde ${since} hasta ayer:\n${done.length ? done.map(line).join('\n') : '(ninguna)'}`);
  parts.push(`\nEntradas del diario de hoy:\n${today.length ? today.map(line).join('\n') : '(ninguna)'}`);
  parts.push(
    `\nRecordatorios de hoy:\n${
      reminders.length ? reminders.map((r) => `- ${time(r.nextFireAt!)} ${r.taskKey ? `[${r.taskKey}] ` : ''}${r.title}`).join('\n') : '(ninguno)'
    }`,
  );
  return parts.join('\n');
}
