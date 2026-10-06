// Documentación de tareas: el RESUMEN.md que escribe opencode al cerrar cada tarea (skill
// "dev-assistant-tarea") en ~/.dev-assistant/worktrees/<CLAVE>/. La app solo lo lee.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskDoc, TaskDocDetail } from '@dev-assistant/shared';

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Sin tildes y en minúsculas, para buscar como en las notas. */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function parseTaskDoc(key: string, markdown: string, updatedAt: string): TaskDocDetail {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m)?.[1] ?? key;
  const title = heading.replace(new RegExp(`^${key}\\s*[·:\\-–—]?\\s*`), '').trim() || key;
  const reposLine = markdown.match(/Repos:\s*([^\n·]+)/)?.[1] ?? '';
  const repos = reposLine.replace(/`/g, '').split(',').map((r) => r.trim()).filter(Boolean);
  const prCount = new Set(markdown.match(/https?:\/\/\S+?\/pull\/\d+/g) ?? []).size;
  return { key, title, repos, prCount, updatedAt, markdown };
}

async function readDoc(home: string, key: string): Promise<TaskDocDetail | null> {
  const path = join(home, 'worktrees', key, 'RESUMEN.md');
  try {
    const [markdown, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return parseTaskDoc(key, markdown, info.mtime.toISOString());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Resúmenes de todas las tareas, del más reciente al más antiguo; con `q`, los que contienen todas las palabras. */
export async function listTaskDocs(home: string, q?: string): Promise<TaskDoc[]> {
  let keys: string[];
  try {
    keys = (await readdir(join(home, 'worktrees'))).filter((k) => KEY_RE.test(k));
  } catch {
    return [];
  }
  const words = q ? fold(q).split(/\s+/).filter(Boolean) : [];
  const docs = (await Promise.all(keys.map((k) => readDoc(home, k)))).filter((d): d is TaskDocDetail => !!d);
  return docs
    .filter((d) => words.every((w) => fold(`${d.key} ${d.markdown}`).includes(w)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ markdown: _markdown, ...doc }) => doc);
}

/** `key` llega validado como clave de JIRA, así que no puede salirse de la carpeta. */
export const getTaskDoc = readDoc;
