// "Importar de JIRA": trae a la app una tarea que no está asignada al usuario, por su ID o por su enlace.
import type { TaskImportPreview } from '@dev-assistant/shared';
import type { JiraClient, JiraIssue } from '../../integrations/jira/client.js';
import { t } from '../../i18n/index.js';
import type { TasksRepository } from './repository.js';

/** Error que se enseña tal cual al usuario. */
export class TaskImportError extends Error {}

const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** La clave de una tarea a partir de su ID o de un enlace de JIRA (/browse/KEY, ?selectedIssue=KEY...). */
export function parseJiraRef(ref: string): string | null {
  const text = ref.trim();
  if (KEY.test(text)) return text.toUpperCase();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const fromQuery = ['selectedIssue', 'issueKey', 'issue'].map((k) => url.searchParams.get(k)).find((v) => v && KEY.test(v));
  const fromPath = decodeURIComponent(url.pathname)
    .split('/')
    .find((part) => KEY.test(part));
  const key = fromQuery ?? fromPath;
  return key ? key.toUpperCase() : null;
}

export class TaskImportService {
  constructor(
    private readonly repo: TasksRepository,
    private readonly client: JiraClient | null,
  ) {}

  private async fetch(ref: string): Promise<JiraIssue> {
    if (!this.client) throw new TaskImportError(t('tasks.importNotConfigured'));
    const key = parseJiraRef(ref);
    if (!key) throw new TaskImportError(t('tasks.importBadRef', { ref: ref.trim().slice(0, 80) }));
    const issue = await this.client.getIssue(key);
    if (!issue) throw new TaskImportError(t('tasks.importNotFound', { key }));
    return issue;
  }

  async preview(ref: string): Promise<TaskImportPreview> {
    const issue = await this.fetch(ref);
    const existing = this.repo.get(issue.key);
    return {
      key: issue.key,
      summary: issue.summary,
      issueType: issue.issueType,
      status: issue.status,
      assignee: issue.assignee ?? null,
      project: issue.project,
      // Una clave que solo estaba escrita en una nota aún no cuenta como tarea de la app.
      inApp: !!existing && existing.synced,
    };
  }

  /** Guarda la tarea como importada; si ya estaba en la app, no toca nada. */
  async import(ref: string) {
    const issue = await this.fetch(ref);
    const existing = this.repo.get(issue.key);
    if (!existing || !existing.synced) this.repo.upsertFromJira([issue], new Date().toISOString(), new Set([issue.key]));
    return this.repo.get(issue.key)!;
  }
}
