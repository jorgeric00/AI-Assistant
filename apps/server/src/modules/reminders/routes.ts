import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ReminderInput, ReminderUpdate, SnoozeInput } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { RemindersRepository } from './repository.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const notFound = { error: 'Recordatorio no encontrado' };

/** Recordatorios puntuales y recurrentes (R4, R12) y avisos pendientes de atender en la app. */
export async function remindersRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const repo = new RemindersRepository(db);

  app.get('/api/reminders', async () => repo.list());

  app.post('/api/reminders', async (req, reply) => reply.code(201).send(repo.create(ReminderInput.parse(req.body))));

  app.patch('/api/reminders/:id', async (req, reply) => {
    const reminder = repo.update(IdParams.parse(req.params).id, ReminderUpdate.parse(req.body));
    return reminder ?? reply.code(404).send(notFound);
  });

  app.delete('/api/reminders/:id', async (req, reply) =>
    repo.delete(IdParams.parse(req.params).id) ? reply.code(204).send() : reply.code(404).send(notFound),
  );

  app.post('/api/reminders/:id/done', async (req, reply) => repo.complete(IdParams.parse(req.params).id) ?? reply.code(404).send(notFound));

  app.post('/api/reminders/:id/snooze', async (req, reply) => {
    const reminder = repo.snooze(IdParams.parse(req.params).id, SnoozeInput.parse(req.body).until);
    return reminder ?? reply.code(404).send(notFound);
  });

  app.get('/api/reminder-alerts', async () => repo.alerts());

  app.post('/api/reminder-alerts/:id/seen', async (req, reply) =>
    repo.markAlertSeen(IdParams.parse(req.params).id) ? reply.code(204).send() : reply.code(404).send({ error: 'Aviso no encontrado' }),
  );
}
