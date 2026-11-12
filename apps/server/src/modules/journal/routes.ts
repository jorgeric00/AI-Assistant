import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IsoDate, JournalEntryInput, WorklogRange, WorklogSubmit } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { t } from '../../i18n/index.js';
import type { DiaryFeed } from './feed.js';
import type { WorklogService } from './worklog.js';
import { JournalRepository } from './repository.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const DateQuery = z.object({ date: IsoDate });

/** Diario de trabajo (R5): entradas manuales y automáticas por día. */
export async function journalRoutes(app: FastifyInstance, { db, diaryFeed, worklog }: { db: Db; diaryFeed: DiaryFeed; worklog: WorklogService }) {
  const repo = new JournalRepository(db);

  app.get('/api/journal', async (req) => {
    const { date } = DateQuery.parse(req.query);
    await diaryFeed.importCommits();
    return repo.list(date);
  });

  app.get('/api/journal/worklog', async (req) => {
    const range = WorklogRange.parse(req.query);
    await diaryFeed.importCommits();
    return worklog.preview(range);
  });

  app.post('/api/journal/worklog', async (req) => worklog.submit(WorklogSubmit.parse(req.body)));

  app.post('/api/journal', async (req, reply) => reply.code(201).send(repo.createManual(JournalEntryInput.parse(req.body))));

  app.delete('/api/journal/:id', async (req, reply) =>
    repo.deleteManual(IdParams.parse(req.params).id) ? reply.code(204).send() : reply.code(404).send({ error: t('journal.entryNotFound') }),
  );
}
