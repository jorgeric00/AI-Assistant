// Imputación de horas en JIRA desde el diario: lunes a jueves 9 h y viernes 6 h, repartidas entre las tareas
// con actividad ese día (proporcional al número de entradas del diario) en tramos de media hora.
import { and, between, eq, isNotNull } from 'drizzle-orm';
import type { WorklogDay, WorklogRange, WorklogSubmit, WorklogSubmitResult } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { journalEntries, tasks, worklogImputations } from '../../db/schema.js';
import { JiraError, type JiraClient } from '../../integrations/jira/client.js';
import { t } from '../../i18n/index.js';

/** Horas de un día de la semana (0 = domingo): lunes a jueves 9, viernes 6, fin de semana 0. */
export function targetHours(date: string): number {
  const dow = new Date(`${date}T12:00:00`).getDay();
  return dow >= 1 && dow <= 4 ? 9 : dow === 5 ? 6 : 0;
}

/** Reparte `total` horas en tramos de media hora, proporcional a los pesos; cada tarea recibe al menos media hora. */
export function allocate(weights: number[], total: number): number[] {
  const units = Math.round(total * 2);
  const n = weights.length;
  if (!n) return [];
  // Con más tareas que tramos solo cuentan las de más peso.
  const keep = [...weights.keys()].sort((a, b) => weights[b]! - weights[a]! || a - b).slice(0, units);
  const sum = keep.reduce((s, i) => s + weights[i]!, 0);
  const quota = new Map(keep.map((i) => [i, (weights[i]! / sum) * units]));
  const given = new Map(keep.map((i) => [i, Math.floor(quota.get(i)!)]));
  let left = units - [...given.values()].reduce((s, v) => s + v, 0);
  for (const i of [...keep].sort((a, b) => quota.get(b)! - Math.floor(quota.get(b)!) - (quota.get(a)! - Math.floor(quota.get(a)!)) || a - b)) {
    if (left <= 0) break;
    given.set(i, given.get(i)! + 1);
    left--;
  }
  // Nadie se queda a cero: se le quita un tramo a quien más tiene.
  for (const i of keep) {
    if (given.get(i)! > 0) continue;
    const big = keep.reduce((m, j) => (given.get(j)! > given.get(m)! ? j : m), keep[0]!);
    given.set(big, given.get(big)! - 1);
    given.set(i, 1);
  }
  return weights.map((_, i) => (given.get(i) ?? 0) / 2);
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00`); out.length < 400; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (iso > to) break;
    out.push(iso);
  }
  return out;
}

const INCIDENT_TYPE = /bug|incidenc|incident|defect|error|fallo|\bbaus?\b/i;

/** Atributos de Tempo de una imputación: incidencias, bugs y baus son Support; el resto (historias, tareas) New Functionality. Order es siempre Services. */
export function tempoAttributes(issueType: string | null | undefined): Record<string, string> {
  return { 'Type of Work': INCIDENT_TYPE.test(issueType ?? '') ? 'Support' : 'New Functionality', Order: 'Services' };
}

export class WorklogService {
  constructor(
    private readonly db: Db,
    private readonly jira: JiraClient | null,
  ) {}

  preview(range: WorklogRange): WorklogDay[] {
    const rows = this.db
      .select({ date: journalEntries.date, key: tasks.jiraKey, summary: tasks.summary })
      .from(journalEntries)
      .innerJoin(tasks, eq(tasks.id, journalEntries.taskId))
      .where(and(between(journalEntries.date, range.from, range.to), isNotNull(journalEntries.taskId)))
      .all();
    const done = new Set(this.db.select({ date: worklogImputations.date }).from(worklogImputations).where(between(worklogImputations.date, range.from, range.to)).all().map((r) => r.date));
    const result: WorklogDay[] = [];
    for (const date of days(range.from, range.to)) {
      const target = targetHours(date);
      if (!target) continue;
      const perTask = new Map<string, { summary: string; count: number }>();
      for (const r of rows.filter((x) => x.date === date)) perTask.set(r.key, { summary: r.summary, count: (perTask.get(r.key)?.count ?? 0) + 1 });
      const entries = [...perTask.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const hours = allocate(entries.map(([, v]) => v.count), target);
      const lines = entries.map(([key, v], i) => ({ key, summary: v.summary, hours: hours[i]! })).filter((l) => l.hours > 0);
      result.push({ date, target, status: done.has(date) ? 'imputado' : lines.length ? 'pendiente' : 'sin_actividad', lines });
    }
    return result;
  }

  /** Tipo de ticket guardado al sincronizar con JIRA. */
  private issueType(key: string): string | null {
    const raw = this.db.select({ raw: tasks.rawJson }).from(tasks).where(eq(tasks.jiraKey, key)).get()?.raw as { issueType?: string | null } | null | undefined;
    return raw?.issueType ?? null;
  }

  async submit(input: WorklogSubmit): Promise<WorklogSubmitResult> {
    if (!this.jira) throw new JiraError(t('jira.notConfigured'));
    const result: WorklogSubmitResult = { done: 0, failed: [] };
    for (const e of input.entries) {
      const taken = this.db.select({ id: worklogImputations.id }).from(worklogImputations).where(and(eq(worklogImputations.date, e.date), eq(worklogImputations.jiraKey, e.key))).get();
      if (taken) {
        result.failed.push({ date: e.date, key: e.key, error: t('worklog.alreadyLogged') });
        continue;
      }
      const seconds = Math.round(e.hours * 3600);
      try {
        await this.jira.logWork(e.key, e.date, seconds, tempoAttributes(this.issueType(e.key)));
      } catch (err) {
        result.failed.push({ date: e.date, key: e.key, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      this.db.insert(worklogImputations).values({ date: e.date, jiraKey: e.key, seconds }).run();
      result.done++;
    }
    return result;
  }
}
