CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`bucket_id` text,
	`props` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_name_created_idx` ON `events` (`name`,`created_at`);