DROP INDEX `place_resolutions_expiry_idx`;--> statement-breakpoint
ALTER TABLE `place_resolutions` DROP COLUMN `lat`;--> statement-breakpoint
ALTER TABLE `place_resolutions` DROP COLUMN `lng`;--> statement-breakpoint
ALTER TABLE `place_resolutions` DROP COLUMN `location_expires_at`;