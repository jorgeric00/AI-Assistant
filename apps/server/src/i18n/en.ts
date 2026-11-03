import type { Messages } from './index.js';

// Server texts in English. Same keys as es.ts.
export const en: Messages = {
  // Common
  'common.unknown': 'unknown',
  'common.routeNotFound': 'Route not found',

  // Validation: custom messages from the @dev-assistant/shared schemas (translated when responding)
  'validation.jiraKey': 'Invalid JIRA key (e.g. ABC-123)',
  'validation.titleRequired': 'The title is required',
  'validation.pickADay': 'Pick at least one day',
  'validation.reminderTitleRequired': 'Write what you want to be reminded of',
  'validation.commentEmpty': 'The comment is empty',
  'validation.projectKey': 'Invalid JIRA project key (e.g. ABC)',
  'validation.githubRepo': 'The GitHub repo must be owner/name',

  // AI (opencode): language instruction, errors and prompt texts that show up in the answer
  'ai.answerLanguage': 'Answer in English.',
  'ai.notConfigured': 'AI is not configured.',
  'ai.connectFailed': 'Cannot connect to opencode at {{url}} ({{detail}}).',
  'ai.startFailed': 'Could not start opencode ({{detail}}). Check that the "opencode" command works in a terminal.',
  'ai.modelError': 'The model returned an error: {{message}}',
  'ai.emptyAnswer': 'The model did not return any answer.',
  'ai.opencodeFailed': 'Error talking to opencode: {{message}}',
  'ai.ask.noMatches': "I didn't find anything in the app related to the question.",
  'ai.ask.notInNotes': "I don't have that in the app",
  'ai.daily.nothingToSummarize': 'There are no journal entries since the last working day and no reminders for today. Write down what you did and generate it again.',
  'ai.daily.yesterday': 'Yesterday',
  'ai.daily.today': 'Today',
  'ai.daily.blockers': 'Blockers',
  'ai.daily.nothing': 'Nothing',
  'ai.repoProfile.conventions': 'Conventions',
  'ai.repoProfile.tests': 'Tests',
  'ai.repoProfile.architecture': 'Architecture',
  'ai.repoProfile.noData': 'No data',

  // JIRA (REST API, sync and "Update JIRA")
  'jira.notConfigured': 'JIRA is not configured: add JIRA_URL and JIRA_TOKEN to the .env file.',
  'jira.connectFailed': 'Could not connect to JIRA at {{url}}: {{cause}}',
  'jira.loginRedirect': 'JIRA redirects to a login page{{host}}: from this network the API does not accept the token. Try from the company network or over the VPN.',
  'jira.unauthorized': 'JIRA rejected the credentials (401). Check JIRA_TOKEN (and JIRA_EMAIL if it is JIRA Cloud).',
  'jira.forbidden': 'JIRA does not grant permission to this token (403).',
  'jira.httpError': 'JIRA responded {{status}}',
  'jira.notJson': 'JIRA did not return API data (it responded with a web page). Is JIRA_URL correct? ({{url}})',
  'jira.apiNotFound': 'JIRA could not find the API at {{url}}/rest/api. Check JIRA_URL: it must be the part of an issue address before /browse/.',
  'jira.issueNotVisible': 'JIRA cannot find {{key}} or this token cannot see it.',
  'jira.cannotComment': 'JIRA cannot find {{key}} or this token cannot comment on it.',
  'jira.cannotTransition': 'JIRA cannot find {{key}} or this token cannot change its status.',
  'jira.taskNotInApp': 'Task {{key}} is not in the app.',
  'jira.transitionGone': 'JIRA no longer allows that status change from "{{status}}". Close the dialog and open it again.',
  'jira.commentAddedTransitionFailed': 'The comment was added, but the status could not be changed: {{message}}',
  'jira.draft.nothingNew': 'There are no new notes, journal entries or commits for {{key}} since the last update sent to JIRA. Write the comment yourself or note down what you have done first.',
  'jira.draft.nothing': 'There are no notes, journal entries or opencode changes for {{key}} to write the comment from. Write it yourself or note down what you have done first.',
  'jira.changelog.comment': 'Comment in JIRA',
  'jira.changelog.transition': 'Status {{from}} → {{to}}',
  'jira.create.noUser': 'JIRA does not say which user the token belongs to, so the task cannot be assigned.',
  'jira.create.projectNotVisible': 'JIRA cannot find project {{project}}, or this token cannot create tasks in it.',
  'jira.create.noKey': 'JIRA did not return the key of the created task.',
  'jira.create.sprintNotFound': 'JIRA cannot find that sprint.',
  'jira.create.epicNotFound': 'JIRA cannot find epic {{epic}}.',
  'jira.create.notANumber': '"{{field}}" must be a number.',
  'jira.create.missingFields': 'Required fields are missing: {{fields}}.',
  'jira.create.epicFailed': 'Could not add it to epic {{epic}}: {{message}}',
  'jira.create.sprintFailed': 'Could not add it to the sprint: {{message}}',

  // GitHub (GraphQL API)
  'github.notConfigured': 'GitHub is not configured: add GITHUB_TOKEN to the .env file.',
  'github.connectFailed': 'Could not connect to GitHub: {{cause}}',
  'github.unauthorized': 'GitHub rejected the token (401). Check GITHUB_TOKEN.',
  'github.httpError': 'GitHub responded {{status}}',
  'github.ssoNotAuthorized': 'The token is not authorized for the organization SSO. In GitHub: Settings > Developer settings > tokens > Configure SSO > Authorize.',
  'github.graphqlError': 'GitHub returned an error: {{message}}',
  'github.emptyResponse': 'empty response',
  'github.ssoWarning': 'There are PRs from an organization with SSO that the token cannot see. In GitHub: Settings > Developer settings > tokens > Configure SSO > Authorize.',

  // Your PR alerts (stored in the database and shown as notifications)
  'prs.alert.ciFailed': 'CI failing',
  'prs.alert.failing': 'Failing {{checks}}',
  'prs.alert.changesRequested': 'Changes requested',
  'prs.alert.approved': 'Approved',
  'prs.alert.merged': 'Merged',
  'prs.alert.by': 'By {{people}}',
  'prs.alert.commentsOne': '1 new comment',
  'prs.alert.commentsOther': '{{count}} new comments',
  'prs.alert.from': 'From {{people}}',

  // Reminders (system notification)
  'reminders.notFound': 'Reminder not found',
  'reminders.alertNotFound': 'Alert not found',
  'reminders.notification': 'Reminder',
  'reminders.notificationLate': 'Overdue reminder',

  // Journal (automatic entries)
  'journal.entryNotFound': 'Entry not found',
  'journal.statusChange': 'Status in JIRA: {{from}} → {{to}}',
  'journal.commit': 'Commit in {{repo}}: {{text}}',

  // Notes
  'notes.notFound': 'Note not found',

  // Tasks
  'tasks.notFound': 'Task not found',
  'tasks.noSummary': '{{key}} has no summary yet',

  // Repositories
  'repos.notFound': 'Repository not found',
  'repos.notGitRepo': '{{path}} is not a git repository (or does not exist).',
  'repos.pathMissing': 'The repository cannot be found at {{path}}.',
  'repos.nameTaken': 'There is already a repository called {{name}}.',
  'repos.inUse': 'This repository is used in development sessions and cannot be removed.',

  // System (backups)
  'backups.noDatabase': 'There is no database to back up.',
};
