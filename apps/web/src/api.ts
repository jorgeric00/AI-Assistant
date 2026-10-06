import type {
  AskResponse,
  DailySummary,
  DevSession,
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
  PrAlert,
  PrWatchStatus,
  PullRequestInfo,
  Reminder,
  Repo,
  RepoDetail,
  RepoInput,
  RepoInspection,
  RepoUpdate,
  ReminderAlert,
  ReminderInput,
  ReminderUpdate,
  SessionOpenResult,
  SnoozeInput,
  TagCount,
  Task,
  TaskDetail,
  TaskDevInfo,
  TaskDoc,
  TaskDocDetail,
  NoteKind,
  AutostartStatus,
  AutostartUpdate,
  BackupStatus,
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
  kind?: NoteKind;
  q?: string;
  tag?: string;
  archived?: boolean;
  /** con: solo las vinculadas a alguna tarea; sin: solo las que no tienen. */
  task?: 'con' | 'sin';
}

export const api = {
  listNotes: ({ kind, q, tag, archived, task }: NotesFilter) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (task) params.set('task', task);
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (archived) params.set('archived', 'true');
    return request<Note[]>('GET', `/api/notes?${params}`);
  },
  getNote: (id: number) => request<Note>('GET', `/api/notes/${id}`),
  createNote: (input: NoteInput) => request<Note>('POST', '/api/notes', input),
  updateNote: (id: number, input: NoteUpdate) => request<Note>('PATCH', `/api/notes/${id}`, input),
  deleteNote: (id: number) => request<void>('DELETE', `/api/notes/${id}`),
  listTags: (kind?: NoteKind) => request<TagCount[]>('GET', `/api/tags${kind ? `?kind=${kind}` : ''}`),
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
  listTaskDocs: (q?: string) => request<TaskDoc[]>('GET', `/api/task-docs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getTaskDoc: (key: string) => request<TaskDocDetail>('GET', `/api/task-docs/${encodeURIComponent(key)}`),
  getTaskSession: (key: string) => request<DevSession>('GET', `/api/tasks/${encodeURIComponent(key)}/session`),
  openTaskSession: (key: string) => request<SessionOpenResult>('POST', `/api/tasks/${encodeURIComponent(key)}/session/open`),
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

  prStatus: () => request<PrWatchStatus>('GET', '/api/prs/status'),
  checkPrs: () => request<PrWatchStatus>('POST', '/api/prs/check'),
  listPrAlerts: () => request<PrAlert[]>('GET', '/api/pr-alerts'),
  getTaskPrs: (key: string) => request<PullRequestInfo[]>('GET', `/api/tasks/${encodeURIComponent(key)}/prs`),

  opencodeSkill: () => request<OpencodeSkillStatus>('GET', '/api/opencode/skill'),
  installOpencodeSkill: () => request<OpencodeSkillStatus>('POST', '/api/opencode/skill/install'),

  getAutostart: () => request<AutostartStatus>('GET', '/api/system/autostart'),
  updateAutostart: (input: AutostartUpdate) => request<AutostartStatus>('PATCH', '/api/system/autostart', input),
  getBackups: () => request<BackupStatus>('GET', '/api/system/backups'),
  runBackup: () => request<BackupStatus>('POST', '/api/system/backups'),
};

/** Claves de consulta de React Query; invalidar `notes` refresca listas, notas y etiquetas. */
export const queryKeys = {
  notes: ['notes'] as const,
  noteList: (filter: NotesFilter) => ['notes', 'list', filter] as const,
  note: (id: number) => ['notes', 'one', id] as const,
  tags: (kind?: NoteKind) => ['notes', 'tags', kind ?? 'todas'] as const,
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
  taskDocs: (q: string) => ['tasks', 'docs', q] as const,
  taskDoc: (key: string) => ['tasks', 'doc', key] as const,
  taskSession: (key: string) => ['tasks', 'session', key] as const,
  jiraTransitions: (key: string) => ['tasks', 'transitions', key] as const,
  opencodeSkill: ['opencode-skill'] as const,
  autostart: ['system', 'autostart'] as const,
  backups: ['system', 'backups'] as const,
  /** Invalidar `prs` refresca avisos, estado y PR de las tareas. */
  prs: ['prs'] as const,
  prStatus: ['prs', 'status'] as const,
  prAlerts: ['prs', 'alerts'] as const,
  taskPrs: (key: string) => ['prs', 'task', key] as const,
  /** Invalidar `repos` refresca la lista y las fichas. */
  repos: ['repos'] as const,
  repoList: ['repos', 'list'] as const,
  repo: (id: number) => ['repos', 'one', id] as const,
};
