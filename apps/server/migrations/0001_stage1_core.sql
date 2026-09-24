CREATE TABLE `loans` (
	`id` integer PRIMARY KEY NOT NULL,
	`property_id` integer,
	`name` text NOT NULL,
	`lender` text,
	`start_date` text,
	`interest_periods_per_year` integer,
	`annual_rate` text,
	`payment_cents` integer,
	`payment_frequency` text DEFAULT 'monthly' NOT NULL,
	`start_balance_cents` integer,
	`current_balance_cents` integer NOT NULL,
	`balance_as_of` text,
	`payments_paid_cents` integer,
	`payments_paid_derived` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loans_property_idx` ON `loans` (`property_id`);--> statement-breakpoint
CREATE TABLE `other_assets` (
	`id` integer PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`url` text,
	`purchase_date` text,
	`units` text NOT NULL,
	`sold_units` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`unit_cost` text,
	`unit_price` text,
	`unit_price_as_of` text,
	`price_source` text DEFAULT 'manual' NOT NULL,
	`metal` text,
	`unit_of_measure` text DEFAULT 'each' NOT NULL,
	`oz_per_unit` text,
	`sort_order` integer NOT NULL,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`purchase_date` text,
	`is_primary_residence` integer DEFAULT false NOT NULL,
	`purchase_value_cents` integer DEFAULT 0 NOT NULL,
	`current_value_cents` integer DEFAULT 0 NOT NULL,
	`valuation_date` text,
	`net_rent_to_date_cents` integer DEFAULT 0 NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `super_entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`period_month` text NOT NULL,
	`kind` text NOT NULL,
	`fund_id` integer,
	`entry_date` text,
	`amount_cents` integer NOT NULL,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`fund_id`) REFERENCES `super_funds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `super_entries_period_idx` ON `super_entries` (`period_month`);--> statement-breakpoint
CREATE TABLE `super_funds` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`balance_as_of` text,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `budget_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`monthly_cents` integer,
	`category` text,
	`account_name` text,
	`cash_account_id` integer,
	`sort_order` integer NOT NULL,
	`review_flags` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`cash_account_id`) REFERENCES `cash_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `budget_items_cash_account_idx` ON `budget_items` (`cash_account_id`);--> statement-breakpoint
CREATE TABLE `cash_accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'bank' NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`balance_cents` integer NOT NULL,
	`balance_as_of` text,
	`is_offset` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `income_streams` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `period_notes` (
	`id` integer PRIMARY KEY NOT NULL,
	`period_month` text NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_notes_period_month_kind_unique` ON `period_notes` (`period_month`,`kind`);--> statement-breakpoint
CREATE TABLE `side_income_entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`stream_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`amount_cents` integer NOT NULL,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`stream_id`) REFERENCES `income_streams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `side_income_entries_period_month_stream_id_unique` ON `side_income_entries` (`period_month`,`stream_id`);--> statement-breakpoint
CREATE TABLE `yearly_expenses` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`annual_cents` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY NOT NULL,
	`run_date` text NOT NULL,
	`period_month` text NOT NULL,
	`source` text NOT NULL,
	`recorded_at` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	`stocks_value_cents` integer,
	`stocks_gain_cents` integer,
	`stocks_gain_ratio` text,
	`stocks_movements_cents` integer,
	`etf_value_cents` integer,
	`etf_gain_cents` integer,
	`etf_gain_ratio` text,
	`etf_movements_cents` integer,
	`crypto_value_cents` integer,
	`crypto_gain_cents` integer,
	`crypto_gain_ratio` text,
	`crypto_movements_cents` integer,
	`cash_value_cents` integer,
	`cash_gain_cents` integer,
	`cash_increase_ratio` text,
	`super_value_cents` integer,
	`super_contrib_cents` integer,
	`super_gain_cents` integer,
	`super_gain_ratio` text,
	`liabilities_balance_cents` integer,
	`liabilities_paid_cents` integer,
	`salary_monthly_cents` integer,
	`property_value_cents` integer,
	`property_purchase_cents` integer,
	`property_equity_cents` integer,
	`property_gain_cents` integer,
	`mortgage_balance_cents` integer,
	`mortgage_interest_fees_cents` integer,
	`mortgage_principal_paid_cents` integer,
	`property_gain_ratio` text,
	`mf_value_cents` integer,
	`mf_gain_cents` integer,
	`mf_gain_ratio` text,
	`mf_movements_cents` integer,
	`other_value_cents` integer,
	`other_gain_cents` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_period_month_unique` ON `snapshots` (`period_month`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`symbol` text NOT NULL,
	`exchange` text,
	`code` text NOT NULL,
	`name` text,
	`quote_currency` text DEFAULT 'AUD' NOT NULL,
	`is_watched` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`target_ratio` text,
	`sector` text,
	`is_retirement` integer DEFAULT false NOT NULL,
	`location` text,
	`mgmt_fee_ratio` text,
	`region_us_ratio` text,
	`region_asia_ratio` text,
	`region_aus_ratio` text,
	`region_other_ratio` text,
	`dividend_freq_months` integer,
	`drp` integer,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text
);
--> statement-breakpoint
CREATE INDEX `instruments_code_idx` ON `instruments` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_kind_symbol_unique` ON `instruments` (`kind`,`symbol`);--> statement-breakpoint
CREATE TABLE `market_quotes` (
	`series_id` text PRIMARY KEY NOT NULL,
	`value` text,
	`unit` text NOT NULL,
	`as_of` text,
	`fetched_at` text,
	`source` text,
	`last_attempt_at` text,
	`last_status` text DEFAULT 'never' NOT NULL,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_sources` (
	`instrument_id` integer PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_symbol` text,
	`symbol_origin` text NOT NULL,
	`manual_price` text,
	`manual_price_as_of` text,
	`manual_origin` text,
	`manual_note` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`instrument_id` integer PRIMARY KEY NOT NULL,
	`price` text,
	`native_price` text,
	`native_currency` text,
	`fx_rate` text,
	`as_of` text,
	`fetched_at` text,
	`source` text,
	`last_attempt_at` text,
	`last_status` text DEFAULT 'never' NOT NULL,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dividends` (
	`id` integer PRIMARY KEY NOT NULL,
	`instrument_id` integer,
	`ticker` text NOT NULL,
	`holding_kind` text NOT NULL,
	`payment_date` text NOT NULL,
	`ex_date` text,
	`reinvested` integer,
	`net_amount_cents` integer NOT NULL,
	`price_at_ex` text,
	`price_at_ex_manual` integer DEFAULT false NOT NULL,
	`review_flags` text,
	`correction_id` text,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dividends_instrument_idx` ON `dividends` (`instrument_id`);--> statement-breakpoint
CREATE INDEX `dividends_payment_date_idx` ON `dividends` (`payment_date`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY NOT NULL,
	`instrument_id` integer NOT NULL,
	`trade_date` text NOT NULL,
	`units` text NOT NULL,
	`price` text NOT NULL,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`fee_rate` text,
	`seq` integer NOT NULL,
	`review_flags` text,
	`correction_id` text,
	`note` text,
	`origin` text DEFAULT 'app' NOT NULL,
	`sheet_ref` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trades_instrument_date_seq_idx` ON `trades` (`instrument_id`,`trade_date`,`seq`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	`origin` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`trigger` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`file_size` integer NOT NULL,
	`workbook_as_of` text,
	`corrections_name` text,
	`corrections_sha256` text,
	`importer_version` text NOT NULL,
	`totals_json` text,
	`report_json` text,
	`error_code` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `import_runs_started_at_idx` ON `import_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`detail_json` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_started_at_idx` ON `job_runs` (`job`,`started_at`);