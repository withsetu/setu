CREATE TABLE `entry_index` (
	`key` text PRIMARY KEY NOT NULL,
	`row` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `index_meta` (
	`scope` text PRIMARY KEY NOT NULL,
	`meta` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_index` (
	`media_key` text PRIMARY KEY NOT NULL,
	`row` text NOT NULL
);
