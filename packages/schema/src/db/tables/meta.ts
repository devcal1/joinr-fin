// app_meta (Stage 0, migration 0000; moved here verbatim) and settings (spec 01 §5).
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ORIGINS } from '../../enums';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  /** ISO 8601 timestamp (UTC). */
  updatedAt: text('updated_at').notNull(),
});

/** Typed key/value settings (registry: settings.ts). `value_json` holds the JSON value. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
  origin: text('origin', { enum: ORIGINS }).notNull(),
});
