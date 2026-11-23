// Documentos de la carpeta de una tarea (~/.dev-assistant/worktrees/<CLAVE>/): los .md y .txt que
// escribe opencode (TAREA, PLAN, HISTORIAL, RESUMEN, análisis...). Solo lectura y solo el primer nivel:
// dentro de la carpeta también pueden estar los repos de trabajo, que no son documentos.
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskFile, TaskFileDetail } from '@dev-assistant/shared';

const NAME_RE = /^[\p{L}\p{N}_. -]+\.(md|txt)$/iu;
const MAX_BYTES = 1024 * 1024;

/** Nombres que escribe la skill, primero y en este orden; el resto, por fecha de modificación. */
const KNOWN_ORDER = ['RESUMEN.md', 'PLAN.md', 'HISTORIAL.md', 'TAREA.md'];

export const isFileName = (name: string) => NAME_RE.test(name) && !name.includes('..');

export async function listTaskFiles(home: string, key: string): Promise<TaskFile[]> {
  const folder = join(home, 'worktrees', key);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const files: TaskFile[] = [];
  for (const name of names.filter(isFileName)) {
    const info = await lstat(join(folder, name)).catch(() => null);
    if (info?.isFile()) files.push({ name, size: info.size, updatedAt: info.mtime.toISOString() });
  }
  const rank = (n: string) => (KNOWN_ORDER.includes(n) ? KNOWN_ORDER.indexOf(n) : KNOWN_ORDER.length);
  return files.sort((a, b) => rank(a.name) - rank(b.name) || b.updatedAt.localeCompare(a.updatedAt));
}

/** `key` llega validado como clave de JIRA y `name` se comprueba aquí: no pueden salirse de la carpeta. */
export async function readTaskFile(home: string, key: string, name: string): Promise<TaskFileDetail | null> {
  if (!isFileName(name)) return null;
  const path = join(home, 'worktrees', key, name);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const truncated = info.size > MAX_BYTES;
  const buffer = await readFile(path);
  return { name, size: info.size, updatedAt: info.mtime.toISOString(), truncated, text: buffer.subarray(0, MAX_BYTES).toString('utf8') };
}
