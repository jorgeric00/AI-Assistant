// Archivos adjuntos del chat con opencode: se guardan en la carpeta del chat (dentro de la carpeta donde
// trabaja opencode, para que los lea sin pedir permiso) y el mensaje lleva sus rutas.
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChatFile } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';

const SUBFOLDER = 'adjuntos';

/** Solo el nombre, sin rutas ni caracteres raros. */
export function safeFileName(name: string): string {
  const clean = basename(name.replace(/\\/g, '/')).replace(/[^\p{L}\p{N}_. -]/gu, '_').replace(/^\.+/, '').trim();
  return clean.slice(-100) || 'archivo';
}

/** Guarda los archivos en `<carpeta>/adjuntos/` y devuelve sus rutas relativas a la carpeta. */
export async function saveAttachments(folder: string, files: ChatFile[] | undefined): Promise<string[]> {
  if (!files?.length) return [];
  const dir = join(folder, SUBFOLDER);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    const name = `${stamp}-${i + 1}-${safeFileName(file.name)}`;
    await writeFile(join(dir, name), Buffer.from(file.data, 'base64'));
    paths.push(`${SUBFOLDER}/${name}`);
  }
  return paths;
}

/** El texto del usuario seguido de la lista de archivos adjuntos. */
export function withAttachments(text: string, paths: string[]): string {
  return paths.length ? `${text}\n\n${t('chat.attachments.intro')}\n${paths.map((p) => `- ${p}`).join('\n')}` : text;
}
