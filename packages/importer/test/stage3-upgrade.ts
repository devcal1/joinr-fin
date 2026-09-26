// Migration equivalence helpers (stage-4.md §3.5 item 6, §7.6 step 2): rebuild the database a
// Stage 3 import of the same workbook left, stopped at migration 0003, and upgrade it through
// migration 0004. The Stage 3 rows are derived from the Stage 4 import by undoing what only Stage 4
// writes: the new tables and columns, the History-derived contributions, the contribution dates and
// the last-run balance dates (the Stage 3 importer dated every fund and loan balance at the as-of).
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
};

/** A temp copy of the migrations folder that stops at 0003 (an older install). */
export function stage3MigrationsDir(): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-importer-0003-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const tag of STAGE3_TAGS)
    cpSync(join(MIGRATIONS_DIR, `${tag}.sql`), join(dir, `${tag}.sql`));
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => STAGE3_TAGS.includes(e.tag));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
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

/**
 * Inserts the Stage 3 rows (and the Stage 3 import run, whose workbook as-of 0004 dates the live
 * contribution with) into a database stopped at 0003, upgrades it to the latest migration and
 * dumps it.
 */
export function upgradeFromStage3(stage3Dir: string, stage3: DomainDump, asOf: string): DomainDump {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema: tables });
    migrate(db, { migrationsFolder: stage3Dir });
    sqlite.transaction(() => {
      for (const { table } of DUMPED_TABLES) {
        for (const row of stage3[table] ?? []) {
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
