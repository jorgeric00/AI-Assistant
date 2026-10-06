// "Actualizar JIRA" (R3): comentario y cambio de estado que el usuario revisa y confirma en el diálogo.
// Los estados posibles se leen por la API REST; el envío va por el MCP de JIRA y queda registrado.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { JiraDraft, JiraTransitionOption, JiraUpdateEntry } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { changelog, journalEntries, notes, noteTasks, tasks } from '../../db/schema.js';
import { JiraError, type JiraClient } from '../../integrations/jira/client.js';
import type { JiraWriter } from '../../integrations/jira/mcp-writer.js';
import type { Llm } from '../../integrations/opencode/llm.js';
import { readTaskDevInfo } from './dev-files.js';
import type { TasksRepository } from './repository.js';

/** Error de datos que se enseña tal cual (400): tarea inexistente, nada con lo que redactar... */
export class JiraUpdateInputError extends Error {}

interface CommentPayload {
  sendId: string;
  comment: string;
}
interface TransitionPayload {
  sendId: string;
  from: string;
  to: string;
  transitionId: string;
}

/** Envíos a JIRA de una tarea, del más reciente al más antiguo (comentario y estado del mismo envío juntos). */
export function jiraUpdatesOf(db: Db, taskId: number): JiraUpdateEntry[] {
  const rows = db
    .select()
    .from(changelog)
    .where(and(eq(changelog.taskId, taskId), inArray(changelog.kind, ['jira_comment', 'jira_transition'])))
    .orderBy(desc(changelog.createdAt), desc(changelog.id))
    .all();
  const bySend = new Map<string, JiraUpdateEntry>();
  for (const row of rows) {
    const payload = (row.payloadJson ?? {}) as Partial<CommentPayload & TransitionPayload>;
    const sendId = payload.sendId ?? `row-${row.id}`;
    const entry = bySend.get(sendId) ?? { at: row.createdAt, comment: null, transition: null };
    if (row.kind === 'jira_comment') entry.comment = payload.comment ?? null;
    else entry.transition = { from: payload.from ?? '?', to: payload.to ?? '?' };
    if (row.createdAt > entry.at) entry.at = row.createdAt;
    bySend.set(sendId, entry);
  }
  return [...bySend.values()];
}

