// Server golden (stage-5.md §9.4): the local workbook imported with corrections OFF → DB → the
// History and Net Worth API → a recorded month, compared with the workbook's own cached cells (read
// at runtime: History, the rolling table `Net Worth!K:T`, the WorkingSheet History block) and with
// the other pages' APIs. Nothing here holds an owner value: only template cell references and
// rules. Gated on the Stage 5 engine and importer; skipped when the workbook is absent. Prints
// counts only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import { importWorkbook, readWorkbook, type WorkbookReader } from '@joinr/importer';
import {
  describeWithLocalWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  IMPORTER_STAGE4_IMPLEMENTED,
  IMPORTER_STAGE5_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  centsFromNumber,
  INSTRUMENT_KINDS,
  isoMonthOf,
  SNAPSHOT_COLUMN_MODES,
  SNAPSHOT_FIGURE_COLUMNS,
  type CashPageResponse,
  type HistoryPageResponse,
  type HistorySeriesResponse,
  type InvestmentPageResponse,
  type IsoDate,
  type IsoMonth,
  type NetWorthPageResponse,
  type OtherAssetsPageResponse,
  type PropertyPageResponse,
  type RecordResponse,
  type SavingsPeriodDto,
  type SnapshotFiguresDto,
  type SuperPageResponse,
} from '@joinr/schema';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { nextIsoMonth } from '../../src/history/inputs';
import type { Clock } from '../../src/scheduler/types';
import { makeTempDir, removeDir, testConfig } from '../helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED &&
  IMPORTER_STAGE5_IMPLEMENTED;

// ─── Counting (§9.3 rule 12) ────────────────────────────────────────────────────────────────────

type Reason = 'first_period' | 'live_row' | 'never' | 'label_format';
interface Tally {
  compared: number;
  recomputed: number;
  skipped: Partial<Record<Reason, number>>;
}
const tallies: Record<string, Tally> = {};
function tally(area: string): Tally {
  tallies[area] ??= { compared: 0, recomputed: 0, skipped: {} };
  return tallies[area];
}
const skip = (area: string, reason: Reason) => {
  const t = tally(area);
  t.skipped[reason] = (t.skipped[reason] ?? 0) + 1;
};

/** Sheet dollars → cents (half away from zero); null for a blank. */
const cents = (v: number | null): number | null => (v === null ? null : centsFromNumber(v));

/** `|ours − sheet| ≤ tol` cents, or both null. */
function within(
  area: string,
  ours: number | null,
  sheet: number | null,
  tol: number,
  what: string,
) {
  tally(area).compared += 1;
  if (sheet === null || ours === null) {
    expect(ours, what).toBe(sheet);
    return;
  }
  expect(Math.abs(ours - sheet), what).toBeLessThanOrEqual(tol);
}

// ─── The sheet's rows (detected at runtime, §9.3) ───────────────────────────────────────────────

interface HistoryRow {
  row: number;
  date: IsoDate;
  frozen: boolean;
}

/** Every History row with a date in A (row 3 on): frozen (no formula in B) or formula (live). */
function historyRows(r: WorkbookReader): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (let row = 3; row <= r.lastRow('History'); row++) {
    const date = r.date('History', `A${row}`);
    if (date === null) continue;
    const b = r.cell('History', `B${row}`);
    out.push({ row, date, frozen: b !== null && b.formula === null });
  }
  return out;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A WorkingSheet label (the full month name and year) → its month; null for anything else. */
function monthOfLabel(label: string | null): IsoMonth | null {
  const m = label === null ? null : /^([A-Za-z]+) (\d{4})$/.exec(label.trim());
  if (!m) return null;
  const i = MONTH_NAMES.indexOf(m[1]!);
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
}

