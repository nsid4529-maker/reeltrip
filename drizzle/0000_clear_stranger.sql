CREATE TABLE `analysis_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`result` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`source_url` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
