CREATE TABLE `changelog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`dev_session_id` integer,
	`repo_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`payload_json` text,
	`external_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dev_session_id`) REFERENCES `dev_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `changelog_task_idx` ON `changelog` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `commit_files` (
	`changelog_id` integer NOT NULL,
	`path` text NOT NULL,
	`change_type` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`changelog_id`) REFERENCES `changelog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`content_md` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dev_session_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dev_session_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`pr_number` integer,
	`pr_url` text,
	FOREIGN KEY (`dev_session_id`) REFERENCES `dev_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dev_session_repo_unique` ON `dev_session_repos` (`dev_session_id`,`repo_id`);--> statement-breakpoint
CREATE TABLE `dev_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`opencode_session_id` text,
	`status` text DEFAULT 'analyzing' NOT NULL,
	`plan_md` text,
	`plan_approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`task_id` integer,
	`text` text NOT NULL,
	`ref_table` text,
	`ref_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `journal_date_idx` ON `journal_entries` (`date`);--> statement-breakpoint
CREATE TABLE `note_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_text` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_tags` (
	`note_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`note_id`, `tag_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_tasks` (
	`note_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	PRIMARY KEY(`note_id`, `task_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`url` text,
	`url_title` text,
	`pinned` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dev_session_id` integer,
	`dev_session_repo_id` integer,
	`task_id` integer,
	`kind` text NOT NULL,
	`proposal_json` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`dev_session_id`) REFERENCES `dev_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dev_session_repo_id`) REFERENCES `dev_session_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pr_watch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`last_head_sha` text,
	`last_ci_state` text,
	`last_comment_id` text,
	`last_checked_at` text,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_watch_unique` ON `pr_watch` (`repo_id`,`pr_number`);--> statement-breakpoint
CREATE TABLE `reminder_fires` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reminder_id` integer NOT NULL,
	`fired_at` text NOT NULL,
	`channel` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`due_at` text NOT NULL,
	`rrule` text,
	`channels` text DEFAULT 'app' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`next_fire_at` text,
	`snoozed_until` text,
	`note_id` integer,
	`task_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reminders_next_fire_idx` ON `reminders` (`status`,`next_fire_at`);--> statement-breakpoint
CREATE TABLE `repo_profiles` (
	`repo_id` integer PRIMARY KEY NOT NULL,
	`conventions_md` text DEFAULT '' NOT NULL,
	`test_commands_md` text DEFAULT '' NOT NULL,
	`architecture_md` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`local_path` text NOT NULL,
	`github_owner` text NOT NULL,
	`github_repo` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`jira_project_keys` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_name_unique` ON `repos` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jira_key` text NOT NULL,
	`summary` text NOT NULL,
	`description_md` text,
	`status` text NOT NULL,
	`status_category` text,
	`priority` text,
	`url` text,
	`raw_json` text,
	`last_synced_at` text,
	`local_notes_md` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_jira_key_unique` ON `tasks` (`jira_key`);