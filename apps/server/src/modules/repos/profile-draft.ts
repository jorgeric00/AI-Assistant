// "Rellenar con IA": opencode redacta la ficha del repositorio (R17) leyendo lo que describe el
// proyecto (README, configuración de build y de tests, CI). Solo se leen ficheros de texto conocidos
// y con tope de tamaño; el modelo no tiene herramientas, así que no toca nada del repo.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoProfileInput } from '@dev-assistant/shared';
import type { Llm } from '../../integrations/opencode/llm.js';
import { t } from '../../i18n/index.js';

/** Ficheros que se mandan a la IA si existen (en este orden), con su tope de caracteres. */
const KEY_FILES: [string, number][] = [
  ['README.md', 6000],
  ['README', 6000],
  ['CONTRIBUTING.md', 3000],
  ['AGENTS.md', 3000],
  ['CLAUDE.md', 3000],
  ['package.json', 3000],
  ['pnpm-workspace.yaml', 500],
  ['pom.xml', 4000],
  ['build.gradle', 3000],
  ['build.gradle.kts', 3000],
  ['settings.gradle', 1000],
  ['Makefile', 2000],
  ['pyproject.toml', 2000],
  ['go.mod', 1000],
  ['docker-compose.yml', 1500],
  ['.editorconfig', 800],
];
const WORKFLOWS_DIR = '.github/workflows';
const MAX_WORKFLOWS = 3;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'build', 'dist', 'out', '.idea', '.vscode', '.gradle', 'coverage', 'vendor', '__pycache__']);

const system = () => `Eres un desarrollador sénior que documenta un repositorio para que otro agente de IA (opencode) trabaje en él siguiendo sus normas.
${t('ai.answerLanguage')} En Markdown, con exactamente estas tres secciones y en este orden:
## ${t('ai.repoProfile.conventions')}
## ${t('ai.repoProfile.tests')}
## ${t('ai.repoProfile.architecture')}
Reglas:
- Usa solo lo que se deduce de los ficheros que te doy. Si algo no se puede saber, escribe "- ${t('ai.repoProfile.noData')}: [qué falta]" en vez de inventarlo.
- ${t('ai.repoProfile.conventions')}: lenguaje y versión, estilo, nombres, estructura de paquetes, formato de commits o ramas si aparece, linters y formateadores.
- ${t('ai.repoProfile.tests')}: los comandos exactos para compilar, ejecutar los tests unitarios y los de integración, y qué necesitan (Docker, base de datos...). Un comando por viñeta, en \`código\`.
- ${t('ai.repoProfile.architecture')}: para qué sirve el repo, sus carpetas principales y qué contiene cada una, y con qué se integra.
- Viñetas cortas. Máximo 12 por sección.
- No añadas nada antes ni después de las tres secciones.`;

async function readCapped(path: string, max: number): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    const text = await readFile(path, 'utf8');
    return text.length > max ? `${text.slice(0, max)}\n[…recortado]` : text;
  } catch {
    return null;
  }
}

/** Árbol de carpetas de dos niveles, sin dependencias ni salidas de build. */
async function tree(root: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number) => {
    let entries;
    try {
      entries = (await readdir(join(root, dir), { withFileTypes: true })).filter((e) => !SKIP_DIRS.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries.slice(0, 40)) {
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) await walk(join(dir, e.name), `${prefix}  `, depth + 1);
    }
  };
  await walk('', '', 1);
  return lines.slice(0, 200).join('\n');
}

export async function collectRepoContext(localPath: string): Promise<string> {
  const parts: string[] = [`Estructura de carpetas:\n${await tree(localPath)}`];
  for (const [file, max] of KEY_FILES) {
    const text = await readCapped(join(localPath, file), max);
    if (text?.trim()) parts.push(`--- ${file} ---\n${text}`);
  }
  try {
    const workflows = (await readdir(join(localPath, WORKFLOWS_DIR))).filter((f) => /\.ya?ml$/.test(f)).sort().slice(0, MAX_WORKFLOWS);
    for (const wf of workflows) {
      const text = await readCapped(join(localPath, WORKFLOWS_DIR, wf), 2000);
      if (text) parts.push(`--- ${WORKFLOWS_DIR}/${wf} ---\n${text}`);
    }
  } catch {
    // Sin CI de GitHub Actions.
  }
  return parts.join('\n\n');
}

/** Separa la respuesta en las tres partes de la ficha (lo que no venga queda vacío). Admite los títulos en castellano y en inglés. */
export function parseProfile(markdown: string): RepoProfileInput {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s*(.+?)\s*$/);
    if (heading) {
      const title = heading[1]!.toLowerCase();
      current = title.startsWith('conven') ? 'conv' : title.startsWith('test') ? 'tests' : /^(arquitec|architec)/.test(title) ? 'arq' : null;
      continue;
    }
    if (current) sections[current] = `${sections[current] ?? ''}${line}\n`;
  }
  return {
    conventionsMd: (sections.conv ?? '').trim(),
    testCommandsMd: (sections.tests ?? '').trim(),
    architectureMd: (sections.arq ?? '').trim(),
  };
}

export async function draftRepoProfile(llm: Llm, repo: { name: string; localPath: string }): Promise<RepoProfileInput> {
  const context = await collectRepoContext(repo.localPath);
  const answer = await llm.complete({ system: system(), user: `Repositorio: ${repo.name}\n\n${context}`, title: `Ficha del repo ${repo.name}` });
  return parseProfile(answer);
}
