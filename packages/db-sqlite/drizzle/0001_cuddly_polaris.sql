CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`form_label` text,
	`fields` text NOT NULL,
	`created_at` integer NOT NULL,
	`read` integer NOT NULL,
	`source_url` text,
	`source_referrer` text,
	`source_user_agent` text
);
