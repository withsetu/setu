CREATE TABLE `drafts` (
	`collection` text NOT NULL,
	`locale` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text NOT NULL,
	`base_sha` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`collection`, `locale`, `slug`)
);
--> statement-breakpoint
CREATE TABLE `locks` (
	`collection` text NOT NULL,
	`locale` text NOT NULL,
	`slug` text NOT NULL,
	`locked_by` text NOT NULL,
	`locked_at` integer NOT NULL,
	PRIMARY KEY(`collection`, `locale`, `slug`)
);
