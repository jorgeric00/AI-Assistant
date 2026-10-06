import { asc, eq } from 'drizzle-orm';
import type { Repo, RepoDetail, RepoProfile, RepoProfileInput, RepoProfileStatus } from '@dev-assistant/shared';
import { RepoInput, RepoUpdate } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { repoProfiles, repos } from '../../db/schema.js';

type RepoRow = typeof repos.$inferSelect;
type ProfileRow = typeof repoProfiles.$inferSelect;

/** Error de datos que se enseña tal cual (nombre repetido...). */
export class RepoConflictError extends Error {}

function profileStatus(p: ProfileRow | undefined): RepoProfileStatus {
  if (!p || ![p.conventionsMd, p.testCommandsMd, p.architectureMd].some((t) => t.trim())) return 'sin_ficha';
  return p.aiDraft ? 'por_revisar' : 'completa';
}

function toRepo(r: RepoRow, p: ProfileRow | undefined): Repo {
  return {
    id: r.id,
    name: r.name,
    localPath: r.localPath,
    github: r.githubOwner && r.githubRepo ? `${r.githubOwner}/${r.githubRepo}` : '',
    defaultBranch: r.defaultBranch,
    jiraProjectKeys: r.jiraProjectKeys,
    profileStatus: profileStatus(p),
  };
}

function splitGithub(github: string) {
  const [githubOwner = '', githubRepo = ''] = github ? github.split('/') : [];
  return { githubOwner, githubRepo };
}

export class ReposRepository {
  constructor(private readonly db: Db) {}

  list(): Repo[] {
    return this.db
      .select({ r: repos, p: repoProfiles })
      .from(repos)
      .leftJoin(repoProfiles, eq(repoProfiles.repoId, repos.id))
      .orderBy(asc(repos.name))
      .all()
      .map(({ r, p }) => toRepo(r, p ?? undefined));
  }

  get(id: number): Omit<RepoDetail, 'pathOk'> | null {
    const row = this.db.select({ r: repos, p: repoProfiles }).from(repos).leftJoin(repoProfiles, eq(repoProfiles.repoId, repos.id)).where(eq(repos.id, id)).get();
    if (!row) return null;
    const p = row.p ?? undefined;
    const profile: RepoProfile | null = p
      ? { conventionsMd: p.conventionsMd, testCommandsMd: p.testCommandsMd, architectureMd: p.architectureMd, aiDraft: p.aiDraft, updatedAt: p.updatedAt }
      : null;
    return { ...toRepo(row.r, p), profile };
  }

  private nameTaken(name: string, exceptId?: number) {
    const row = this.db.select({ id: repos.id }).from(repos).where(eq(repos.name, name)).get();
    return !!row && row.id !== exceptId;
  }

  create(input: RepoInput): number {
    const data = RepoInput.parse(input);
    if (this.nameTaken(data.name)) throw new RepoConflictError(`Ya hay un repositorio llamado ${data.name}.`);
    const row = this.db
      .insert(repos)
      .values({ name: data.name, localPath: data.localPath, ...splitGithub(data.github), defaultBranch: data.defaultBranch, jiraProjectKeys: data.jiraProjectKeys })
      .returning({ id: repos.id })
      .get();
    return row.id;
  }

  /** Cambia los datos y, si llega, la ficha (guardada por el usuario: deja de ser borrador). */
  update(id: number, input: RepoUpdate): boolean {
    const data = RepoUpdate.parse(input);
    if (!this.db.select({ id: repos.id }).from(repos).where(eq(repos.id, id)).get()) return false;
    if (data.name !== undefined && this.nameTaken(data.name, id)) throw new RepoConflictError(`Ya hay un repositorio llamado ${data.name}.`);
    this.db.transaction((tx) => {
      const { profile, github, ...rest } = data;
      const values = { ...rest, ...(github !== undefined ? splitGithub(github) : {}) };
      if (Object.keys(values).length) tx.update(repos).set(values).where(eq(repos.id, id)).run();
      if (profile) this.saveProfile(id, profile, false, tx);
    });
    return true;
  }

  saveProfile(id: number, profile: RepoProfileInput, aiDraft: boolean, db: Pick<Db, 'insert'> = this.db) {
    const values = { ...profile, aiDraft, updatedAt: new Date().toISOString() };
    db.insert(repoProfiles)
      .values({ repoId: id, ...values })
      .onConflictDoUpdate({ target: repoProfiles.repoId, set: values })
      .run();
  }

  delete(id: number): boolean {
    try {
      return !!this.db.delete(repos).where(eq(repos.id, id)).returning({ id: repos.id }).get();
    } catch (err) {
      if (err instanceof Error && /FOREIGN KEY/i.test(err.message)) {
        throw new RepoConflictError('Este repositorio se usa en sesiones de desarrollo y no se puede quitar.');
      }
      throw err;
    }
  }
}
