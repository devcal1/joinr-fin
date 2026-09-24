// Shared column builders for the Drizzle tables (stage-1.md §2.1). drizzle-kit loads every file in
// this folder, so table files import only drizzle-orm, the enums module and their siblings.
import { integer, text } from 'drizzle-orm/sqlite-core';
import { ORIGINS } from '../../enums';

/** `id integer primary key` without AUTOINCREMENT (ids restart at 1 after a delete-all). */
export const idColumn = () => integer('id').primaryKey();

/** Provenance: `origin` ('import' | 'app', default 'app') and `sheet_ref` ("ETFs!A31"). */
export const provenanceColumns = () => ({
  origin: text('origin', { enum: ORIGINS }).notNull().default('app'),
  sheetRef: text('sheet_ref'),
});