/** The spreadsheet column `n` (0-based) → letters. */
function column(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** The 36 History columns B…AK, as figure keys (the WorkingSheet block's F…AO). */
const HISTORY_KEYS = SNAPSHOT_FIGURE_COLUMNS.slice(0, 36);
const isMoney = (k: string) => !k.endsWith('Ratio');

// ─── The test ───────────────────────────────────────────────────────────────────────────────────

describeWithLocalWorkbook('history server golden (import → DB → API → record)', (workbookPath) => {
  describe.skipIf(!GATED)(
    'corrections off, market off, as of the workbook date',
    { timeout: 180_000 },
    () => {
      let tempDir: string;
      let database: AppDatabase;
      let app: FastifyInstance;
      let r: WorkbookReader;
      let rows: HistoryRow[];
      let history: HistoryPageResponse;
      let netWorth: NetWorthPageResponse;

      const get = async <T>(url: string): Promise<T> => {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        return res.json<T>();
      };

      beforeAll(async () => {
        const bytes = new Uint8Array(readFileSync(workbookPath));
        r = readWorkbook(bytes);
        const e52 = r.date('Net Worth', 'E52');
        if (e52 === null) throw new Error('Net Worth!E52 is not a date');
        const [y, m, d] = e52.split('-').map(Number) as [number, number, number];
        const now = new Date(y, m - 1, d, 12, 0, 0);
        rows = historyRows(r);

        tempDir = await makeTempDir('joinr-golden-history-');
        const config = testConfig(join(tempDir, 'data'));
        database = openDatabase(config.dataDir);
        runMigrations(database, config.migrationsDir);
        const result = importWorkbook(database.db, {
          bytes,
          fileName: 'workbook.xlsx',
          trigger: 'cli',
          corrections: null,
          now: () => now,
        });
        expect(result.status).toBe('succeeded');
        // The recorder's timers never fire (a fake clock); its dates come from the same `now`.
        const clock: Clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined };
        app = await buildApp({ config, db: database, now: () => now, recorderClock: clock });
        history = await get<HistoryPageResponse>('/api/history');
        netWorth = await get<NetWorthPageResponse>('/api/net-worth');
        expect(history.asOf).toBe(e52);
      }, 180_000);

      afterAll(async () => {
        await app?.close();
        if (tempDir) await removeDir(tempDir);
        for (const [area, t] of Object.entries(tallies)) {
          console.log(
            `[golden:server:history] ${area} compared: ${t.compared} · skipped: ${JSON.stringify(t.skipped)} · recomputed: ${t.recomputed}`,
          );
        }
      });

      it('recomputing the migrated snapshots reproduces the stored values (the PLAN acceptance)', () => {
        const c = history.consistency;
        expect(c.migratedMonths).toBeGreaterThan(0);
        expect(c.migratedMatched).toBe(c.migratedChecked);
        expect(c.derivedMatchedMonths).toBe(c.migratedMonths);
        expect(c.derivedDifferences).toBe(0);
        expect(c.movementDifferences).toBe(0);
        tally('consistency').compared += c.migratedChecked;
      });

      it('the next month to record follows the last History row; the live row is present', () => {
        const lastFrozen = rows.filter((x) => x.frozen).at(-1)!;
        expect(history.record.nextMonth).toBe(nextIsoMonth(isoMonthOf(lastFrozen.date)));
        expect(history.live).not.toBeNull();
        expect(netWorth.rolling.some((x) => x.status === 'live')).toBe(true);
      });

      it('the rolling table matches Net Worth!K:T on every frozen row (rule 3)', () => {
        const byRunDate = new Map(
          netWorth.rolling.filter((x) => x.status === 'recorded').map((x) => [x.runDate, x]),
        );
        let first = true;
        for (const h of rows) {
          const area = 'rolling';
          if (!h.frozen) {
            skip(area, 'live_row');
            continue;
          }
          const ours = byRunDate.get(h.date);
          if (!ours || ours.netWorth === null) {
            skip(area, 'never');
            continue;
          }
          // Net Worth row i holds History row i + 1 (K2 = History!A3).
          const nw = h.row - 1;
          const n = (c: string) => cents(r.number('Net Worth', `${c}${nw}`));
          within(area, ours.netWorth.liquidCents, n('L'), 3, `L${nw}`);
          within(area, ours.netWorth.netWorthCents, n('P'), 5, `P${nw}`);
          if (first) {
            skip(area, 'first_period');
            first = false;
            continue;
          }
          within(area, ours.growthCents, n('Q'), 9, `Q${nw}`);
          within(area, ours.liquidGrowthCents, n('R'), 6, `R${nw}`);
        }
      });

      it('assets − liabilities = net worth; the classes equal the other pages’ figures', async () => {
        expect(netWorth.assetsCents - netWorth.liabilitiesCents).toBe(
          netWorth.live.netWorth.netWorthCents,
        );
        const value = (key: string) => netWorth.classes.find((c) => c.key === key)!.valueCents;
        const area = 'cross_api';
        for (const kind of INSTRUMENT_KINDS) {
          const page = await get<InvestmentPageResponse>(`/api/investments/${kind}`);
          tally(area).compared += 1;
          expect(value(kind), kind).toBe(page.summary.valueCents);
        }
        const cash = await get<CashPageResponse>('/api/cash');
        const positive = cash.accounts
          .filter((a) => !a.isOffset && a.balanceCents > 0)
          .reduce((s, a) => s + a.balanceCents, 0);
        const other = await get<OtherAssetsPageResponse>('/api/other-assets');
        const sup = await get<SuperPageResponse>('/api/super');
        const property = await get<PropertyPageResponse>('/api/property');
        for (const [key, expected] of [
          ['cash', positive],
          ['other_assets', other.totals.valueCents],
          ['super', sup.totalCents],
          ['property', property.totals.valueCents],
        ] as const) {
          tally(area).compared += 1;
          expect(value(key), key).toBe(expected);
        }
      });

      it('monthly groups equal the WorkingSheet History block’s frozen groups (cents)', async () => {
        const series = await get<HistorySeriesResponse>(
          '/api/history/series?unit=monthly&count=240',
        );
        const byPeriod = new Map(series.groups.map((g) => [g.period, g]));
        const liveMonths = new Set(rows.filter((x) => !x.frozen).map((x) => isoMonthOf(x.date)));
        const area = 'working_sheet';
        for (let row = 3; row <= r.lastRow('WorkingSheet'); row++) {
          const label = r.text('WorkingSheet', `E${row}`);
          if (label === null || label.trim() === '') continue;
          const month = monthOfLabel(label);
          if (month === null) {
            skip(area, 'label_format');
            continue;
          }
          if (liveMonths.has(month)) {
            skip(area, 'live_row');
            continue;
          }
          const group = byPeriod.get(month);
          if (!group) {
            skip(area, 'never');
            continue;
          }
          HISTORY_KEYS.forEach((key, i) => {
            if (!isMoney(key)) return;
            const sheet = cents(r.number('WorkingSheet', `${column(5 + i)}${row}`));
            const ours = group.figures[key] as number | null;
            if (sheet === null) {
              // A blank block cell reads as an empty (or zero) figure.
              tally(area).compared += 1;
              expect(ours === null || ours === 0, `${column(5 + i)}${row}`).toBe(true);
              return;
            }
            within(area, ours, sheet, 1, `${column(5 + i)}${row}`);
          });
        }
      });

      it('quarterly and yearly groups: every `end` column is the group’s last row', async () => {
        const byMonth = new Map(history.snapshots.map((s) => [s.periodMonth, s.figures]));
        const endKeys = SNAPSHOT_FIGURE_COLUMNS.filter((k) => SNAPSHOT_COLUMN_MODES[k] === 'end');
        for (const unit of ['quarterly', 'yearly'] as const) {
          const series = await get<HistorySeriesResponse>(`/api/history/series?unit=${unit}`);
          const area = `series_${unit}`;
          for (const g of series.groups) {
            const last: SnapshotFiguresDto | undefined = g.live
              ? history.live?.figures
              : byMonth.get(g.period);
            expect(last, g.label).toBeDefined();
            for (const k of endKeys) {
              tally(area).compared += 1;
              expect(g.figures[k], `${g.label} ${k}`).toEqual(last![k]);
            }
          }
        }
      });

      it('records the next month: it equals the live row; recorded today; then deleted', async () => {
        const liveBefore = history.live!;
        const cashBefore = await get<CashPageResponse>('/api/cash');
        const provisional = (c: CashPageResponse): SavingsPeriodDto | undefined =>
          c.periods.find((p) => p.status === 'provisional');
        const provisionalBefore = provisional(cashBefore)!;
        const month = history.record.nextMonth;
        const res = await app.inject({
          method: 'POST',
          url: '/api/history/record',
          payload: { periodMonths: [month], note: null },
        });
        expect(res.statusCode).toBe(201);
        const body = res.json<RecordResponse>();
        expect(body.hasAppData).toBe(true);
        const recorded = body.recorded[0]!;
        for (const k of SNAPSHOT_FIGURE_COLUMNS) {
          tally('record').compared += 1;
          expect(recorded.figures[k], k).toEqual(liveBefore.figures[k]);
        }
        const after = await get<NetWorthPageResponse>('/api/net-worth');
        expect(after.recordedToday).toBe(true);
        const snapshotsBefore = history.snapshots;
        expect(after.sinceLastRecord.base?.periodMonth).toBe(snapshotsBefore[0]!.periodMonth);
        const again = await app.inject({
          method: 'POST',
          url: '/api/history/record',
          payload: { periodMonths: [month], note: null },
        });
        expect(again.statusCode).toBe(409);
        expect(again.json<{ error: { code: string } }>().error.code).toBe('SNAPSHOT_EXISTS');
        const cash = await get<CashPageResponse>('/api/cash');
        expect(provisional(cash)).toBeUndefined();
        const closed = cash.periods.find((p) => p.periodMonth === month)!;
        expect(closed.adjusted.savingsCents).toBe(provisionalBefore.adjusted.savingsCents);
        expect(closed.adjusted.incomeCents).toBe(provisionalBefore.adjusted.incomeCents);
        expect(closed.adjusted.savingsRatio).toBe(provisionalBefore.adjusted.savingsRatio);
        const deleted = await app.inject({
          method: 'DELETE',
          url: `/api/history/snapshots/${month}`,
        });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json<{ hasAppData: boolean }>().hasAppData).toBe(false);
      });
    },
  );
});
