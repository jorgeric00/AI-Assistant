// Sesión de desarrollo: el usuario habla con opencode (en la app o en su terminal) y la app enseña cómo va la tarea.
// La app no toca el código: lee PLAN.md (rama, repos y PR que anota opencode) y el estado de cada
// clon con git, y al abrir opencode le deja en TAREA.md los repos dados de alta y sus fichas (R17).
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DevSession, RepoDetail, SessionOpenResult, SessionRepo, TaskDetail } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import type { JiraClient, JiraTicketExtras } from '../../integrations/jira/client.js';
import { runGit, type GitRunner } from '../repos/git.js';
import { ReposRepository } from '../repos/repository.js';
import { parsePlanHeader } from './dev-files.js';
import { language, t } from '../../i18n/index.js';
import type { TasksRepository } from './repository.js';
import { SKILL_NAME, installSkill, skillPath, skillStatus } from '../opencode/skill.js';

/** Abre una terminal con opencode en la carpeta de la tarea; false si no sabe hacerlo en este sistema. */
export type TerminalLauncher = (folder: string, key: string, prompt: string) => Promise<boolean>;


/** Cómo se empieza la tarea: el flujo de desarrollo de siempre o solo el análisis de una incidencia. */
export type TaskMode = 'development' | 'analysis';

export function openPrompt(key: string, skillPath: string, mode: TaskMode = 'development'): string {
  // Sin comillas ni caracteres especiales: viaja dentro de una línea de cmd.exe. La skill y TAREA.md van en
  // castellano; en otro idioma se pide además que opencode conteste en él. Se da la ruta de la skill por si
  // opencode no la encuentra entre las suyas.
  const base =
    mode === 'analysis'
      ? `Analiza la incidencia ${key} con la skill ${SKILL_NAME}, que está en ${skillPath}, siguiendo su flujo de solo análisis. Lee primero TAREA.md`
      : `Desarrolla la tarea ${key} con la skill ${SKILL_NAME}, que está en ${skillPath}. Lee primero TAREA.md`;
  return language() === 'es' ? base : `${base}. ${t('ai.answerLanguage')}`;
}

export function openCommand(folder: string, prompt: string): string {
  return `cd "${folder}"; opencode --prompt "${prompt}"`;
}

/** En Windows, una ventana nueva de la terminal por defecto con opencode ya en marcha. */
export const windowsLauncher: TerminalLauncher = async (folder, key, prompt) => {
  if (process.platform !== 'win32') return false;
  const line = `start "AI-Assistant ${key}" /D "${folder}" cmd /k opencode --prompt "${prompt}"`;
  await new Promise<void>((done, fail) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', fail);
    child.once('spawn', () => {
      child.unref();
      done();
    });
  });
  return true;
};

/** owner/repo de una URL de PR de GitHub, en minúsculas. */
function prRepo(url: string): string | null {
  const m = url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/i);
  return m ? m[1]!.toLowerCase() : null;
}

async function readPlan(folder: string): Promise<string> {
  try {
    return await readFile(join(folder, 'PLAN.md'), 'utf8');
  } catch {
    return '';
  }
}

export class DevSessionService {
  private readonly repos: ReposRepository;

  constructor(
    db: Db,
    private readonly tasks: TasksRepository,
    private readonly devAssistantHome: string,
    private readonly git: GitRunner = runGit,
    private readonly launcher: TerminalLauncher = windowsLauncher,
    private readonly skillsDir: string | null = null,
    private readonly jira: JiraClient | null = null,
  ) {
    this.repos = new ReposRepository(db);
  }

  /** Lo que se le dice a opencode al empezar: la tarea, la ruta de la skill y que lea TAREA.md. */
  prompt(key: string, mode: TaskMode = 'development'): string {
    return openPrompt(key, this.skillsDir ? skillPath(this.skillsDir) : SKILL_NAME, mode);
  }

  /** Si la tarea parece una incidencia (por su tipo en JIRA), se propone empezar por el análisis. */
  suggestsAnalysis(key: string): boolean {
    return INCIDENT_TYPE.test(this.tasks.get(key)?.issueType ?? '');
  }

  private extrasCache = new Map<string, { at: number; value: TicketFiles }>();

