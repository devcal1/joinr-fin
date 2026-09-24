// `@joinr/schema/db`: the Drizzle tables (server, importer, tests). The web never imports this.
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as assetsTables from './tables/assets';
import * as cashflowTables from './tables/cashflow';
import * as historyTables from './tables/history';
import * as instrumentTables from './tables/instruments';
import * as ledgerTables from './tables/ledger';
import * as metaTables from './tables/meta';
import * as runTables from './tables/runs';
import { otherAssets, loans, properties, superEntries, superFunds } from './tables/assets';
import {
  budgetItems,
  cashAccounts,
  incomeStreams,
  periodNotes,
  sideIncomeEntries,
  yearlyExpenses,
} from './tables/cashflow';
import { snapshots } from './tables/history';
import { dividends, trades } from './tables/ledger';

export * from './tables/assets';
export * from './tables/cashflow';
export * from './tables/history';
export * from './tables/instruments';
export * from './tables/ledger';
export * from './tables/meta';
export * from './tables/runs';

/** Every table, keyed by its export name (the Drizzle `schema` object). */
export const tables = {
  ...metaTables,
  ...instrumentTables,
  ...ledgerTables,
  ...cashflowTables,
  ...historyTables,
  ...assetsTables,
  ...runTables,
};

export type JoinrDb = BetterSQLite3Database<typeof tables>;

/**
 * The imported domain tables in a safe delete order (children first). The importer's replace-all
 * deletes these; instruments are upserted instead (§4.8), and `settings`, `price_sources`,
 * `prices`, `market_quotes`, `import_runs`, `job_runs` and `app_meta` are kept.
 */
export const DOMAIN_TABLES_DELETE_ORDER = [
  dividends,
  trades,
  sideIncomeEntries,
  incomeStreams,
  periodNotes,
  budgetItems,
  yearlyExpenses,
  cashAccounts,
  snapshots,
  superEntries,
  superFunds,
  loans,
  properties,
  otherAssets,
] as const;

export type TableRow<T extends { $inferSelect: unknown }> = T['$inferSelect'];
export type TableInsert<T extends { $inferInsert: unknown }> = T['$inferInsert'];
