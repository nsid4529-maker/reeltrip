CREATE TABLE `place_resolutions` (
	`scope` text NOT NULL,
	`place_key` text NOT NULL,
	`status` text NOT NULL,
	`confidence` text NOT NULL,
	`provider` text,
	`provider_place_id` text,
	`lat` real,
	`lng` real,
	`location_expires_at` integer,
	`matched_at` integer NOT NULL,
	`verified_at` integer NOT NULL,
	`fixed_by` text,
	PRIMARY KEY(`scope`, `place_key`)
);
--> statement-breakpoint
CREATE INDEX `place_resolutions_expiry_idx` ON `place_resolutions` (`location_expires_at`);--> statement-breakpoint
CREATE TABLE `provider_calls` (
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `provider`, `kind`)
);
