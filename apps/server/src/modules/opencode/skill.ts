// Skill de opencode "dev-assistant-tarea": vive en este repo y la app la copia a la carpeta global de
// skills de opencode con el botón de Ajustes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { OpencodeSkillStatus } from '@dev-assistant/shared';

export const SKILL_NAME = 'dev-assistant-tarea';
const SOURCE = fileURLToPath(new URL(`../../../../../opencode/skills/${SKILL_NAME}/SKILL.md`, import.meta.url));

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Ruta absoluta del SKILL.md instalado en la carpeta global de skills de opencode. */
export const skillPath = (skillsDir: string) => join(skillsDir, SKILL_NAME, 'SKILL.md');

const normalize = (text: string) => text.replace(/\r\n/g, '\n');

export async function skillStatus(skillsDir: string): Promise<OpencodeSkillStatus> {
  const path = skillPath(skillsDir);
  const [installed, source] = await Promise.all([read(path), readFile(SOURCE, 'utf8')]);
  return { installed: installed !== null, upToDate: installed !== null && normalize(installed) === normalize(source), path };
}

export async function installSkill(skillsDir: string): Promise<OpencodeSkillStatus> {
  const path = skillPath(skillsDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await readFile(SOURCE, 'utf8'));
  return skillStatus(skillsDir);
}

export async function opencodeSkillRoutes(app: FastifyInstance, { skillsDir }: { skillsDir: string }) {
  app.get('/api/opencode/skill', async () => skillStatus(skillsDir));
  app.post('/api/opencode/skill/install', async () => installSkill(skillsDir));
}
