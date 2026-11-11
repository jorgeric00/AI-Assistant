import type {
  AiOptions,
  McpOverview,
  AiSettings,
  AiSettingsUpdate,
  ChatPermissionReply,
  ChatQuestionReplyInput,
  ChatSendInput,
  TaskChat,
  ConversationList,
  GeneralChat,
  AskSourceType,
  JiraCreateDraft,
  JiraCreateDraftInput,
  JiraCreateForm,
  JiraCreateInput,
  JiraCreateProjects,
  JiraCreateResult,
  JiraEpicOption,
  JiraIssueTypeOption,
  JiraProjectOption,
  JiraSprintOption,
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
  PrFailures,
  PrDetail,
  PrList,
  PrListFilter,
  PrFixResult,
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
  Language,
  LanguageSetting,
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
  ask: (question: string, sources?: AskSourceType[]) => request<AskResponse>('POST', '/api/search/ask', { question, sources }),

  listTasks: (done: boolean) => request<Task[]>('GET', `/api/tasks${done ? '?done=true' : ''}`),
  taskProjects: () => request<JiraProjectOption[]>('GET', '/api/tasks/projects'),
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
  jiraCreateProjects: () => request<JiraCreateProjects>('GET', '/api/jira/create/projects'),
  jiraIssueTypes: (project: string) => request<JiraIssueTypeOption[]>('GET', `/api/jira/create/projects/${encodeURIComponent(project)}/types`),
  jiraCreateForm: (project: string, typeId: string) =>
    request<JiraCreateForm>('GET', `/api/jira/create/projects/${encodeURIComponent(project)}/types/${encodeURIComponent(typeId)}`),
  jiraEpics: (project: string, q: string) =>
    request<JiraEpicOption[]>('GET', `/api/jira/create/projects/${encodeURIComponent(project)}/epics${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  jiraSprints: (project: string) => request<JiraSprintOption[]>('GET', `/api/jira/create/projects/${encodeURIComponent(project)}/sprints`),
  draftJiraTask: (input: JiraCreateDraftInput) => request<JiraCreateDraft>('POST', '/api/jira/create/draft', input),
  createJiraTask: (input: JiraCreateInput) => request<JiraCreateResult>('POST', '/api/jira/create', input),

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
  listPrs: (state: PrListFilter) => request<PrList>('GET', `/api/prs?state=${state}`),
  getPr: (id: string) => request<PrDetail>('GET', `/api/prs/${encodeURIComponent(id)}`),
  watchPr: (id: string, watched: boolean) => request<PullRequestInfo>('PUT', `/api/prs/${encodeURIComponent(id)}/watch`, { watched }),
  prFailures: (id: string) => request<PrFailures>('GET', `/api/prs/${encodeURIComponent(id)}/failures`),
  fixPr: (id: string) => request<PrFixResult>('POST', `/api/prs/${encodeURIComponent(id)}/fix`),

  aiOptions: (refresh = false) => request<AiOptions>('GET', `/api/ai/options${refresh ? '?refresh=1' : ''}`),
  aiSettings: () => request<AiSettings>('GET', '/api/ai/settings'),
  aiMcp: () => request<McpOverview>('GET', '/api/ai/mcp'),
  updateAiSettings: (change: AiSettingsUpdate) => request<AiSettings>('PUT', '/api/ai/settings', change),
  taskChat: (key: string) => request<TaskChat>('GET', `/api/tasks/${encodeURIComponent(key)}/chat`),
  sendTaskChat: (key: string, input: ChatSendInput) => request<TaskChat>('POST', `/api/tasks/${encodeURIComponent(key)}/chat/messages`, input),
  abortTaskChat: (key: string) => request<TaskChat>('POST', `/api/tasks/${encodeURIComponent(key)}/chat/abort`),
  resetTaskChat: (key: string) => request<TaskChat>('POST', `/api/tasks/${encodeURIComponent(key)}/chat/reset`),
  replyTaskPermission: (key: string, id: string, reply: ChatPermissionReply) =>
    request<TaskChat>('POST', `/api/tasks/${encodeURIComponent(key)}/chat/permissions/${encodeURIComponent(id)}`, { reply }),
  answerTaskQuestion: (key: string, id: string, input: ChatQuestionReplyInput) =>
    request<TaskChat>('POST', `/api/tasks/${encodeURIComponent(key)}/chat/questions/${encodeURIComponent(id)}`, input),

  // Chat general con opencode
  conversations: () => request<ConversationList>('GET', '/api/chats'),
  newConversation: () => request<GeneralChat>('GET', '/api/chats/new'),
  conversation: (id: string) => request<GeneralChat>('GET', `/api/chats/${encodeURIComponent(id)}`),
  startConversation: (input: ChatSendInput) => request<GeneralChat>('POST', '/api/chats', input),
  sendConversation: (id: string, input: ChatSendInput) => request<GeneralChat>('POST', `/api/chats/${encodeURIComponent(id)}/messages`, input),
  abortConversation: (id: string) => request<GeneralChat>('POST', `/api/chats/${encodeURIComponent(id)}/abort`),
  replyConversationPermission: (id: string, permissionId: string, reply: ChatPermissionReply) =>
    request<GeneralChat>('POST', `/api/chats/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, { reply }),
  answerConversationQuestion: (id: string, questionId: string, input: ChatQuestionReplyInput) =>
    request<GeneralChat>('POST', `/api/chats/${encodeURIComponent(id)}/questions/${encodeURIComponent(questionId)}`, input),
  deleteConversation: (id: string) => request<void>('DELETE', `/api/chats/${encodeURIComponent(id)}`),
  opencodeSkill: () => request<OpencodeSkillStatus>('GET', '/api/opencode/skill'),
  installOpencodeSkill: () => request<OpencodeSkillStatus>('POST', '/api/opencode/skill/install'),

  getLanguage: () => request<LanguageSetting>('GET', '/api/settings/language'),
  setLanguage: (language: Language) => request<LanguageSetting>('PUT', '/api/settings/language', { language }),

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
  taskProjects: ['tasks', 'projects'] as const,
  jiraStatus: ['tasks', 'jira-status'] as const,
  taskDev: (key: string) => ['tasks', 'dev', key] as const,
  taskDocs: (q: string) => ['tasks', 'docs', q] as const,
  taskDoc: (key: string) => ['tasks', 'doc', key] as const,
  taskSession: (key: string) => ['tasks', 'session', key] as const,
  jiraTransitions: (key: string) => ['tasks', 'transitions', key] as const,
  jiraCreateProjects: ['jira-create', 'projects'] as const,
  jiraIssueTypes: (project: string) => ['jira-create', 'types', project] as const,
  jiraCreateForm: (project: string, typeId: string) => ['jira-create', 'form', project, typeId] as const,
  jiraEpics: (project: string, q: string) => ['jira-create', 'epics', project, q] as const,
  jiraSprints: (project: string) => ['jira-create', 'sprints', project] as const,
  taskChat: (key: string) => ['tasks', 'chat', key] as const,
  conversations: ['chats'] as const,
  conversation: (id: string | null) => ['chats', id ?? 'new'] as const,
  aiOptions: ['ai', 'options'] as const,
  aiSettings: ['ai', 'settings'] as const,
  aiMcp: ['ai', 'mcp'] as const,
  opencodeSkill: ['opencode-skill'] as const,
  language: ['settings', 'language'] as const,
  autostart: ['system', 'autostart'] as const,
  backups: ['system', 'backups'] as const,
  /** Invalidar `prs` refresca avisos, estado y PR de las tareas. */
  prs: ['prs'] as const,
  prStatus: ['prs', 'status'] as const,
  prAlerts: ['prs', 'alerts'] as const,
  taskPrs: (key: string) => ['prs', 'task', key] as const,
  prFailures: (id: string) => ['prs', 'failures', id] as const,
  prList: (state: string) => ['prs', 'list', state] as const,
  pr: (id: string) => ['prs', 'detail', id] as const,
  /** Invalidar `repos` refresca la lista y las fichas. */
  repos: ['repos'] as const,
  repoList: ['repos', 'list'] as const,
  repo: (id: number) => ['repos', 'one', id] as const,
};
