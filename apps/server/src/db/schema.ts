// Stage 0 schema: a single key/value table for app bookkeeping.
// Stage 1 moves the schema into packages/schema; keep migrations append-only.
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  /** ISO 8601 timestamp (UTC). */
  updatedAt: text('updated_at').notNull(),
});

export type AppMetaRow = typeof appMeta.$inferSelect;
