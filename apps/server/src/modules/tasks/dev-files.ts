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

export interface PlanHeader {
  branch: string | null;
  repos: string[];
  prUrls: string[];
}

/** Cabecera de PLAN.md (antes de la primera sección): "Rama: ...", "Repos: a, b" y una línea "PR: <url>" por PR. */
export function parsePlanHeader(markdown: string): PlanHeader {
  const header: PlanHeader = { branch: null, repos: [], prUrls: [] };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) break;
    const m = line.match(/^\s*(?:[-*]\s+)?\**(Rama|Repos|PR)\**:\**\s*(.+?)\s*$/i);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.replace(/`/g, '');
    if (field === 'rama') header.branch = value.split(/\s/)[0]!;
    else if (field === 'pr') header.prUrls.push(...(value.match(/https?:\/\/\S+/g) ?? []));
    // "orders-api (C:\dev\orders-api, base develop), web": se queda solo con los nombres.
    else header.repos.push(...value.replace(/\([^)]*\)/g, '').split(',').map((r) => r.trim()).filter(Boolean));
  }
  return header;
}

/** Líneas "- fecha | repo | hash | url | explicación"; las que no encajan se ignoran. */
export function parseHistory(markdown: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    const parts = m[1]!.split(/\s+\|\s+/);
    if (parts.length < 5) continue;
    const [date, repo, sha, url, ...rest] = parts.map((p) => p.trim());
    entries.push({ date: date!, repo: repo!, sha: sha!, url: url && /^https?:\/\//.test(url) ? url : null, text: rest.join(' | ') });
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
