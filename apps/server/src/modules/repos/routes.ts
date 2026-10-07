import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RepoInput, RepoInspectInput, RepoUpdate, type RepoDetail } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import type { Llm } from '../../integrations/opencode/llm.js';
import { t } from '../../i18n/index.js';
import { inspectRepo, runGit, type GitRunner } from './git.js';
import { draftRepoProfile } from './profile-draft.js';
import { RepoConflictError, ReposRepository } from './repository.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export interface ReposRoutesOptions {
  db: Db;
  llm: Llm;
  git?: GitRunner;
}

/** Repositorios y su ficha (R17): dónde trabaja opencode y qué debe saber de cada repo. */
export async function reposRoutes(app: FastifyInstance, { db, llm, git = runGit }: ReposRoutesOptions) {
  const repo = new ReposRepository(db);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: t('repos.notFound') });
  const conflict = (reply: FastifyReply) => (err: unknown) => {
    if (err instanceof RepoConflictError) return reply.code(409).send({ error: err.message });
    throw err;
  };

  const detail = async (id: number): Promise<RepoDetail | null> => {
    const found = repo.get(id);
    if (!found) return null;
    return { ...found, pathOk: (await inspectRepo(found.localPath, git)).isGitRepo };
  };

  app.get('/api/repos', async () => repo.list());

  app.get('/api/repos/:id', async (req, reply) => (await detail(IdParams.parse(req.params).id)) ?? notFound(reply));

  // Lo que se deduce de una carpeta (¿es repo git?, GitHub, rama base) para rellenar el alta.
  app.post('/api/repos/inspect', async (req) => inspectRepo(RepoInspectInput.parse(req.body).localPath, git));

  app.post('/api/repos', async (req, reply) => {
    const input = RepoInput.parse(req.body);
    if (!(await inspectRepo(input.localPath, git)).isGitRepo) {
      return reply.code(400).send({ error: t('repos.notGitRepo', { path: input.localPath }) });
    }
    try {
      return reply.code(201).send(await detail(repo.create(input)));
    } catch (err) {
      return conflict(reply)(err);
    }
  });

  app.patch('/api/repos/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    try {
      return repo.update(id, RepoUpdate.parse(req.body)) ? await detail(id) : notFound(reply);
    } catch (err) {
      return conflict(reply)(err);
    }
  });

  app.delete('/api/repos/:id', async (req, reply) => {
    try {
      return repo.delete(IdParams.parse(req.params).id) ? reply.code(204).send() : notFound(reply);
    } catch (err) {
      return conflict(reply)(err);
    }
  });

  // La IA redacta la ficha leyendo el repo; queda guardada como borrador "por revisar".
  app.post('/api/repos/:id/profile/draft', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const found = repo.get(id);
    if (!found) return notFound(reply);
    if (!(await inspectRepo(found.localPath, git)).isGitRepo) {
      return reply.code(400).send({ error: t('repos.pathMissing', { path: found.localPath }) });
    }
    repo.saveProfile(id, await draftRepoProfile(llm, found), true);
    return detail(id);
  });
}
