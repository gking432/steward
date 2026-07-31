CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`due_date` text NOT NULL,
	`frequency` text NOT NULL,
	`autopay` integer DEFAULT false NOT NULL,
	`essential` integer DEFAULT true NOT NULL,
	`account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`type` text NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`available` real DEFAULT 0 NOT NULL,
	`credit_limit` real,
	`interest_rate` real,
	`minimum_payment` real,
	`due_date` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'manual' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_user_id_idx` ON `financial_accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target` real NOT NULL,
	`current` real DEFAULT 0 NOT NULL,
	`target_date` text,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`pay_frequency` text DEFAULT 'Biweekly' NOT NULL,
	`next_payday` text,
	`take_home_pay` real DEFAULT 0 NOT NULL,
	`minimum_buffer` real DEFAULT 0 NOT NULL,
	`risk_tolerance` text DEFAULT 'Balanced' NOT NULL,
	`preferences_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`status` text DEFAULT 'Planned' NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`next_action` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`priority` text NOT NULL,
	`impact` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`reason` text,
	`action` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period` text NOT NULL,
	`type` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steward_snapshots` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`merchant` text NOT NULL,
	`description` text,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`category` text DEFAULT 'Uncategorized' NOT NULL,
	`subcategory` text,
	`type` text DEFAULT 'expense' NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`confidence` real,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_user_id_idx` ON `transactions` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `user_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`category` text,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`price` real NOT NULL,
	`desired_date` text,
	`safe_date` text,
	`status` text DEFAULT 'Considering' NOT NULL,
	`recommendation_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
