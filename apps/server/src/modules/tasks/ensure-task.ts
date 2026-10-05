import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { tasks } from '../../db/schema.js';

/** Estado con el que se crea una tarea escrita a mano hasta que la sincronización de JIRA la complete. */
export const UNSYNCED_TASK_STATUS = 'sin_sincronizar';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Id de la tarea con esa clave; si aún no existe (JIRA sin sincronizar) la crea solo con su clave. */
export function ensureTaskId(db: Db | Tx, jiraKey: string): number {
  db.insert(tasks).values({ jiraKey, summary: jiraKey, status: UNSYNCED_TASK_STATUS }).onConflictDoNothing().run();
  return db.select({ id: tasks.id }).from(tasks).where(eq(tasks.jiraKey, jiraKey)).get()!.id;
}
