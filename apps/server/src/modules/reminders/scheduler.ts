import type { FastifyBaseLogger } from 'fastify';
import type { FiredReminder, RemindersRepository } from './repository.js';

export type SystemNotifier = (fired: FiredReminder) => Promise<void> | void;

const INTERVAL_MS = 30_000;

/**
 * Revisa cada 30 s los recordatorios vencidos (y al arrancar, los que vencieron con el ordenador
 * apagado). Cada aviso queda en `reminder_fires` para la app y se manda al notificador del sistema.
 */
export function startReminderScheduler(repo: RemindersRepository, notify: SystemNotifier, log: FastifyBaseLogger) {
  const tick = () => {
    try {
      for (const fired of repo.fireDue()) {
        Promise.resolve(notify(fired)).catch((err: unknown) => log.warn({ err }, 'No se pudo mostrar la notificación del sistema'));
      }
    } catch (err) {
      log.error({ err }, 'Error al revisar recordatorios');
    }
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
