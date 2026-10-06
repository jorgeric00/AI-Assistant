import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import type { RepoInspection } from '@dev-assistant/shared';

/** Ejecuta git en una carpeta; null si falla (no es un repo, no hay remoto...). */
export type GitRunner = (cwd: string, args: string[]) => Promise<string | null>;

export const runGit: GitRunner = (cwd, args) =>
  new Promise((done) =>
    execFile('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 10_000 }, (err, stdout) => done(err ? null : stdout.trim())),
  );

/** "https://github.com/o/r.git" o "git@github.com:o/r.git" → "o/r"; '' si no es de GitHub. */
export function githubFromRemote(url: string | null): string {
  const m = url?.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** Deduce nombre, repo de GitHub y rama base de una carpeta. */
export async function inspectRepo(localPath: string, git: GitRunner = runGit): Promise<RepoInspection> {
  const path = resolve(localPath);
  const name = basename(path);
  if ((await git(path, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return { isGitRepo: false, name, github: '', defaultBranch: null };
  }
  const github = githubFromRemote(await git(path, ['remote', 'get-url', 'origin']));
  // La rama por defecto del remoto (origin/HEAD); si no se conoce, la rama actual.
  const originHead = await git(path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const defaultBranch = originHead?.replace(/^origin\//, '') || (await git(path, ['symbolic-ref', '--short', 'HEAD'])) || null;
  return { isGitRepo: true, name: github ? github.split('/')[1]! : name, github, defaultBranch };
}
