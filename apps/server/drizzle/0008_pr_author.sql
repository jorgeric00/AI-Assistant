ALTER TABLE `pull_requests` ADD `author` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `mine` integer DEFAULT true NOT NULL;