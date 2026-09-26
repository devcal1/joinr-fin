// The Stage 5 engine inputs the server builds (stage-5.md §4.5 "Engine inputs built by the server",
// §7.4 step 1), row by row, on the generic seed (three migrated months) plus one recorded month:
// the snapshots in run-date order with their extras, the trades by kind, the D88b savings offset
// rule (stored figures, the last migrated month's Stage 4 derivation, earlier nulls, no offset
// account at all), the D88a measured-through input, the chart view (the query over the settings,
// the year basis), the aggregation rows, the savings tracker's total, the record planning helpers
// and the allocation targets' sum. Generic values only.
import { SNAPSHOT_FIGURE_COLUMNS } from '@joinr/schema';
import { cashAccounts, settings, snapshots } from '@joinr/schema/db';
import {
  createTestDb,
  seedGenericData,
  seedRecordedMonth,
  type TestDb,
} from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSuperInput } from '../../src/assets/inputs';
import { liveOffsetsKnown, savingsSnapshots } from '../../src/cashflow/inputs';
import {
  allocationSumRatio,
  chartViewOf,
  defaultRecordMonths,
  endedMonths,
  engineSnapshots,
  figuresOf,
  gapMonths,
  nextIsoMonth,
  seriesRows,
  toEngineSnapshot,
  trackerCents,
  tradesByKind,
} from '../../src/history/inputs';
import { loadInvestmentData, rowsOfKind, type InvestmentData } from '../../src/investments/load';
import { figures } from './helpers';
import { AS_OF, NOW } from '../investments/helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

const data = (): InvestmentData => loadInvestmentData(t.db);

function putSetting(key: string, value: unknown, origin: 'import' | 'app' = 'import'): void {
  const row = { key, valueJson: JSON.stringify(value), updatedAt: NOW.toISOString(), origin };
  t.db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson, origin } })
    .run();
}

/** One recorded month after the seed's three migrated months (offsets $15,000, $10,000 linked). */
const recordAugust = () =>
  seedRecordedMonth(t.db, { periodMonth: '2026-08', runDate: '2026-08-31' });

describe('the snapshots (§4.5 "EngineSnapshot")', () => {
  it('keeps every figure column, the identity and the source; the extras as stored', () => {
    recordAugust();
    const rows = data().snapshots;
    const migrated = toEngineSnapshot(rows[0]!);
    expect(Object.keys(figuresOf(migrated)).sort()).toEqual([...SNAPSHOT_FIGURE_COLUMNS].sort());
    expect(migrated).toMatchObject({
      periodMonth: '2026-05',
      runDate: '2026-05-31',
      source: 'migrated',
      offsetCents: null,
      mortgageOffsetCents: null,
      cashDebtCents: null,
      superMeasuredThrough: null,
    });
    // Nothing but the figures and the identity (no id, origin, note or revision).
    expect(Object.keys(migrated)).toHaveLength(SNAPSHOT_FIGURE_COLUMNS.length + 3);
    const recorded = toEngineSnapshot(rows[3]!);
    expect(recorded).toMatchObject({
      source: 'recorded',
      offsetCents: 1500000,
      mortgageOffsetCents: 1000000,
      cashDebtCents: -30000,
      superMeasuredThrough: '2026-08-27',
    });
  });

  it('orders them by run date, then period month (months recorded together keep their order)', () => {
    // Two months recorded on one day (§2.9): August and September share a run date.
    seedRecordedMonth(t.db, { periodMonth: '2026-09', runDate: '2026-10-01' });
    seedRecordedMonth(t.db, { periodMonth: '2026-08', runDate: '2026-10-01' });
    const ordered = engineSnapshots(data().snapshots);
    expect(ordered.map((s) => `${s.periodMonth}@${s.runDate}`)).toEqual([
      '2026-05@2026-05-31',
      '2026-06@2026-06-30',
      '2026-07@2026-07-31',
      '2026-08@2026-10-01',
      '2026-09@2026-10-01',
    ]);
  });

  it('groups every trade by its instrument kind (every trade counts, D37)', () => {
    const d = data();
    const byKind = tradesByKind(d);
    for (const kind of ['stock', 'etf', 'managed_fund', 'crypto'] as const) {
      expect(byKind[kind].map((x) => x.id)).toEqual(rowsOfKind(d, kind).trades.map((x) => x.id));
    }
    expect(Object.values(byKind).flat()).toHaveLength(d.trades.length);
  });
});

describe('the savings offset figures (§4.5, D88b)', () => {
  const offsetsOf = () => savingsSnapshots(data()).map((s) => s.offsetCents);

  it('migrated only: the Stage 4 rule (the last migrated month derived, earlier null)', () => {
    expect(offsetsOf()).toEqual([null, null, 1000000]);
    expect(liveOffsetsKnown(data())).toBe(true);
  });

  it('a recorded month passes its stored figure; the last migrated month keeps the derivation', () => {
    recordAugust();
    expect(offsetsOf()).toEqual([null, null, 1000000, 1500000]);
  });

  it('the seam is the last migrated month by source, even when a later month is recorded', () => {
    recordAugust();
    seedRecordedMonth(t.db, { periodMonth: '2026-09', runDate: '2026-09-30' });
    expect(offsetsOf()).toEqual([null, null, 1000000, 1500000, 1500000]);
  });

  it('no offset account: migrated months null, stored figures still passed, live known', () => {
    t.db.update(cashAccounts).set({ isOffset: false }).run();
    expect(offsetsOf()).toEqual([null, null, null]);
    expect(liveOffsetsKnown(data())).toBe(false);
    recordAugust();
    expect(offsetsOf()).toEqual([null, null, null, 1500000]);
    expect(liveOffsetsKnown(data())).toBe(true);
  });
});

