// A deterministic dump of the imported data, for idempotency tests (§4.8).
import { sql } from 'drizzle-orm';
import type { JoinrDb } from '../db/index';

/**
 * Every table the import writes (the replace-all set, instruments, settings and pricing), parents
 * before children. The Stage 3 overlays (`savings_adjustments`, `savings_goals`) and the
 * `dividend_events` cache are not dumped: the import never writes them (stage-3.md §3.2); nor are
 * the Stage 4 overlay (`super_sg_overrides`) and cache (`market_quote_history`) (stage-4.md §3.2),
 * nor the Stage 5 `snapshot_audit` log (stage-5.md §3.2; the new snapshot columns are dumped with
 * the row).
 */
export const DUMPED_TABLES: readonly { table: string; orderBy: string }[] = [
  { table: 'instruments', orderBy: 'id' },
  { table: 'price_sources', orderBy: 'instrument_id' },
  { table: 'prices', orderBy: 'instrument_id' },
  { table: 'settings', orderBy: 'key' },
  { table: 'trades', orderBy: 'id' },
  { table: 'dividends', orderBy: 'id' },
  { table: 'cash_accounts', orderBy: 'id' },
  { table: 'cash_balance_entries', orderBy: 'id' },
  { table: 'budget_items', orderBy: 'id' },
  { table: 'yearly_expenses', orderBy: 'id' },
  { table: 'income_streams', orderBy: 'id' },
  { table: 'side_income_entries', orderBy: 'id' },
  { table: 'side_income_deposits', orderBy: 'id' },
  { table: 'period_notes', orderBy: 'id' },
  { table: 'snapshots', orderBy: 'id' },
  { table: 'other_assets', orderBy: 'id' },
  { table: 'super_funds', orderBy: 'id' },
  { table: 'super_entries', orderBy: 'id' },
  { table: 'properties', orderBy: 'id' },
  { table: 'loans', orderBy: 'id' },
  // Stage 4 (stage-4.md §3.2).
  { table: 'other_asset_prices', orderBy: 'id' },
  { table: 'other_asset_sales', orderBy: 'id' },
  { table: 'super_balance_entries', orderBy: 'id' },
  { table: 'property_valuations', orderBy: 'id' },
  { table: 'loan_balance_entries', orderBy: 'id' },
  { table: 'loan_offset_links', orderBy: 'account_id' },
];

export type DomainDump = Record<string, Record<string, unknown>[]>;

/**
 * All rows of the domain tables plus `settings`, `price_sources` and `prices`, in primary-key
 * order with columns in table order (raw SQL values, ids included). `import_runs`, `job_runs`,
 * `market_quotes` and `app_meta` are excluded.
 */
export function dumpDomainTables(db: JoinrDb): DomainDump {
  const dump: DomainDump = {};
  for (const { table, orderBy } of DUMPED_TABLES) {
    dump[table] = db.all<Record<string, unknown>>(
      sql.raw(`SELECT * FROM "${table}" ORDER BY "${orderBy}"`),
    );
  }
  return dump;
}

/** `dumpDomainTables` as a JSON string (stable: same data → same text). */
export function dumpDomainTablesJson(db: JoinrDb): string {
  return JSON.stringify(dumpDomainTables(db));
}
