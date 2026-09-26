// The snapshot audit log (stage-5.md §3.1, §4.4 SnapshotAuditDto): reading it newest first and
// mapping a row to its DTO. The log is written by `record.ts` (record) and `mutations.ts` (correct,
// delete); it has no FK and no provenance (never app data, §3.4).
import { MARKET_DATA_MODES, type MarketDataMode, type SnapshotAuditDto } from '@joinr/schema';
import { snapshotAudit, type TableRow } from '@joinr/schema/db';
import { desc } from 'drizzle-orm';
import type { Db } from '../db/database';
import type { Tx } from '../db/queries/domain';
import { AUDIT_LIST_MAX } from './constants';

export type SnapshotAuditRow = TableRow<typeof snapshotAudit>;

/** A `changes_json` entry: one column's (or the next month's `"YYYY-MM.column"`) before and after. */
export type AuditChange = { before: number | string | null; after: number | string | null };

/** The newest audit rows first (`at` desc, then id desc), at most `limit`. */
export function readAudit(db: Db | Tx, limit: number = AUDIT_LIST_MAX): SnapshotAuditRow[] {
  return db
    .select()
    .from(snapshotAudit)
    .orderBy(desc(snapshotAudit.at), desc(snapshotAudit.id))
    .limit(limit)
    .all();
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cell = (v: unknown): number | string | null =>
  typeof v === 'number' || typeof v === 'string' ? v : null;

/** `changes_json` → the DTO's list (stored order; malformed entries read as nulls). */
export function auditChanges(text: string | null): SnapshotAuditDto['changes'] {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed).map(([key, value]) => ({
    key,
    before: isRecord(value) ? cell(value.before) : null,
    after: isRecord(value) ? cell(value.after) : null,
  }));
}

/** `detail_json` → the DTO's record context (null when the row has none). */
export function auditDetail(text: string | null): SnapshotAuditDto['detail'] {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) return null;
  const mode = parsed.marketMode;
  return {
    pricesAsOf: typeof parsed.pricesAsOf === 'string' ? parsed.pricesAsOf : null,
    marketMode:
      typeof mode === 'string' && (MARKET_DATA_MODES as readonly string[]).includes(mode)
        ? (mode as MarketDataMode)
        : null,
    pricesRefreshed: typeof parsed.pricesRefreshed === 'boolean' ? parsed.pricesRefreshed : null,
  };
}

export function snapshotAuditDto(row: SnapshotAuditRow): SnapshotAuditDto {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    action: row.action,
    trigger: row.trigger,
    at: row.at,
    note: row.note,
    changes: auditChanges(row.changesJson),
    detail: auditDetail(row.detailJson),
  };
}
