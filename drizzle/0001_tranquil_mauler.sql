CREATE TABLE `plaid_items` (
	`item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`institution_id` text,
	`cursor` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
