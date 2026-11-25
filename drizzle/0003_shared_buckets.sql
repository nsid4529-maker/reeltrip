CREATE TABLE `bucket_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`bucket_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bucket_invites_token_hash_unique` ON `bucket_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `bucket_invites_bucket_idx` ON `bucket_invites` (`bucket_id`);--> statement-breakpoint
CREATE TABLE `bucket_members` (
	`bucket_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`bucket_id`, `member_id`)
);
--> statement-breakpoint
CREATE INDEX `bucket_members_member_idx` ON `bucket_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `bucket_reels` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`source_key` text NOT NULL,
	`source_url` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	`status` text NOT NULL,
	`job_id` text,
	`analysis` text,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bucket_reels_source_unique` ON `bucket_reels` (`bucket_id`,`source_key`);--> statement-breakpoint
CREATE TABLE `place_votes` (
	`bucket_id` text NOT NULL,
	`place_key` text NOT NULL,
	`member_id` text NOT NULL,
	`value` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket_id`, `place_key`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `shared_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
