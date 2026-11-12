CREATE TABLE `worklog_imputations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`jira_key` text NOT NULL,
	`seconds` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worklog_day_task_idx` ON `worklog_imputations` (`date`,`jira_key`);