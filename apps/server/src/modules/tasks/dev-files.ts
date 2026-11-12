// Lectura de los ficheros que opencode mantiene por tarea (skill "dev-assistant-tarea"), fuera de los
// repos de la empresa: ~/.dev-assistant/worktrees/<CLAVE>/PLAN.md e HISTORIAL.md.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PLAN_PHASES, type DevPlan, type HistoryEntry, type PlanPhase, type PlanSection, type TaskDevInfo } from '@dev-assistant/shared';

export function parsePlan(markdown: string, updatedAt: string): DevPlan | null {
  const sections: PlanSection[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1]!;
      sections.push({ title, phase: title.split(/\s+·\s+/)[0]!.trim(), steps: [] });
      continue;
    }
    const step = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (step && sections.length) sections.at(-1)!.steps.push({ text: step[2]!, done: step[1] !== ' ' });
  }
  return buildPlan(sections, updatedAt);
}

/** Fases y contadores a partir de las secciones con sus pasos. */
export function buildPlan(sections: PlanSection[], updatedAt: string): DevPlan | null {
  const withSteps = sections.filter((s) => s.steps.length);
  if (!withSteps.length) return null;

  // Fases conocidas en su orden; cualquier otra se añade detrás en el orden en que aparece.
  const names = [...new Set([...PLAN_PHASES.filter((p) => sections.some((s) => s.phase === p)), ...sections.map((s) => s.phase)])];
  const phases: PlanPhase[] = names.map((name) => {
    const steps = sections.filter((s) => s.phase === name).flatMap((s) => s.steps);
    return { name, done: steps.filter((s) => s.done).length, total: steps.length };
  });
  const all = withSteps.flatMap((s) => s.steps);
  return {
    sections: withSteps,
    phases,
    currentPhase: phases.find((p) => p.done < p.total)?.name ?? null,
    done: all.filter((s) => s.done).length,
    total: all.length,
    updatedAt,
  };
}

/** Estado de la tarea fuera de PLAN.md: sus PR en la app y el estado en JIRA. */
export interface TaskOutside {
  prs: { state: 'open' | 'merged' | 'closed'; isDraft: boolean }[];
  jiraStatus: string | null;
  jiraDone: boolean;
}

const READY_STEP = /ready for review/i;
const IN_REVIEW = /review|revisi[oó]n|revisar/i;

/**
 * El último paso del plan («PR en "ready for review" y JIRA en "In Review"») se marca solo cuando se cumple
 * aunque el cambio lo haya hecho el usuario a mano y no opencode: ninguna PR sigue en borrador y JIRA está en revisión o más allá.
 */
export function withReadyStepDone(plan: DevPlan | null, outside: TaskOutside): DevPlan | null {
  if (!plan) return plan;
  const live = outside.prs.filter((p) => p.state !== 'closed');
  const prsReady = live.length > 0 && live.every((p) => p.state === 'merged' || !p.isDraft);
  const jiraReady = outside.jiraDone || (!!outside.jiraStatus && IN_REVIEW.test(outside.jiraStatus));
  if (!prsReady || !jiraReady) return plan;
  let changed = false;
  const sections = plan.sections.map((sec) => ({
    ...sec,
    steps: sec.steps.map((st) => {
      if (st.done || !READY_STEP.test(st.text)) return st;
      changed = true;
      return { ...st, done: true };
    }),
  }));
  return changed ? buildPlan(sections, plan.updatedAt) : plan;
}

export interface PlanHeader {
  /** «Tipo: análisis» en la cabecera: la tarea es solo el análisis de una incidencia. */
  analysis: boolean;
  branch: string | null;
  repos: string[];
  prUrls: string[];
}

/** Cabecera de PLAN.md (antes de la primera sección): "Rama: ...", "Repos: a, b" y una línea "PR: <url>" por PR. */
export function parsePlanHeader(markdown: string): PlanHeader {
  const header: PlanHeader = { analysis: false, branch: null, repos: [], prUrls: [] };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) break;
    const m = line.match(/^\s*(?:[-*]\s+)?\**(Rama|Repos|PR|Tipo)\**:\**\s*(.+?)\s*$/i);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.replace(/`/g, '');
    if (field === 'tipo') header.analysis = /^(an[aá]lisis|analysis)\b/i.test(value);
    else if (field === 'rama') header.branch = value.split(/\s/)[0]!;
    else if (field === 'pr') header.prUrls.push(...(value.match(/https?:\/\/\S+/g) ?? []));
    // "orders-api (C:\dev\orders-api, base develop), web": se queda solo con los nombres.
    else header.repos.push(...value.replace(/\([^)]*\)/g, '').split(',').map((r) => r.trim()).filter(Boolean));
  }
  return header;
}

/** Líneas "- fecha | repo | hash | url | explicación"; las que no encajan se ignoran. */
const ANALYSIS_LINE = /^(an[aá]lisis|analysis)$/i;

export function parseHistory(markdown: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    const parts = m[1]!.split(/\s+\|\s+/);
    if (parts.length < 5) continue;
    const [date, repo, sha, url, ...rest] = parts.map((p) => p.trim());
    // El análisis de una incidencia va como "| análisis | - | - |": no tiene repo ni commit.
    const kind = ANALYSIS_LINE.test(repo!) ? 'analysis' : 'commit';
    entries.push({ kind, date: date!, repo: repo!, sha: sha!, url: url && /^https?:\/\//.test(url) ? url : null, text: rest.join(' | ') });
  }
  return entries.reverse();
}

async function readIfExists(path: string): Promise<{ text: string; mtime: string } | null> {
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, mtime: info.mtime.toISOString() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** `key` llega validado como clave de JIRA, así que no puede salirse de la carpeta. */
export async function readTaskDevInfo(devAssistantHome: string, key: string): Promise<TaskDevInfo> {
  const folder = join(devAssistantHome, 'worktrees', key);
  const [plan, history] = await Promise.all([readIfExists(join(folder, 'PLAN.md')), readIfExists(join(folder, 'HISTORIAL.md'))]);
  return {
    plan: plan ? parsePlan(plan.text, plan.mtime) : null,
    history: history ? parseHistory(history.text) : [],
    folder,
  };
}
