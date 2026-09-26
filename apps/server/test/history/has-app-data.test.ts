// `hasAppData` for the Stage 5 entities (stage-5.md §3.4, §7.4 step 6, D34, D84, D91, D95): a
// recorded month counts and deleting it clears it again; a correction of an imported month counts;
// the audit log, the recorder's app_meta state and `history.autoRecord` never count; an app edit of a
// preference key (`features.*`, `charts.*`) does not count, while an app edit of an unused workbook
// key does. On the import-only generic seed. Generic values only.
import { appMeta, settings, snapshotAudit, snapshots } from '@joinr/schema/db';
import {
  createTestDb,
  seedGenericData,
  seedRecordedMonth,
  type TestDb,
} from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasAppData } from '../../src/db/queries/domain';
import { correctSnapshot } from '../../src/history/mutations';
import { NOW } from '../investments/helpers';
import { historyFakeEngine } from './helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

function appSetting(key: string, value: unknown): void {
  const row = {
    key,
    valueJson: JSON.stringify(value),
    updatedAt: NOW.toISOString(),
    origin: 'app' as const,
  };
  t.db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson, origin: 'app' } })
    .run();
}

describe('hasAppData and the Stage 5 entities (§3.4)', () => {
  it('starts false on the import-only seed', () => {
    expect(hasAppData(t.db)).toBe(false);
  });

  it('a recorded month counts; deleting it makes it false again', () => {
    const { snapshotId } = seedRecordedMonth(t.db, {
      periodMonth: '2026-08',
      runDate: '2026-08-31',
    });
    expect(hasAppData(t.db)).toBe(true);
    t.db.delete(snapshots).where(eq(snapshots.id, snapshotId)).run();
    // The audit row of the record stays (a log, never app data).
    expect(t.db.select().from(snapshotAudit).all()).toHaveLength(1);
    expect(hasAppData(t.db)).toBe(false);
  });

  it('a correction of an imported month counts', () => {
    const month = t.db.select().from(snapshots).where(eq(snapshots.periodMonth, '2026-06')).get()!;
    correctSnapshot(
      { database: t, engine: historyFakeEngine() },
      '2026-06',
      {
        values: { stocksValueCents: month.stocksValueCents! + 100 },
        note: 'Broker statement',
      },
      NOW,
    );
    expect(hasAppData(t.db)).toBe(true);
  });

  it('the recorder’s state and history.autoRecord never count', () => {
    t.db
      .insert(appMeta)
      .values({
        key: 'snapshot.autoRecordSince',
        value: '2026-09-01',
        updatedAt: NOW.toISOString(),
      })
      .run();
    appSetting('history.autoRecord', true);
    expect(hasAppData(t.db)).toBe(false);
  });

  it('a preference key edited in the app does not count (D95)', () => {
    appSetting('features.crypto', false);
    appSetting('charts.dateUnit', 'quarterly');
    appSetting('charts.unitCount', 8);
    expect(hasAppData(t.db)).toBe(false);
  });

  it('an unused workbook key edited in the app counts (D91)', () => {
    appSetting('goals.housePriceTargetCents', 80000000);
    expect(hasAppData(t.db)).toBe(true);
  });
});