const DRAFT_SYSTEM = `Eres el asistente personal de un desarrollador. Redactas el comentario que va a publicar en una tarea de JIRA para contar cómo va.
Reglas:
- Responde solo con el texto del comentario, en español, sin saludo ni despedida y sin nada antes ni después.
- Usa solo la información que te doy. No inventes avances, PR ni fechas.
- Texto plano, sin Markdown (nada de #, ** ni bloques de código). Si haces una lista, empieza cada línea con "- ".
- Estructura sugerida: "Hecho:" con lo terminado, y si aplica "Pendiente:" o "Bloqueos:". Omite lo que no tenga contenido.
- Menciona los commits o PR solo si vienen en los datos, con su enlace.
- Breve: como mucho 10 líneas. Primera persona del plural o impersonal, tono profesional.
- Si se va a cambiar el estado, que el comentario sea coherente con el nuevo estado (p. ej. listo para revisión).
- No repitas lo que ya se contó en el último comentario enviado, salvo que haya cambiado.`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export class JiraUpdateService {
  constructor(
    private readonly db: Db,
    private readonly repo: TasksRepository,
    private readonly client: JiraClient | null,
    private readonly writer: JiraWriter | null,
    private readonly llm: Llm,
    private readonly devAssistantHome: string,
  ) {}

  writerStatus(): { writeServer: string | null; writeProblem: string | null } {
    if (!this.writer) return { writeServer: null, writeProblem: 'La escritura en JIRA no está configurada.' };
    const { server, problem } = this.writer.status();
    return { writeServer: server, writeProblem: problem };
  }

  private taskRow(key: string) {
    const row = this.db.select().from(tasks).where(eq(tasks.jiraKey, key)).get();
    if (!row) throw new JiraUpdateInputError(`La tarea ${key} no está en la app.`);
    return row;
  }

  private requireClient(): JiraClient {
    if (!this.client) throw new JiraError('JIRA no está configurado: añade JIRA_URL y JIRA_TOKEN al fichero .env.');
    return this.client;
  }

  async transitions(key: string): Promise<JiraTransitionOption[]> {
    this.taskRow(key);
    return this.requireClient().transitions(key);
  }

  /** Envía lo confirmado por el usuario: primero el comentario, después el cambio de estado. */
  async send(key: string, input: { comment?: string; transitionId?: string }): Promise<JiraUpdateEntry> {
    const task = this.taskRow(key);
    if (!this.writer) throw new JiraError('La escritura en JIRA no está configurada.');
    const problem = this.writer.status().problem;
    if (problem) throw new JiraError(problem);

    let target: JiraTransitionOption | undefined;
    if (input.transitionId) {
      target = (await this.requireClient().transitions(key)).find((t) => t.id === input.transitionId);
      if (!target) throw new JiraError(`JIRA ya no permite ese cambio de estado desde "${task.status}". Cierra el diálogo y vuelve a abrirlo.`);
    }

    const sendId = randomUUID();
    const entry: JiraUpdateEntry = { at: new Date().toISOString(), comment: null, transition: null };

    if (input.comment) {
      await this.writer.addComment(key, input.comment);
      this.db
        .insert(changelog)
        .values({ taskId: task.id, kind: 'jira_comment', title: 'Comentario en JIRA', payloadJson: { sendId, comment: input.comment } satisfies CommentPayload })
        .run();
      entry.comment = input.comment;
    }

    if (target) {
      try {
        await this.writer.transition(key, target.id);
      } catch (err) {
        if (!entry.comment) throw err;
        throw new JiraError(`Se añadió el comentario, pero no se pudo cambiar el estado: ${err instanceof Error ? err.message : String(err)}`);
      }
      const transition = { from: task.status, to: target.to };
      this.db
        .insert(changelog)
        .values({
          taskId: task.id,
          kind: 'jira_transition',
          title: `Estado ${transition.from} → ${transition.to}`,
          payloadJson: { sendId, ...transition, transitionId: target.id } satisfies TransitionPayload,
        })
        .run();
      entry.transition = transition;
    }

    // La ficha muestra enseguida el estado nuevo, sin esperar a la próxima sincronización.
    if (this.client) {
      const issue = await this.client.getIssue(key).catch(() => null);
      if (issue) this.repo.upsertFromJira([issue], new Date().toISOString());
    }
    return entry;
  }

  /** Borrador del comentario con las notas vinculadas, el diario, el plan y el histórico de opencode. */
  async draft(key: string, { targetStatus }: { targetStatus?: string }): Promise<JiraDraft> {
    const task = this.taskRow(key);
    const linked = this.db
      .select({ title: notes.title, body: notes.bodyMd, url: notes.url })
      .from(noteTasks)
      .innerJoin(notes, eq(notes.id, noteTasks.noteId))
      .where(and(eq(noteTasks.taskId, task.id), eq(notes.archived, false)))
      .orderBy(desc(notes.updatedAt))
      .limit(10)
      .all();
    const journal = this.db
      .select({ date: journalEntries.date, text: journalEntries.text })
      .from(journalEntries)
      .where(eq(journalEntries.taskId, task.id))
      .orderBy(desc(journalEntries.date), desc(journalEntries.createdAt))
      .limit(30)
      .all()
      .reverse();
    const dev = await readTaskDevInfo(this.devAssistantHome, key);
    const history = dev.history.slice(0, 20).reverse();

    if (!linked.length && !journal.length && !dev.plan && !history.length) {
      throw new JiraUpdateInputError(
        `No hay notas, entradas del diario ni cambios de opencode de ${key} con los que redactar el comentario. Escríbelo tú o apunta antes qué has hecho.`,
      );
    }

    const last = jiraUpdatesOf(this.db, task.id).find((u) => u.comment);
    const parts = [`Tarea ${key}: ${task.summary}`, `Estado actual en JIRA: ${task.status}`];
    if (targetStatus) parts.push(`Se va a cambiar el estado a: ${targetStatus}`);
    if (task.descriptionMd) parts.push(`\nDescripción en JIRA:\n${clip(task.descriptionMd, 3000)}`);
    if (linked.length) {
      parts.push(`\nNotas vinculadas:\n${linked.map((n) => `- ${n.title}${n.url ? ` (${n.url})` : ''}${n.body.trim() ? `\n  ${clip(n.body.trim(), 1500).replace(/\n/g, '\n  ')}` : ''}`).join('\n')}`);
    }
    if (journal.length) parts.push(`\nDiario:\n${journal.map((j) => `- ${j.date}: ${j.text.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
    if (dev.plan) {
      parts.push(
        `\nPlan de desarrollo (${dev.plan.done} de ${dev.plan.total} pasos; fase actual: ${dev.plan.currentPhase ?? 'terminado'}):\n${dev.plan.sections
          .map((s) => `${s.title}\n${s.steps.map((st) => `  [${st.done ? 'x' : ' '}] ${st.text}`).join('\n')}`)
          .join('\n')}`,
      );
    }
    if (history.length) parts.push(`\nCommits (histórico de opencode):\n${history.map((h) => `- ${h.date} ${h.repo}@${h.sha}${h.url ? ` ${h.url}` : ''}: ${h.text}`).join('\n')}`);
    if (last) parts.push(`\nÚltimo comentario enviado (${last.at.slice(0, 10)}):\n${clip(last.comment!, 2000)}`);

    const comment = await this.llm.complete({ system: DRAFT_SYSTEM, user: parts.join('\n'), title: `Comentario JIRA ${key}` });
    return { comment: comment.trim() };
  }
}