  /**
   * Comentarios del ticket y adjuntos descargados en <carpeta>/adjuntos: lo que suele hacer falta para analizar
   * una incidencia, sin depender del MCP de JIRA. Se piden a JIRA como mucho una vez por minuto y tarea.
   */
  private async ticketFiles(key: string, folder: string): Promise<TicketFiles> {
    if (!this.jira) return { extras: null, error: null, saved: [] };
    const cached = this.extrasCache.get(key);
    if (cached && Date.now() - cached.at < EXTRAS_TTL_MS) return cached.value;
    let value: TicketFiles;
    try {
      const extras = await this.jira.ticketExtras(key);
      value = { extras, error: null, saved: extras ? await this.saveAttachments(extras, join(folder, ATTACHMENTS_DIR)) : [] };
    } catch (err) {
      value = { extras: null, error: err instanceof Error ? err.message : String(err), saved: [] };
    }
    this.extrasCache.set(key, { at: Date.now(), value });
    return value;
  }

  private async saveAttachments(extras: JiraTicketExtras, dir: string): Promise<SavedAttachment[]> {
    const names = new Set<string>();
    const saved: SavedAttachment[] = [];
    for (const a of extras.attachments) {
      let name = a.filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '_') || a.id;
      if (names.has(name.toLowerCase())) name = `${a.id}-${name}`;
      names.add(name.toLowerCase());
      if (a.size > MAX_ATTACHMENT_BYTES) {
        saved.push({ filename: a.filename, path: null, size: a.size, error: 'tooBig' });
        continue;
      }
      const path = join(dir, name);
      try {
        // Ya descargado (mismo tamaño): no se vuelve a pedir.
        const existing = await stat(path).catch(() => null);
        if (!existing || existing.size !== a.size) {
          await mkdir(dir, { recursive: true });
          await writeFile(path, await this.jira!.downloadAttachment(a.url));
        }
        saved.push({ filename: a.filename, path: `${ATTACHMENTS_DIR}/${name}`, size: a.size, error: null });
      } catch (err) {
        saved.push({ filename: a.filename, path: null, size: a.size, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return saved;
  }

  folder(key: string) {
    return join(this.devAssistantHome, 'worktrees', key);
  }

  /** Repos dados de alta para el proyecto de JIRA de la tarea (los que se le sugieren a opencode). */
  private candidates(key: string) {
    const project = this.tasks.get(key)?.project ?? key.split('-')[0]!;
    return this.repos.list().filter((r) => r.jiraProjectKeys.includes(project.toUpperCase()));
  }

  async get(key: string): Promise<DevSession> {
    const folder = this.folder(key);
    const header = parsePlanHeader(await readPlan(folder));
    const all = this.repos.list();
    const byName = new Map(all.map((r) => [r.name.toLowerCase(), r]));
    const names = header.repos.length ? header.repos : this.candidates(key).map((r) => r.name);
    const repos = await Promise.all(
      names.map(async (name): Promise<SessionRepo> => {
        const registered = byName.get(name.toLowerCase());
        const prUrl = header.prUrls.find((u) => registered?.github && prRepo(u) === registered.github.toLowerCase()) ?? (names.length === 1 ? (header.prUrls[0] ?? null) : null);
        if (!registered) return { name, localPath: null, defaultBranch: null, pathOk: false, currentBranch: null, dirty: false, commits: null, prUrl };
        const path = registered.localPath;
        const pathOk = (await this.git(path, ['rev-parse', '--is-inside-work-tree'])) === 'true';
        if (!pathOk) return { name: registered.name, localPath: path, defaultBranch: registered.defaultBranch, pathOk, currentBranch: null, dirty: false, commits: null, prUrl };
        const [currentBranch, status, count] = await Promise.all([
          this.git(path, ['symbolic-ref', '--short', 'HEAD']),
          this.git(path, ['status', '--porcelain']),
          header.branch ? this.git(path, ['rev-list', '--count', `${registered.defaultBranch}..${header.branch}`]) : Promise.resolve(null),
        ]);
        return {
          name: registered.name,
          localPath: path,
          defaultBranch: registered.defaultBranch,
          pathOk,
          currentBranch,
          dirty: !!status,
          commits: count !== null && /^\d+$/.test(count) ? Number(count) : null,
          prUrl,
        };
      }),
    );
    return { folder, branch: header.branch, analysis: header.analysis, reposConfirmed: header.repos.length > 0, repos, command: openCommand(folder, this.prompt(key)), canOpen: process.platform === 'win32' };
  }

  /** Crea la carpeta de la tarea y deja TAREA.md y AGENTS.md al día (el contexto que lee opencode). */
  async prepare(key: string): Promise<string> {
    const folder = this.folder(key);
    await mkdir(folder, { recursive: true });
    // La skill es de la app: si falta o está desfasada, se instala para que opencode la tenga al empezar.
    if (this.skillsDir && !(await skillStatus(this.skillsDir)).upToDate) await installSkill(this.skillsDir);
    const candidates = this.candidates(key);
    const others = this.repos.list().filter((r) => !candidates.some((c) => c.id === r.id));
    const details = (list: typeof candidates) => list.map((r) => this.repos.get(r.id)).filter((r): r is Omit<RepoDetail, 'pathOk'> => !!r);
    const task = this.tasks.get(key);
    const files = await this.ticketFiles(key, folder);
    await writeFile(join(folder, 'TAREA.md'), taskContext(key, task, details(candidates), details(others), files), 'utf8');
    // opencode lee AGENTS.md siempre que trabaja en la carpeta: así sabe de qué tarea se trata aunque no se
    // empiece con el mensaje de «Empezar la tarea» (en el chat de la app o en la terminal).
    await writeFile(join(folder, 'AGENTS.md'), taskAgents(key, task, this.skillsDir ? skillPath(this.skillsDir) : SKILL_NAME), 'utf8');
    return folder;
  }

  /** Deja TAREA.md al día y abre opencode en la carpeta de la tarea. */
  async open(key: string): Promise<SessionOpenResult> {
    const folder = await this.prepare(key);
    const opened = await this.launcher(folder, key, this.prompt(key));
    return { opened, command: openCommand(folder, this.prompt(key)) };
  }
}

function repoLine(r: Omit<RepoDetail, 'pathOk'>) {
  return `- **${r.name}**: \`${r.localPath}\` · rama base \`${r.defaultBranch}\`${r.github ? ` · GitHub \`${r.github}\`` : ''}`;
}

/** Descripción del ticket que se copia en TAREA.md como mucho (caracteres). */
const MAX_DESCRIPTION = 20_000;
/** Comentarios del ticket en TAREA.md: los más recientes, hasta este total de caracteres. */
const MAX_COMMENTS = 30_000;
const MAX_COMMENT = 6_000;
/** Adjuntos más grandes no se descargan (se enlaza el ticket). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENTS_DIR = 'adjuntos';
const EXTRAS_TTL_MS = 60_000;
const INCIDENT_TYPE = /bug|incidenc|incident|defect|error|fallo/i;

interface SavedAttachment {
  filename: string;
  /** Ruta relativa a la carpeta de la tarea; null si no se descargó. */
  path: string | null;
  size: number;
  /** 'tooBig' o el motivo del fallo. */
  error: string | null;
}

/** Lo que se pudo leer de JIRA para la carpeta de la tarea. */
export interface TicketFiles {
  extras: JiraTicketExtras | null;
  /** Por qué no se pudo leer (sin JIRA configurado, ni uno ni otro). */
  error: string | null;
  saved: SavedAttachment[];
}

const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ticketFilesSections(files: TicketFiles, ticketUrl: string | undefined): string[] {
  if (files.error) return [`## Comentarios y adjuntos del ticket\nNo se pudieron leer de JIRA (${files.error}). Pídeselos al usuario si los necesitas.`];
  if (!files.extras) return [];
  const parts: string[] = [];
  // Los más recientes primero hasta el límite, y luego en orden de fecha.
  const comments: string[] = [];
  let total = 0;
  for (const c of [...files.extras.comments].reverse()) {
    const block = `### ${c.author || '?'} · ${c.created.slice(0, 16).replace('T', ' ')}\n${clipText(c.body, MAX_COMMENT)}`;
    if (total + block.length > MAX_COMMENTS) break;
    total += block.length;
    comments.unshift(block);
  }
  if (comments.length) {
    const skipped = files.extras.comments.length - comments.length;
    parts.push(`## Comentarios del ticket${skipped ? ` (los ${comments.length} más recientes de ${files.extras.comments.length})` : ''}\n\n${comments.join('\n\n')}`);
  }
  if (files.saved.length) {
    const lines = files.saved.map((a) =>
      a.path
        ? `- \`${a.path}\` (${sizeLabel(a.size)})`
        : `- ${a.filename} (${sizeLabel(a.size)}): no descargado${a.error === 'tooBig' ? ', es demasiado grande' : ` (${a.error})`}. Está en el ticket${ticketUrl ? `: ${ticketUrl}` : ''}.`,
    );
    parts.push(`## Adjuntos del ticket\nDescargados en la carpeta de la tarea, junto a este fichero:\n${lines.join('\n')}`);
  }
  return parts;
}

/** Instrucciones que opencode carga solo al trabajar en la carpeta de la tarea. */
export function taskAgents(key: string, task: TaskDetail | null, skill: string): string {
  return `${[
    `# Tarea de JIRA ${key}${task ? ` · ${task.summary}` : ''}`,
    `Esta carpeta es la de la tarea ${key}. La prepara AI-Assistant, que reescribe este fichero y TAREA.md cada vez: no los edites.`,
    `- Antes de nada, lee TAREA.md: tiene el ticket (con su descripción y comentarios), los adjuntos descargados en adjuntos/ y los repositorios con los que trabajar.`,
    `- Trabaja siguiendo la skill ${SKILL_NAME}, que está en ${skill}. Si es una incidencia que solo hay que analizar, sigue su flujo de solo análisis.`,
    `- Idioma del usuario: ${language() === 'es' ? 'castellano' : 'inglés (English)'}. Contéstale siempre en ese idioma.`,
  ].join('\n\n')}\n`;
}

/** Contexto que la app le da a opencode al abrir la sesión (lo regenera cada vez). */
export function taskContext(
  key: string,
  task: TaskDetail | null,
  candidates: Omit<RepoDetail, 'pathOk'>[],
  others: Omit<RepoDetail, 'pathOk'>[],
  files: TicketFiles = { extras: null, error: null, saved: [] },
): string {
  const parts = [
    `# ${key}${task ? ` · ${task.summary}` : ''}`,
    'Fichero generado por AI-Assistant al abrir la sesión. No lo edites: se reescribe cada vez.',
    task?.url ? `Ticket: ${task.url}` : '',
    task?.description?.trim()
      ? `## Descripción del ticket\n${task.description.trim().length > MAX_DESCRIPTION ? `${task.description.trim().slice(0, MAX_DESCRIPTION)}…` : task.description.trim()}`
      : '',
    ...ticketFilesSections(files, task?.url ?? undefined),
    '## Repositorios dados de alta para este proyecto de JIRA',
    candidates.length ? candidates.map(repoLine).join('\n') : 'Ninguno. Propón al usuario los repos que haga falta tocar.',
  ];
  for (const r of candidates) {
    const p = r.profile;
    if (!p) continue;
    parts.push(`### Ficha de ${r.name}${p.aiDraft ? ' (borrador de la IA, sin revisar)' : ''}`);
    if (p.conventionsMd.trim()) parts.push(`#### Convenciones\n${p.conventionsMd.trim()}`);
    if (p.testCommandsMd.trim()) parts.push(`#### Tests\n${p.testCommandsMd.trim()}`);
    if (p.architectureMd.trim()) parts.push(`#### Arquitectura\n${p.architectureMd.trim()}`);
  }
  if (others.length) parts.push('## Otros repositorios dados de alta', others.map(repoLine).join('\n'));
  parts.push(
    '## Cómo trabajar',
    `Idioma del usuario: ${language() === 'es' ? 'castellano' : 'inglés (English)'}. Contéstale siempre en ese idioma.`,
    `Sigue la skill ${SKILL_NAME}. En la cabecera de PLAN.md escribe la línea "Repos:" con los nombres de esta lista, separados por comas, y añade una línea "PR: <url>" por cada PR que crees: la app las lee para enseñar el estado de la sesión.`,
  );
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}
