import type {
  AskResponse,
  DailySummary,
  JiraDraft,
  JiraDraftInput,
  JiraSyncStatus,
  JiraTransitionOption,
  JiraUpdateEntry,
  JiraUpdateInput,
  JournalEntry,
  JournalEntryInput,
  LinkTitleResponse,
  Note,
  NoteInput,
  NoteUpdate,
  OpencodeSkillStatus,
  Reminder,
  Repo,
  RepoDetail,
  RepoInput,
  RepoInspection,
  RepoUpdate,
  ReminderAlert,
  ReminderInput,
  ReminderUpdate,
  SnoozeInput,
  TagCount,
  Task,
  TaskDetail,
  TaskDevInfo,
} from '@dev-assistant/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface NotesFilter {
  q?: string;
  tag?: string;
  archived?: boolean;
}

export const api = {
  listNotes: ({ q, tag, archived }: NotesFilter) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (archived) params.set('archived', 'true');
    return request<Note[]>('GET', `/api/notes?${params}`);
  },
  getNote: (id: number) => request<Note>('GET', `/api/notes/${id}`),
  createNote: (input: NoteInput) => request<Note>('POST', '/api/notes', input),
  updateNote: (id: number, input: NoteUpdate) => request<Note>('PATCH', `/api/notes/${id}`, input),
  deleteNote: (id: number) => request<void>('DELETE', `/api/notes/${id}`),
  listTags: () => request<TagCount[]>('GET', '/api/tags'),
  linkTitle: (url: string) => request<LinkTitleResponse>('GET', `/api/link-title?url=${encodeURIComponent(url)}`),

  listReminders: () => request<Reminder[]>('GET', '/api/reminders'),
  createReminder: (input: ReminderInput) => request<Reminder>('POST', '/api/reminders', input),
  updateReminder: (id: number, input: ReminderUpdate) => request<Reminder>('PATCH', `/api/reminders/${id}`, input),
  deleteReminder: (id: number) => request<void>('DELETE', `/api/reminders/${id}`),
  completeReminder: (id: number) => request<Reminder>('POST', `/api/reminders/${id}/done`),
  snoozeReminder: (id: number, until: SnoozeInput['until']) => request<Reminder>('POST', `/api/reminders/${id}/snooze`, { until }),
  listAlerts: () => request<ReminderAlert[]>('GET', '/api/reminder-alerts'),
  markAlertSeen: (id: number) => request<void>('POST', `/api/reminder-alerts/${id}/seen`),

  listJournal: (date: string) => request<JournalEntry[]>('GET', `/api/journal?date=${date}`),
  addJournalEntry: (input: JournalEntryInput) => request<JournalEntry>('POST', '/api/journal', input),
  deleteJournalEntry: (id: number) => request<void>('DELETE', `/api/journal/${id}`),

  getDailySummary: (date: string) => request<DailySummary | null>('GET', `/api/daily-summary?date=${date}`),
  generateDailySummary: (date: string) => request<DailySummary>('POST', '/api/daily-summary', { date }),
  ask: (question: string) => request<AskResponse>('POST', '/api/search/ask', { question }),

  listTasks: (done: boolean) => request<Task[]>('GET', `/api/tasks${done ? '?done=true' : ''}`),
  getTask: (key: string) => request<TaskDetail>('GET', `/api/tasks/${encodeURIComponent(key)}`),
  getTaskDev: (key: string) => request<TaskDevInfo>('GET', `/api/tasks/${encodeURIComponent(key)}/dev`),
  jiraStatus: () => request<JiraSyncStatus>('GET', '/api/jira/status'),
  syncJira: () => request<JiraSyncStatus>('POST', '/api/jira/sync'),
  jiraTransitions: (key: string) => request<JiraTransitionOption[]>('GET', `/api/tasks/${encodeURIComponent(key)}/transitions`),
  draftJiraComment: (key: string, input: JiraDraftInput) => request<JiraDraft>('POST', `/api/tasks/${encodeURIComponent(key)}/jira-update/draft`, input),
  updateJira: (key: string, input: JiraUpdateInput) => request<JiraUpdateEntry>('POST', `/api/tasks/${encodeURIComponent(key)}/jira-update`, input),

  listRepos: () => request<Repo[]>('GET', '/api/repos'),
  getRepo: (id: number) => request<RepoDetail>('GET', `/api/repos/${id}`),
  inspectRepo: (localPath: string) => request<RepoInspection>('POST', '/api/repos/inspect', { localPath }),
  createRepo: (input: RepoInput) => request<RepoDetail>('POST', '/api/repos', input),
  updateRepo: (id: number, input: RepoUpdate) => request<RepoDetail>('PATCH', `/api/repos/${id}`, input),
  deleteRepo: (id: number) => request<void>('DELETE', `/api/repos/${id}`),
  draftRepoProfile: (id: number) => request<RepoDetail>('POST', `/api/repos/${id}/profile/draft`),

  opencodeSkill: () => request<OpencodeSkillStatus>('GET', '/api/opencode/skill'),
  installOpencodeSkill: () => request<OpencodeSkillStatus>('POST', '/api/opencode/skill/install'),
};

/** Claves de consulta de React Query; invalidar `notes` refresca listas, notas y etiquetas. */
export const queryKeys = {
  notes: ['notes'] as const,
  noteList: (filter: NotesFilter) => ['notes', 'list', filter] as const,
  note: (id: number) => ['notes', 'one', id] as const,
  tags: ['notes', 'tags'] as const,
  /** Invalidar `reminders` refresca recordatorios y avisos. */
  reminders: ['reminders'] as const,
  reminderList: ['reminders', 'list'] as const,
  alerts: ['reminders', 'alerts'] as const,
  journal: (date: string) => ['journal', date] as const,
  dailySummary: (date: string) => ['daily-summary', date] as const,
  /** Invalidar `tasks` refresca la lista, las fichas y el estado de la sincronización. */
  tasks: ['tasks'] as const,
  taskList: (done: boolean) => ['tasks', 'list', done] as const,
  task: (key: string) => ['tasks', 'one', key] as const,
  jiraStatus: ['tasks', 'jira-status'] as const,
  taskDev: (key: string) => ['tasks', 'dev', key] as const,
  jiraTransitions: (key: string) => ['tasks', 'transitions', key] as const,
  opencodeSkill: ['opencode-skill'] as const,
  /** Invalidar `repos` refresca la lista y las fichas. */
  repos: ['repos'] as const,
  repoList: ['repos', 'list'] as const,
  repo: (id: number) => ['repos', 'one', id] as const,
};
