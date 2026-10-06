CREATE TABLE `pr_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pr_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pr_alerts_created_idx` ON `pr_alerts` (`created_at`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`is_draft` integer NOT NULL,
	`head_ref` text NOT NULL,
	`task_key` text,
	`checks` text,
	`failing_checks` text NOT NULL,
	`approved_by` text NOT NULL,
	`changes_requested_by` text NOT NULL,
	`comments` integer NOT NULL,
	`activity_cursor` text,
	`updated_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pull_requests_task_idx` ON `pull_requests` (`task_key`);