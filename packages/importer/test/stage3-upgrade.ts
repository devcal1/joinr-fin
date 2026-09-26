// Migration equivalence helpers (stage-4.md §3.5 item 6, §7.6 step 2; stage-5.md §3.5 item 4):
// rebuild the database an older import of the same workbook left, stopped at an older migration,
// and upgrade it to the latest.
// - From 0003: the Stage 3 rows are derived from the current import by undoing what only Stage 4
//   and later write: the new tables and columns, the History-derived contributions, the
//   contribution dates and the last-run balance dates (the Stage 3 importer dated every fund and
//   loan balance at the as-of).
// - From 0004: the Stage 4 rows are the current import without the six `snapshots` columns
//   migration 0005 adds (null, and `revision` 0, on imported rows).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tables } from '@joinr/schema/db';
import {
  DUMPED_TABLES,
  dumpDomainTables,
  MIGRATIONS_DIR,
  type DomainDump,
} from '@joinr/schema/testing';

const STAGE3_TAGS = [
  '0000_app_meta',
  '0001_stage1_core',
  '0002_stage2_investments',
  '0003_stage3_cashflow',
];
const STAGE4_TAGS = [...STAGE3_TAGS, '0004_stage4_assets'];

/** The `snapshots` columns only migration 0005 (and the Stage 5 importer) write. */
export const STAGE5_SNAPSHOT_COLUMNS: readonly string[] = [
  'offset_cents',
  'mortgage_offset_cents',
  'cash_debt_cents',
  'super_measured_through',
  'note',
  'revision',
];

/** The tables and columns only migration 0004 (and the Stage 4 importer) write. */
const STAGE4_TABLES = [
  'other_asset_prices',
  'other_asset_sales',
  'super_balance_entries',
  'property_valuations',
  'loan_balance_entries',
  'loan_offset_links',
];
const STAGE4_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  other_assets: ['purchase_fx_rate', 'purchase_fx_source', 'purchase_fx_date'],
  super_funds: ['receives_sg'],
  // Stage 5 (stage-5.md §3.5 item 4): the columns migration 0005 adds (null / 0 on imported rows,
  // so the upgrade through 0005 gives them back).
  snapshots: STAGE5_SNAPSHOT_COLUMNS,
};

/** A temp copy of the migrations folder holding only `tags` (an older install). */
function migrationsDirWith(tags: readonly string[]): { dir: string; remove: () => void } {
  const last = tags[tags.length - 1]!.slice(0, 4);
  const dir = mkdtempSync(join(tmpdir(), `joinr-importer-${last}-`));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const tag of tags) cpSync(join(MIGRATIONS_DIR, `${tag}.sql`), join(dir, `${tag}.sql`));
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => tags.includes(e.tag));
  if (journal.entries.length !== tags.length) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('a migration tag is missing from the journal');
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A temp copy of the migrations folder that stops at 0003 (a Stage 3 install). */
export function stage3MigrationsDir(): { dir: string; remove: () => void } {
  return migrationsDirWith(STAGE3_TAGS);
}

/** A temp copy of the migrations folder that stops at 0004 (a Stage 4 install). */
export function stage4MigrationsDir(): { dir: string; remove: () => void } {
  return migrationsDirWith(STAGE4_TAGS);
}

/** What the Stage 3 importer wrote for the same workbook (see the header). */
export function stage3Shape(dump: DomainDump, asOf: string): DomainDump {
  const out: DomainDump = {};
  for (const [table, rows] of Object.entries(dump)) {
    if (STAGE4_TABLES.includes(table)) continue;
    const drop = STAGE4_COLUMNS[table] ?? [];
    out[table] = rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k))),
    );
  }
  out.super_funds = (out.super_funds ?? []).map((f) => ({ ...f, balance_as_of: asOf }));
  out.loans = (out.loans ?? []).map((l) => ({ ...l, balance_as_of: asOf }));
  out.super_entries = (out.super_entries ?? [])
    .filter((e) => !String(e.sheet_ref).startsWith('History!R'))
    .map((e) => ({ ...e, entry_date: null }));
  return out;
}

/** What the Stage 4 importer wrote for the same workbook (see the header). */
export function stage4Shape(dump: DomainDump): DomainDump {
  return {
    ...dump,
    snapshots: (dump.snapshots ?? []).map((row) =>
      Object.fromEntries(Object.entries(row).filter(([k]) => !STAGE5_SNAPSHOT_COLUMNS.includes(k))),
    ),
  };
}

/**
 * Inserts the older rows (and an import run, whose workbook as-of 0004 dates the live contribution
 * with) with raw `INSERT`s into a database stopped at an older migration (`olderDir`), upgrades it
 * to the latest migration and dumps it.
 */
export function upgradeFrom(olderDir: string, older: DomainDump, asOf: string): DomainDump {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema: tables });
    migrate(db, { migrationsFolder: olderDir });
    sqlite.transaction(() => {
      for (const { table } of DUMPED_TABLES) {
        for (const row of older[table] ?? []) {
          const cols = Object.keys(row);
          sqlite
            .prepare(
              `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
                .map(() => '?')
                .join(', ')})`,
            )
            .run(...cols.map((c) => row[c]));
        }
      }
      sqlite
        .prepare(
          `INSERT INTO "import_runs" ("started_at", "finished_at", "status", "dry_run", "trigger",
             "file_name", "file_sha256", "file_size", "workbook_as_of", "importer_version")
           VALUES (?, ?, 'succeeded', 0, 'cli', 'workbook.xlsx', ?, 1, ?, '1.0.0')`,
        )
        .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', '0'.repeat(64), asOf);
    })();
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return dumpDomainTables(db);
  } finally {
    sqlite.close();
  }
}

/** The 0003 → latest upgrade (stage-4.md §3.5 item 6). */
export const upgradeFromStage3 = upgradeFrom;

/** Rows without their own `id`, in a stable order (parents keep their ids, so FKs compare). */
export function withoutIds(dump: DomainDump): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [table, rows] of Object.entries(dump)) {
    out[table] = rows
      .map((row) =>
        JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'id'))),
      )
      .sort();
  }
  return out;
}
