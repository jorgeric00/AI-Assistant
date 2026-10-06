import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IsoDate, JournalEntryInput } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import type { DiaryFeed } from './feed.js';
import { JournalRepository } from './repository.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const DateQuery = z.object({ date: IsoDate });

/** Diario de trabajo (R5): entradas manuales y automáticas por día. */
export async function journalRoutes(app: FastifyInstance, { db, diaryFeed }: { db: Db; diaryFeed: DiaryFeed }) {
  const repo = new JournalRepository(db);

  app.get('/api/journal', async (req) => {
    const { date } = DateQuery.parse(req.query);
    await diaryFeed.importCommits();
    return repo.list(date);
  });

  app.post('/api/journal', async (req, reply) => reply.code(201).send(repo.createManual(JournalEntryInput.parse(req.body))));

  app.delete('/api/journal/:id', async (req, reply) =>
    repo.deleteManual(IdParams.parse(req.params).id) ? reply.code(204).send() : reply.code(404).send({ error: 'Entrada no encontrada' }),
  );
}
