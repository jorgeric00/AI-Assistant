import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NOTE_KINDS, NoteInput, NoteListQuery, NoteUpdate, type LinkTitleResponse } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { t } from '../../i18n/index.js';
import { fetchLinkTitle } from './link-title.js';
import { NotesRepository } from './repository.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const LinkTitleQuery = z.object({ url: z.httpUrl() });

export interface NotesRoutesOptions {
  db: Db;
  fetchTitle?: (url: string) => Promise<string | null>;
}

/** Notas y enlaces (R6, R8) y búsqueda por texto (R18). */
export async function notesRoutes(app: FastifyInstance, { db, fetchTitle = fetchLinkTitle }: NotesRoutesOptions) {
  const repo = new NotesRepository(db);

  app.get('/api/notes', async (req) => repo.list(NoteListQuery.parse(req.query)));

  app.get('/api/notes/:id', async (req, reply) => {
    const note = repo.get(IdParams.parse(req.params).id);
    return note ?? reply.code(404).send({ error: t('notes.notFound') });
  });

  app.post('/api/notes', async (req, reply) => reply.code(201).send(repo.create(NoteInput.parse(req.body))));

  app.patch('/api/notes/:id', async (req, reply) => {
    const note = repo.update(IdParams.parse(req.params).id, NoteUpdate.parse(req.body));
    return note ?? reply.code(404).send({ error: t('notes.notFound') });
  });

  app.delete('/api/notes/:id', async (req, reply) => {
    const deleted = repo.delete(IdParams.parse(req.params).id);
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: t('notes.notFound') });
  });

  app.get('/api/tags', async (req) => repo.tagCounts(z.object({ kind: z.enum(NOTE_KINDS).optional() }).parse(req.query).kind));

  app.get('/api/link-title', async (req): Promise<LinkTitleResponse> => ({
    title: await fetchTitle(LinkTitleQuery.parse(req.query).url),
  }));
}
