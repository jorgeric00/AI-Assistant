// Sesión de desarrollo: el usuario habla con opencode (en la app o en su terminal) y la app enseña cómo va la tarea.
// La app no toca el código: lee PLAN.md (rama, repos y PR que anota opencode) y el estado de cada
// clon con git, y al abrir opencode le deja en TAREA.md los repos dados de alta y sus fichas (R17).
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DevSession, RepoDetail, SessionOpenResult, SessionRepo, TaskDetail } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { runGit, type GitRunner } from '../repos/git.js';
import { ReposRepository } from '../repos/repository.js';
import { parsePlanHeader } from './dev-files.js';
import { language, t } from '../../i18n/index.js';
import type { TasksRepository } from './repository.js';

/** Abre una terminal con opencode en la carpeta de la tarea; false si no sabe hacerlo en este sistema. */
export type TerminalLauncher = (folder: string, key: string, prompt: string) => Promise<boolean>;

const SKILL = 'dev-assistant-tarea';

export function openPrompt(key: string): string {
  // Sin comillas ni caracteres especiales: viaja dentro de una línea de cmd.exe. La skill y TAREA.md van en
  // castellano; en otro idioma se pide además que opencode conteste en él.
  const base = `Desarrolla la tarea ${key} con la skill ${SKILL}. Lee primero TAREA.md`;
  return language() === 'es' ? base : `${base}. ${t('ai.answerLanguage')}`;
}

export function openCommand(folder: string, key: string): string {
  return `cd "${folder}"; opencode --prompt "${openPrompt(key)}"`;
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
  ) {
    this.repos = new ReposRepository(db);
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
    return { folder, branch: header.branch, reposConfirmed: header.repos.length > 0, repos, command: openCommand(folder, key), canOpen: process.platform === 'win32' };
  }

  /** Crea la carpeta de la tarea y deja TAREA.md al día (el contexto que lee opencode al empezar). */
  async prepare(key: string): Promise<string> {
    const folder = this.folder(key);
    await mkdir(folder, { recursive: true });
    const candidates = this.candidates(key);
    const others = this.repos.list().filter((r) => !candidates.some((c) => c.id === r.id));
    const details = (list: typeof candidates) => list.map((r) => this.repos.get(r.id)).filter((r): r is Omit<RepoDetail, 'pathOk'> => !!r);
    await writeFile(join(folder, 'TAREA.md'), taskContext(key, this.tasks.get(key), details(candidates), details(others)), 'utf8');
    return folder;
  }

  /** Deja TAREA.md al día y abre opencode en la carpeta de la tarea. */
  async open(key: string): Promise<SessionOpenResult> {
    const folder = await this.prepare(key);
    const opened = await this.launcher(folder, key, openPrompt(key));
    return { opened, command: openCommand(folder, key) };
  }
}

function repoLine(r: Omit<RepoDetail, 'pathOk'>) {
  return `- **${r.name}**: \`${r.localPath}\` · rama base \`${r.defaultBranch}\`${r.github ? ` · GitHub \`${r.github}\`` : ''}`;
}

/** Contexto que la app le da a opencode al abrir la sesión (lo regenera cada vez). */
export function taskContext(key: string, task: TaskDetail | null, candidates: Omit<RepoDetail, 'pathOk'>[], others: Omit<RepoDetail, 'pathOk'>[]): string {
  const parts = [
    `# ${key}${task ? ` · ${task.summary}` : ''}`,
    'Fichero generado por AI-Assistant al abrir la sesión. No lo edites: se reescribe cada vez.',
    task?.url ? `Ticket: ${task.url}` : '',
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
    `Sigue la skill ${SKILL}. En la cabecera de PLAN.md escribe la línea "Repos:" con los nombres de esta lista, separados por comas, y añade una línea "PR: <url>" por cada PR que crees: la app las lee para enseñar el estado de la sesión.`,
  );
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}