describe('the super measured-through input (§2.11, §4.5, D88a)', () => {
  it('passes each snapshot’s stored date (null on migrated rows), in run-date order', () => {
    recordAugust();
    const input = buildSuperInput(data(), AS_OF);
    expect(input.snapshots.map((s) => s.measuredThrough)).toEqual([null, null, null, '2026-08-27']);
  });
});

describe('the chart view (§4.5 "charts")', () => {
  it('defaults to monthly, all groups, FY', () => {
    expect(chartViewOf(data().settings)).toEqual({ unit: 'monthly', count: null, yearBasis: 'fy' });
  });

  it('reads the settings, and the query overrides them for this response only', () => {
    putSetting('charts.dateUnit', 'quarterly', 'app');
    putSetting('charts.unitCount', 8);
    putSetting('savings.yearBasis', 'calendar', 'app');
    const s = data().settings;
    expect(chartViewOf(s)).toEqual({ unit: 'quarterly', count: 8, yearBasis: 'calendar' });
    expect(chartViewOf(s, { unit: 'yearly' })).toEqual({
      unit: 'yearly',
      count: 8,
      yearBasis: 'calendar',
    });
    expect(chartViewOf(s, { unit: 'monthly', count: 24 })).toEqual({
      unit: 'monthly',
      count: 24,
      yearBasis: 'calendar',
    });
    // Nothing was saved.
    expect(
      t.db.select().from(settings).where(eq(settings.key, 'charts.dateUnit')).get(),
    ).toMatchObject({ valueJson: '"quarterly"' });
  });
});

describe('the aggregation rows and the tracker (§2.7, §5)', () => {
  it('lists every snapshot, then the live row flagged live', () => {
    const snaps = engineSnapshots(data().snapshots);
    const live = {
      periodMonth: '2026-08',
      runDate: AS_OF,
      figures: figures({ cashValueCents: 1 }),
    };
    const rows = seriesRows(snaps, live);
    expect(rows.map((r) => [r.periodMonth, r.live])).toEqual([
      ['2026-05', false],
      ['2026-06', false],
      ['2026-07', false],
      ['2026-08', true],
    ]);
    expect(rows[0]!.figures).toEqual(figuresOf(snaps[0]!));
    expect(rows[3]!.figures).toBe(live.figures);
    expect(seriesRows(snaps, null)).toHaveLength(3);
  });

  it('the tracker sums the five liquid classes with the historical chart’s cash', () => {
    expect(trackerCents(figures())).toBeNull();
    expect(
      trackerCents(
        figures({
          stocksValueCents: 100,
          etfValueCents: 200,
          cryptoValueCents: null,
          cashValueCents: 1000,
          mfValueCents: 50,
          offsetCents: 700,
          mortgageOffsetCents: 400,
          otherValueCents: 99999,
        }),
      ),
    ).toBe(100 + 200 + (1000 + 700 - 400) + 50);
  });
});

describe('record planning (§2.9, §4.4 `record`)', () => {
  it('the next month wraps the year', () => {
    expect(nextIsoMonth('2026-12')).toBe('2027-01');
    expect(nextIsoMonth('2026-09')).toBe('2026-10');
  });

  it('ended months are the recordable months whose last day is before today', () => {
    expect(endedMonths(['2026-07', '2026-08', '2026-09'], '2026-09-30')).toEqual([
      '2026-07',
      '2026-08',
    ]);
    expect(endedMonths(['2026-09'], '2026-10-01')).toEqual(['2026-09']);
  });

  it('defaults to the ended months, else the current month, else none', () => {
    expect(defaultRecordMonths(['2026-08', '2026-09'], '2026-09-14')).toEqual(['2026-08']);
    expect(defaultRecordMonths(['2026-09'], '2026-09-14')).toEqual(['2026-09']);
    expect(defaultRecordMonths([], '2026-09-14')).toEqual([]);
  });

  it('gaps are the months between the first and the latest snapshot with none', () => {
    expect(gapMonths([])).toEqual([]);
    expect(gapMonths(['2026-05', '2026-06'])).toEqual([]);
    expect(gapMonths(['2026-12', '2026-09', '2027-02'])).toEqual(['2026-10', '2026-11', '2027-01']);
  });
});

describe('the allocation targets’ sum (§4.4, §6.5 item 4)', () => {
  it('is null when none is set, else Σ of the set targets (unrounded)', () => {
    t.db.delete(settings).run();
    expect(allocationSumRatio(data().settings)).toBeNull();
    putSetting('allocation.etf', '0.5');
    putSetting('allocation.cash', '0.27');
    putSetting('allocation.crypto', '0.25');
    expect(allocationSumRatio(data().settings)).toBe('1.02');
  });

  it('ignores snapshots entirely (a pure settings figure)', () => {
    t.db.delete(snapshots).run();
    expect(allocationSumRatio(data().settings)).not.toBeUndefined();
  });
});
