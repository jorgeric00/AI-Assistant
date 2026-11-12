import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AskInput, DailySummaryInput, IsoDate, RewriteInput } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import type { Llm } from '../../integrations/opencode/llm.js';
import type { DiaryFeed } from '../journal/feed.js';
import { AskService } from './ask.js';
import { DailySummaryService, NothingToSummarizeError } from './daily-summary.js';
import { RewriteService } from './rewrite.js';

const DateQuery = z.object({ date: IsoDate });

/** Funciones con IA (R5 resumen para la daily, R7 búsqueda en lenguaje natural) a través de opencode. */
export async function aiRoutes(
  app: FastifyInstance,
  { db, llm, diaryFeed, devAssistantHome }: { db: Db; llm: Llm; diaryFeed: DiaryFeed; devAssistantHome: string },
) {
  const daily = new DailySummaryService(db, llm);
  const ask = new AskService(db, llm, devAssistantHome);
  const rewriter = new RewriteService(llm);

  app.get('/api/daily-summary', async (req) => daily.latest(DateQuery.parse(req.query).date));

  app.post('/api/daily-summary', async (req, reply) => {
    const { date } = DailySummaryInput.parse(req.body);
    await diaryFeed.importCommits();
    try {
      return reply.code(201).send(await daily.generate(date));
    } catch (err) {
      if (err instanceof NothingToSummarizeError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/search/ask', async (req) => {
    const { question, sources } = AskInput.parse(req.body);
    // Los commits de opencode entran en el diario antes de buscar en él.
    if (sources.includes('diary')) await diaryFeed.importCommits();
    return ask.ask(question, sources);
  });

  app.post('/api/ai/rewrite', async (req) => rewriter.rewrite(RewriteInput.parse(req.body).text));
}
