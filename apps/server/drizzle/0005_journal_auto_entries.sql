ALTER TABLE `journal_entries` ADD `ref_key` text;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `journal_ref_key_idx` ON `journal_entries` (`ref_key`);