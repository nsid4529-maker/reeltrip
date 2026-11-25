CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_token_hash_unique` ON `members` (`token_hash`);