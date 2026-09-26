// Stage 5 goldens (stage-5.md §9.2–§9.5): the history, net-worth and aggregation engines on
// sheet-faithful inputs against the local workbook's cached cells. Skipped when reference/ holds no
// single workbook. Every expected value is read at runtime; this file holds template cell
// references and rules only, and prints counts only (compared, skipped by reason, recomputed by
// reason). TODAY()-dependent cells are compared at the workbook's as-of (Net Worth!E52).
import {
  centsFromNumber,
  INSTRUMENT_KINDS,
  isoMonthOf,
  SNAPSHOT_CHECK_COLUMNS,
  SNAPSHOT_FIGURE_COLUMNS,
  type ChartDateUnit,
  type InstrumentKind,
  type NetWorthClass,
  type YearBasis,
} from '@joinr/schema';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aggregateSnapshots,
  checkSnapshots,
  compressCashflow,
  deriveSnapshotColumns,
  netWorthDashboard,
  nextRecordMonth,
  rollingNetWorth,
  type CashKpisResult,
  type ConsiderNextResult,
  type NetWorthDashboardResult,
  type RollingNetWorthRow,
  type SnapshotCheckResult,
  type SnapshotFigures,
  type SnapshotGroup,
  type SnapshotSeriesRow,
} from '../../src/index';
import { RATIO_CHECKS, type RatioColumn } from '../../src/snapshot';
import { Sheet } from './adapter';
import { SUPER } from './assetsAdapter';
import { monthEnd } from './cashflowAdapter';
import { readCashRows, recomputeKpis } from './cashflowFormulas';
import { columnOf, HISTORY_COLUMNS, HistorySheet, type HistoryColumn } from './historyAdapter';
import {
  calendarMeanRate,
  compress,
  groupKey,
  historyDoubles,
  monthOfLabel,
  rollingOf,
  SHEET_BLOCK_SUM_COLUMNS,
  sheetRatioOf,
} from './historyFormulas';
import { HistoryTally, type HistoryRecomputeReason } from './historyTally';

const GOLDEN_TIMEOUT = 120_000;
const NO_ALLOCATION: ConsiderNextResult = { assetClass: null, reason: 'no_targets', rows: [] };
/** Parts of the net-worth totals (§9.5): L has 6, N 2, P 9 (L + M + N + O). */
const PARTS = { L: 6, N: 2, P: 9 } as const;

/** A spreadsheet column letter from its 1-based index. */
function letterOf(index: number): string {
  let out = '';
  for (let k = index; k > 0; k = Math.floor((k - 1) / 26))
    out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}
/** The WorkingSheet History block column of a History column (History B → WorkingSheet F). */
const blockLetter = (col: HistoryColumn): string => letterOf(6 + HISTORY_COLUMNS.indexOf(col));
const ratioInputs = (key: RatioColumn) => RATIO_CHECKS[key];
const isRatioKey = (key: string): key is RatioColumn => Object.hasOwn(RATIO_CHECKS, key);

describeWithLocalWorkbook(
  'golden: the Stage 5 history and net-worth engines against the local workbook',
  () => {
    describe('cached cells', { timeout: GOLDEN_TIMEOUT }, () => {
      let h: HistorySheet;
      let live: SnapshotFigures;
      let liveMonth: string;
      let check: SnapshotCheckResult;
      let kpisFy: CashKpisResult;
      let seriesRows: SnapshotSeriesRow[];
      const tallies: HistoryTally[] = [];
      const tallyOf = (area: string) => {
        const t = new HistoryTally(area);
        tallies.push(t);
        return t;
      };
      /** Adapter validations (a helper recomputes a cell the goldens skip; never counted). */
      const validations: string[] = [];
      const validate = (ref: string, ok: boolean) => {
        if (!ok) validations.push(ref);
      };

      beforeAll(() => {
        const bytes = readLocalWorkbookBytes();
        if (bytes === null) throw new Error('golden: the local workbook could not be read');
        h = new HistorySheet(new Sheet(readWorkbook(bytes)));
        live = h.compose();
        liveMonth = nextRecordMonth(h.snapshots, h.asOf);
        check = checkSnapshots({ snapshots: h.snapshots, trades: h.trades });
        kpisFy = h.kpis('fy');
        seriesRows = [
          ...h.snapshots.map((s) => ({
            periodMonth: s.periodMonth,
            runDate: s.runDate,
            live: false,
            figures: s,
          })),
          { periodMonth: liveMonth, runDate: h.asOf, live: true, figures: live },
        ];
      }, GOLDEN_TIMEOUT);

      afterAll(() => {
        // Counts only (§9.3 rule 12): never a value, a name or a note.
        for (const t of tallies) console.log(t.line());
        console.log(`[golden] Stage 5 adapter validations: failed: ${validations.length}`);
      });

      it('History derived columns: the recomputation and the sheet cells (rule 1)', () => {
        const t = tallyOf('History derived');
        const cells = tallyOf('History derived (sheet cells)');
        expect(check.rows.length).toBe(h.snapshots.length);
        h.snapshots.forEach((s, k) => {
          const row = h.kept[k]!.row;
          const diffs = check.rows[k]!.differences;
          const prev = k === 0 ? undefined : h.snapshots[k - 1]!.cashValueCents;
          const derived = deriveSnapshotColumns({ figures: s, previousCashValueCents: prev });
          const doubles = historyDoubles(h.wb, row);
          for (const column of SNAPSHOT_CHECK_COLUMNS) {
            if (column.endsWith('MovementsCents')) continue;
            const col = columnOf(column);
            const ref = `History!${col.letter}${row}`;
            if (column === 'cashGainCents' && k === 0) {
              t.skip('first_period'); // the typed seed
              cells.skip('first_period');
              continue;
            }
            t.check(`${ref} derived`, !diffs.some((d) => d.column === column));
            const cached = doubles(col.letter);
            if (isRatioKey(column)) {
              const [gain, value] = ratioInputs(column);
              cells.ratioOfCents(`${ref} sheet cell`, cached, s[gain], s[value]);
              const [gl, vl] = [columnOf(gain).letter, columnOf(value).letter];
              validate(`${ref} formula`, near(sheetRatioOf(doubles(gl), doubles(vl)), cached));
            } else if (column === 'cashGainCents') {
              cells.money(`${ref} sheet cell`, cached, derived.cashGainCents);
            } else {
              cells.money(`${ref} sheet cell`, cached, derived.propertyEquityCents);
            }
          }
        });
        expect(t.failures).toEqual([]);
        expect(cells.failures).toEqual([]);
        expect(validations).toEqual([]);
      });

      it('History movements: the net purchases of every kind per window (rule 2)', () => {
        const t = tallyOf('History movements');
        h.snapshots.forEach((s, k) => {
          const row = h.kept[k]!.row;
          for (const column of SNAPSHOT_CHECK_COLUMNS) {
            if (!column.endsWith('MovementsCents')) continue;
            const ref = `History!${columnOf(column).letter}${row} movements`;
            t.check(ref, !check.rows[k]!.differences.some((d) => d.column === column));
          }
        });
        expect(check.rows.every((r) => r.differences.length === 0)).toBe(true);
        expect(t.failures).toEqual([]);
      });

      it('Net Worth!K2:T: the rolling net-worth table (rules 3, 4)', () => {
        const t = tallyOf('Rolling net worth');
        const rows = rollingNetWorth({
          snapshots: h.snapshots,
          live: { periodMonth: liveMonth, runDate: h.asOf, figures: live },
          savings: h.savings.periods,
          projection: { monthlyCents: kpisFy.avgSavingsCents, months: 12 },
        });
        const recorded = rows.filter((r) => r.status === 'recorded');
        const byDate = new Map<string, RollingNetWorthRow>(recorded.map((r) => [r.runDate!, r]));
        for (let r = 2; r <= 1300; r++) {
          const date = h.wb.date('Net Worth', `K${r}`);
          if (date === null) break;
          const historyRow = r + 1; // K2 = History!A3
          if (h.live !== null && historyRow === h.live.row) {
            t.skip('live_row', 9); // rule 3: the broken live totals; T and S with it
            continue;
          }
          const e = byDate.get(date);
          if (e === undefined || !h.kept.some((x) => x.row === historyRow)) {
            t.skip('never', 9); // a second row in one month is never imported
            continue;
          }
          const cell = (col: string) => h.wb.number('Net Worth', `${col}${r}`);
          const ref = (col: string) => `Net Worth!${col}${r}`;
          const b = e.breakdown!;
          t.sumMoney(ref('L'), cell('L'), b.liquidCents, PARTS.L);
          t.money(ref('M'), cell('M'), b.superCents);
          t.sumMoney(ref('N'), cell('N'), b.liabilitiesCents, PARTS.N);
          t.money(ref('O'), cell('O'), b.propertyCents);
          t.sumMoney(ref('P'), cell('P'), b.netWorthCents, PARTS.P);
          if (e === recorded[0]) {
            t.skip('first_period', 4); // Q–T hold "-" on the first row
            continue;
          }
          t.diffMoney(ref('Q'), cell('Q'), e.growthCents, PARTS.P);
          t.diffMoney(ref('R'), cell('R'), e.liquidGrowthCents, PARTS.L);
          t.rate(ref('S'), cell('S'), e.rawSavingsRatio); // rule 4: the raw rate (Cash!M)
          t.sumMoney(ref('T'), cell('T'), e.projectedLiquidCents, PARTS.L);
        }
        // The projection (§11 fix 8): 12 months after the live one, only with an average.
        const projected = rows.filter((r) => r.status === 'projected');
        validate(
          'rolling projection rows',
          projected.length === (kpisFy.avgSavingsCents === null ? 0 : 12),
        );
        expect(t.failures).toEqual([]);
        expect(t.compared).toBeGreaterThan(0);
        expect(validations).toEqual([]);
      });

      it('WorkingSheet!E3:AO: the History block at the sheet’s unit and count (rule 5)', () => {
        const t = tallyOf('WorkingSheet History block');
        const { unit, count } = h.chartSettings();
        const groups = aggregateSnapshots({ rows: seriesRows, unit, count, yearBasis: 'calendar' });
        const sheetRows = blockRows('E');
        validate('WorkingSheet History block group count', sheetRows.length === groups.length);
        sheetRows.forEach((r, k) => {
          const g = groups[k];
          t.skip('label_format'); // "March 2024" in the sheet, "Mar 2024" in the app
          if (g === undefined) {
            t.check(`WorkingSheet!E${r} (no engine group)`, false);
            return;
          }
          if (g.live) {
            t.skip('live_row', HISTORY_COLUMNS.length + 1);
            return;
          }
          t.exact(
            `WorkingSheet!E${r} month`,
            monthOfLabel(h.wb.text('WorkingSheet', `E${r}`)),
            g.period,
          );
          for (const col of HISTORY_COLUMNS) {
            const ref = `WorkingSheet!${blockLetter(col)}${r}`;
            const sheet = h.wb.number('WorkingSheet', `${blockLetter(col)}${r}`);
            compareBlockCell(t, ref, col, sheet, g, undefined);
          }
        });
        expect(t.failures).toEqual([]);
        expect(validations).toEqual([]);
      });

      it('WorkingSheet!BN3:BW: the Net Worth block (rule 5)', () => {
        const t = tallyOf('WorkingSheet Net Worth block');
        const { unit, count } = h.chartSettings();
        const groups = aggregateSnapshots({ rows: seriesRows, unit, count, yearBasis: 'calendar' });
        const cash = compressCashflow({
          periods: h.savings.periods,
          unit,
          count,
          yearBasis: 'calendar',
        });
        const sheetRows = blockRows('BN');
        validate('WorkingSheet Net Worth block group count', sheetRows.length === groups.length);
        sheetRows.forEach((r, k) => {
          const g = groups[k];
          t.skip('label_format');
          if (g === undefined) {
            t.check(`WorkingSheet!BN${r} (no engine group)`, false);
            return;
          }
          validate(
            `WorkingSheet!BN${r} month`,
            monthOfLabel(h.wb.text('WorkingSheet', `BN${r}`)) === g.period,
          );
          if (g.live) {
            t.skip('live_row', 9);
            return;
          }
          const cell = (col: string) => h.wb.number('WorkingSheet', `${col}${r}`);
          const ref = (col: string) => `WorkingSheet!${col}${r}`;
          t.sumMoney(ref('BO'), cell('BO'), g.netWorth.liquidCents, PARTS.L);
          t.money(ref('BP'), cell('BP'), g.netWorth.superCents);
          t.sumMoney(ref('BQ'), cell('BQ'), g.netWorth.liabilitiesCents, PARTS.N);
          t.money(ref('BR'), cell('BR'), g.netWorth.propertyCents);
          t.sumMoney(ref('BS'), cell('BS'), g.netWorth.netWorthCents, PARTS.P);
          t.diffMoney(ref('BT'), cell('BT'), g.growthCents, PARTS.P * g.rows);
          t.diffMoney(ref('BU'), cell('BU'), g.liquidGrowthCents, PARTS.L * g.rows);
          const point = cash.find((p) => p.period === g.period) ?? null;
          if (g.rows === 1) t.rate(ref('BV'), cell('BV'), point?.savingsRawRatio ?? null);
          else t.skip('defined_by_decision'); // an average of rates vs income-weighted (D61)
          t.sumMoney(ref('BW'), cell('BW'), g.netWorth.liquidCents, PARTS.L);
        });
        expect(t.failures).toEqual([]);
        expect(validations).toEqual([]);
      });

      it('Other units: quarterly and yearly groups recomputed from History (rule 6)', () => {
        const cases: {
          area: string;
          unit: ChartDateUnit;
          basis: YearBasis;
          key: 'quarterly' | 'calendar' | 'fy';
          reason: HistoryRecomputeReason;
        }[] = [
          {
            area: 'Other units: quarterly',
            unit: 'quarterly',
            basis: 'fy',
            key: 'quarterly',
            reason: 'other_unit',
          },
          { area: 'Other units: FY', unit: 'yearly', basis: 'fy', key: 'fy', reason: 'fy_basis' },
          {
            area: 'Other units: calendar year',
            unit: 'yearly',
            basis: 'calendar',
            key: 'calendar',
            reason: 'other_unit',
          },
        ];
        for (const c of cases) {
          const t = tallyOf(c.area);
          const groups = aggregateSnapshots({
            rows: seriesRows,
            unit: c.unit,
            count: 240,
            yearBasis: c.basis,
          });
          for (const g of groups) {
            if (g.live) {
              t.skip('live_row', HISTORY_COLUMNS.length + 7);
              continue;
            }
            const members = h.kept.filter(
              (x) => groupKey(isoMonthOf(x.date), c.key) === groupKey(g.period, c.key),
            );
            validate(`${c.area} ${g.label} rows`, members.length === g.rows);
            const ref = (what: string) => `History (${c.area}, ${g.period}) ${what}`;
            for (const col of HISTORY_COLUMNS) {
              const values = members.map((x) => h.wb.number('History', `${col.letter}${x.row}`));
              if (col.ratio) {
                // The cash change % follows the summed change (§11 fix 4); the gain ratios are
                // recomputed from the group's cents (§2.7).
                t.skip(
                  col.key === 'cashIncreaseRatio' ? 'fixed_definition' : 'defined_by_decision',
                );
                continue;
              }
              if (col.key === 'cashGainCents' && g.rows > 1) {
                t.skip('fixed_definition'); // the sheet's End vs the app's sum (§11 fix 4)
                continue;
              }
              const sum = SHEET_BLOCK_SUM_COLUMNS.has(col.letter) || col.key === 'cashGainCents';
              const expected = compress(values, sum ? 'Sum' : 'End');
              t.diffMoney(
                ref(col.letter),
                expected,
                g.figures[col.key] as number | null,
                sum ? g.rows : 1,
                c.reason,
              );
            }
            // The Net Worth block: end figures from the last row, growth sums over the group.
            const lastRow = members.at(-1)!;
            const rolling = rollingOf(historyDoubles(h.wb, lastRow.row));
            t.diffMoney(ref('BO'), rolling.L, g.netWorth.liquidCents, PARTS.L, c.reason);
            t.diffMoney(ref('BP'), rolling.M, g.netWorth.superCents, 1, c.reason);
            t.diffMoney(ref('BQ'), rolling.N, g.netWorth.liabilitiesCents, PARTS.N, c.reason);
            t.diffMoney(ref('BR'), rolling.O, g.netWorth.propertyCents, 1, c.reason);
            t.diffMoney(ref('BS'), rolling.P, g.netWorth.netWorthCents, PARTS.P, c.reason);
            const growth = (pick: 'P' | 'L') => {
              let total: number | null = null;
              for (const x of members) {
                const k = h.kept.indexOf(x);
                if (k === 0) continue;
                const now = rollingOf(historyDoubles(h.wb, x.row))[pick];
                const before = rollingOf(historyDoubles(h.wb, h.kept[k - 1]!.row))[pick];
                total = (total ?? 0) + now - before;
              }
              return total;
            };
            t.diffMoney(ref('BT'), growth('P'), g.growthCents, PARTS.P * g.rows, c.reason);
            t.diffMoney(ref('BU'), growth('L'), g.liquidGrowthCents, PARTS.L * g.rows, c.reason);
          }
          expect(t.failures).toEqual([]);
        }
        expect(validations).toEqual([]);
      });

      it('Net Worth!B2:E23 and the pie: the arithmetic on the sheet’s own class cells (rule 7)', () => {
        const t = tallyOf('Net Worth arithmetic');
        const cell = (addr: string) => h.wb.number('Net Worth', addr);
        const cents = (addr: string) => {
          const n = cell(addr);
          return n === null ? null : centsFromNumber(n);
        };
        const x = cents('C11');
        const ab = cents('E21');
        const f: SnapshotFigures = {
          ...blankFigures(),
          etfValueCents: cents('C4'),
          etfGainCents: cents('D4'),
          stocksValueCents: cents('C5'),
          stocksGainCents: cents('D5'),
          mfValueCents: cents('C6'),
          mfGainCents: cents('D6'),
          cryptoValueCents: cents('C7'),
          cryptoGainCents: cents('D7'),
          cashValueCents: cents('C8'),
          otherValueCents: cents('C9'),
          otherGainCents: cents('D9'),
          superValueCents: cents('C10'),
          superGainCents: cents('D10'),
          propertyValueCents: x,
          propertyGainCents: cents('D11'),
          mortgageBalanceCents: ab,
          propertyEquityCents: x === null && ab === null ? null : (x ?? 0) + (ab ?? 0),
          liabilitiesBalanceCents: cents('E20'),
        };
        const d = dashboard(f);
        t.sumMoney('Net Worth!C12', cell('C12'), d.assetsCents, 8);
        t.sumMoney('Net Worth!C13', cell('C13'), d.assetsExSuperCents, 7);
        const cls = (key: NetWorthClass) => d.classes.find((c) => c.key === key)!;
        const ratioRows: [string, NetWorthClass][] = [
          ['E5', 'stock'],
          ['E6', 'managed_fund'],
          ['E7', 'crypto'],
          ['E9', 'other_assets'],
          ['E10', 'super'],
          ['E11', 'property'],
        ];
        for (const [addr, key] of ratioRows) {
          const c = cls(key);
          t.ratioOfCents(`Net Worth!${addr}`, cell(addr), c.gainCents, c.valueCents);
        }
        t.skip('never'); // E4: the tab's own cost-based ratio
        t.skip('fixed_definition', 5); // E8 (no cash gain), D12, D13, E12, E13 (no total gain)
        const onlyMortgage = (cell('E20') ?? 0) === 0 && h.wb.isBlank('Net Worth', 'E22');
        if (onlyMortgage)
          t.sumMoney('Net Worth!D15', cell('D15'), d.breakdown.netWorthCents, PARTS.P);
        else t.skip('not_rebuilt'); // LiabilitiesDebts (D2)
        t.sumMoney('Net Worth!D16', cell('D16'), d.breakdown.liquidCents, PARTS.L);
        // WorkingSheet!C4:C11: the pie's net values by their B labels.
        const PIE: Readonly<Record<string, NetWorthClass>> = {
          ETFs: 'etf',
          Stocks: 'stock',
          'Managed Funds': 'managed_fund',
          Crypto: 'crypto',
          'Cash Savings': 'cash',
          'Other Assets': 'other_assets',
          Super: 'super',
          Property: 'property',
        };
        for (let r = 4; r <= 11; r++) {
          const label = h.wb.text('WorkingSheet', `B${r}`);
          const key = label === null ? undefined : PIE[label];
          const sheet = h.wb.number('WorkingSheet', `C${r}`);
          if (key === undefined) {
            t.check(`WorkingSheet!B${r} (unknown class)`, false);
            continue;
          }
          const value = d.distribution.values.find((v) => v.key === key)!.valueCents;
          const reason =
            key === 'property' && sheet !== null && sheet < 0 ? 'negative_equity' : undefined;
          if (key === 'property') t.sumMoney(`WorkingSheet!C${r}`, sheet, value, 2, reason);
          else t.money(`WorkingSheet!C${r}`, sheet, value);
        }
        expect(t.failures).toEqual([]);
      });

      it('Net Worth!I1: the average savings a year over the closed rows (rule 8)', () => {
        const t = tallyOf('Net Worth I1');
        const rows = readCashRows(h.cf);
        const e = recomputeKpis(rows, {
          lastRun: h.lastRun,
          jobStart: h.wb.date('Budget', 'D2'),
          currentCash: h.wb.number('Cash', 'C13') ?? 0,
          goal: h.wb.number('Cash', 'C26'),
          target: h.wb.number('Cash', 'C31'),
        });
        const engine = kpisFy.avgSavingsRawCents === null ? null : kpisFy.avgSavingsRawCents * 12;
        // A mean of rounded cents × 12: ≤ 12 cents.
        t.diffMoney(
          'Net Worth!I1 (closed rows)',
          e.c20 === null ? null : e.c20 * 12,
          engine,
          12,
          'closed_rows',
        );
        if (h.live === null)
          t.diffMoney('Net Worth!I1', h.wb.number('Net Worth', 'I1'), engine, 12);
        // Rule 11: the sheet's gauge (Cash!C38) from the helper, to validate the adapter.
        validate(
          'Cash!C38 calendar mean',
          near(calendarMeanRate(h.wb, h.lastRun), h.wb.number('Cash', 'C38')),
        );
        expect(t.failures).toEqual([]);
        expect(validations).toEqual([]);
      });

      it('History live row: composeSnapshot at the as-of (rule 9)', () => {
        const t = tallyOf('Live composition');
        const row = h.live;
        if (row === null) return;
        const cell = (col: string) => h.wb.number('History', `${col}${row.row}`);
        const ref = (col: string) => `History!${col}${row.row}`;
        const liveEnd = row.date > monthEnd(h.asOf) ? row.date : monthEnd(h.asOf);

        // B–M, AF–AI: the four kinds (value, total return, ratio, movements).
        const KIND_COLUMNS: Readonly<
          Record<InstrumentKind, readonly [string, string, string, string]>
        > = {
          stock: ['B', 'C', 'D', 'E'],
          etf: ['F', 'G', 'H', 'I'],
          crypto: ['J', 'K', 'L', 'M'],
          managed_fund: ['AF', 'AG', 'AH', 'AI'],
        };
        for (const kind of INSTRUMENT_KINDS) {
          const [v, g, r, m] = KIND_COLUMNS[kind];
          const key = (letter: string) => HISTORY_COLUMNS.find((c) => c.letter === letter)!.key;
          const n = Math.max(1, h.sheet.tab(kind).watch.length);
          if (brokenTotal(kind)) {
            t.skip('broken_total', 3);
          } else {
            t.sumMoney(ref(v), cell(v), live[key(v)] as number | null, n);
            t.diffMoney(ref(g), cell(g), live[key(g)] as number | null, n);
            t.ratioOfCents(
              ref(r),
              cell(r),
              live[key(g)] as number | null,
              live[key(v)] as number | null,
              n,
            );
          }
          const inTail = h.trades[kind].some((x) => x.tradeDate > h.asOf && x.tradeDate <= liveEnd);
          if (inTail) t.skip('live_window');
          else {
            const trades = h.trades[kind].filter(
              (x) => x.tradeDate > h.lastRun && x.tradeDate <= h.asOf,
            );
            t.diffMoney(ref(m), cell(m), live[key(m)] as number | null, Math.max(1, trades.length));
          }
        }

        // N, O, P: Total Cash and its change since the last run.
        const accounts = Math.max(1, h.accounts.length);
        t.sumMoney(ref('N'), cell('N'), live.cashValueCents, accounts);
        t.diffMoney(ref('O'), cell('O'), live.cashGainCents, accounts + 1);
        t.ratioOfCents(ref('P'), cell('P'), live.cashGainCents, live.cashValueCents, accounts + 1);

        // Q–AE, AJ–AK: the Stage 4 seam (the Stage 4 golden's live-row rules).
        compareSeam(t, ref, cell);

        // U, V: LiabilitiesDebts is not rebuilt (D2): compared when the sheet's are 0.
        for (const letter of ['U', 'V'] as const) {
          const sheet = cell(letter);
          const key = letter === 'U' ? 'liabilitiesBalanceCents' : 'liabilitiesPaidCents';
          if (sheet === null || sheet === 0) t.money(ref(letter), 0, live[key]);
          else t.skip('not_rebuilt');
        }
        // W: the pay settings' monthly salary.
        t.money(ref('W'), cell('W'), live.salaryMonthlyCents);
        expect(t.failures).toEqual([]);
      });

      it('Net Worth!C4:D11: the composed figures by class (rule 10)', () => {
        const t = tallyOf('Net Worth C4:D11');
        const d = dashboard(live);
        const cls = (key: NetWorthClass) => d.classes.find((c) => c.key === key)!;
        const cell = (addr: string) => h.wb.number('Net Worth', addr);
        const n = (kind: InstrumentKind) => Math.max(1, h.sheet.tab(kind).watch.length);
        const pairs: [InstrumentKind, number, NetWorthClass][] = [
          ['etf', 4, 'etf'],
          ['stock', 5, 'stock'],
          ['managed_fund', 6, 'managed_fund'],
          ['crypto', 7, 'crypto'],
        ];
        for (const [kind, row, key] of pairs) {
          if (brokenTotal(kind)) {
            t.skip('broken_total', 2);
            continue;
          }
          t.sumMoney(`Net Worth!C${row}`, cell(`C${row}`), cls(key).valueCents, n(kind));
          t.diffMoney(`Net Worth!D${row}`, cell(`D${row}`), cls(key).gainCents, n(kind));
        }
        // C8 is net Total Cash: the composed N, not the positive-balance class (§11 fix 2).
        t.sumMoney('Net Worth!C8', cell('C8'), live.cashValueCents, Math.max(1, h.accounts.length));
        t.skip('fixed_definition'); // D8: the cash class has no gain (§11 fix 17)
        const valued = h.assets.otherAssets.filter((r) => r.O !== null).length;
        const gained = h.assets.otherAssets.filter((r) => r.P !== null).length;
        t.sumMoney('Net Worth!C9', cell('C9'), cls('other_assets').valueCents, valued);
        t.diffMoney('Net Worth!D9', cell('D9'), cls('other_assets').gainCents, gained);
        const { funds, auto } = superParts();
        if (auto !== 0)
          t.money('Net Worth!C10', funds, cls('super').valueCents, 'retirement_tagged');
        else t.money('Net Worth!C10', cell('C10'), cls('super').valueCents);
        t.skip('defined_by_decision'); // D10: the reported gain vs the provisional S (D69)
        const properties = h.assets.slots.length;
        t.sumMoney('Net Worth!C11', cell('C11'), cls('property').valueCents, properties);
        t.sumMoney('Net Worth!D11', cell('D11'), cls('property').gainCents, properties);
        expect(t.failures).toEqual([]);
      });

      // ─── Helpers over the adapter (closures: they read `h`, `live`, `kpisFy`) ───

      /** The data rows of a WorkingSheet block: from row 3 while its label column holds a label. */
      function blockRows(labelColumn: string): number[] {
        const out: number[] = [];
        for (let r = 3; r <= 1300; r++) {
          if (h.wb.isBlank('WorkingSheet', `${labelColumn}${r}`)) break;
          out.push(r);
        }
        return out;
      }

      /** A History block cell vs a group (rule 5): ratios to their cents, sums over the rows. */
      function compareBlockCell(
        t: HistoryTally,
        ref: string,
        col: HistoryColumn,
        sheet: number | null,
        g: SnapshotGroup,
        reason: HistoryRecomputeReason | undefined,
      ): void {
        const f = g.figures;
        if (col.ratio && isRatioKey(col.key)) {
          const [gain, value] = ratioInputs(col.key);
          if (col.key === 'cashIncreaseRatio' && g.rows > 1) t.skip('fixed_definition');
          else t.ratioOfCents(ref, sheet, f[gain], f[value], 1, reason);
          return;
        }
        if (col.key === 'cashGainCents' && g.rows > 1) {
          t.skip('fixed_definition'); // the sheet's End vs the app's sum (§11 fix 4)
          return;
        }
        const sum = SHEET_BLOCK_SUM_COLUMNS.has(col.letter);
        t.diffMoney(ref, sheet, f[col.key] as number | null, sum ? g.rows : 1, reason);
      }

      /** The dashboard of a figure set (the display inputs from the adapter). */
      function dashboard(f: SnapshotFigures): NetWorthDashboardResult {
        const d = netWorthDashboard({
          asOf: h.asOf,
          live: f,
          liveMonth,
          snapshots: h.snapshots,
          property: h.property,
          cashAccounts: h.accounts,
          kpis: kpisFy,
          plannedSavingsRatio: null,
          considerNext: NO_ALLOCATION,
        });
        validate(
          'assets − liabilities = net worth',
          d.assetsCents - d.liabilitiesCents === d.breakdown.netWorthCents,
        );
        return d;
      }

      /**
       * The Stage 2 broken-total rule for the live row: no priced row, a held row without a price, or
       * a tab total of 0 with a non-zero gain.
       */
      function brokenTotal(kind: InstrumentKind): boolean {
        const tab = h.sheet.tab(kind);
        const { sheet: s, watch: w, summary } = tab.layout;
        const noPrices = tab.watch.every((x) => x.price === null);
        const heldUnpriced = tab.watch.some(
          (x) => x.price === null && (h.wb.number(s, `${w.units}${x.row}`) ?? 0) > 0,
        );
        const value = h.wb.number(s, summary.value);
        const gain = h.wb.number(s, summary.tr);
        return noPrices || heldUnpriced || (value === 0 && gain !== null && gain !== 0);
      }

      /** Super!B2:B7 funds and the B8:B10 automatic lines (Stage 4 rule 16). */
      function superParts(): { funds: number; auto: number } {
        let funds = 0;
        for (let r = SUPER.fundsFrom; r <= SUPER.fundsTo; r++) {
          if (!h.wb.isBlank(SUPER.sheet, `A${r}`)) funds += h.wb.number(SUPER.sheet, `B${r}`) ?? 0;
        }
        const auto = SUPER.autoLines.reduce(
          (s, addr) => s + (h.wb.number(SUPER.sheet, addr) ?? 0),
          0,
        );
        return { funds, auto };
      }

      /** Q–AE, AJ–AK of the live row through the composed seam (the Stage 4 golden's rules). */
      function compareSeam(
        t: HistoryTally,
        ref: (col: string) => string,
        cell: (col: string) => number | null,
      ): void {
        const a = h.assets;
        const properties = a.slots.length;
        const loans = a.slots.filter((x) => x.loan !== null).length;
        const valued = a.otherAssets.filter((r) => r.O !== null).length;
        const gained = a.otherAssets.filter((r) => r.P !== null).length;
        const { funds, auto } = superParts();
        if (auto !== 0) t.money(ref('Q'), funds, live.superValueCents, 'retirement_tagged');
        else t.money(ref('Q'), cell('Q'), live.superValueCents);
        const buys = a.retirementContributions ? a.retirementBuysCents(h.lastRun, h.asOf) : 0;
        if (buys > 0) {
          t.money(
            ref('R'),
            h.wb.number(SUPER.sheet, SUPER.voluntary) ?? 0,
            live.superContribCents,
            'retirement_tagged',
          );
        } else {
          t.money(ref('R'), cell('R'), live.superContribCents);
        }
        t.skip('defined_by_decision', 2); // S, T: the derived gain (D69)
        t.sumMoney(ref('X'), cell('X'), live.propertyValueCents, properties);
        t.sumMoney(ref('Y'), cell('Y'), live.propertyPurchaseCents, properties);
        t.sumMoney(ref('Z'), cell('Z'), live.propertyEquityCents, properties + loans);
        t.sumMoney(ref('AA'), cell('AA'), live.propertyGainCents, properties);
        t.sumMoney(ref('AB'), cell('AB'), live.mortgageBalanceCents, loans);
        t.skip('defined_by_decision'); // AC: interest and fees are derived (D66)
        if (a.principalOnlyPayments()) {
          t.sumMoney(ref('AD'), cell('AD'), live.mortgagePrincipalPaidCents, loans);
        } else {
          t.skip('defined_by_decision');
        }
        t.ratioOfCents(
          ref('AE'),
          cell('AE'),
          live.propertyGainCents,
          live.propertyValueCents,
          properties,
        );
        t.sumMoney(ref('AJ'), cell('AJ'), live.otherValueCents, valued);
        t.diffMoney(ref('AK'), cell('AK'), live.otherGainCents, gained);
      }
    });
  },
);

/** max(1e-9, 1e-9 × |b|) between two doubles (the helpers' validations, §9.5). */
function near(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= Math.max(1e-9, 1e-9 * Math.abs(b));
}

/** Every figure null (the extras included). */
function blankFigures(): SnapshotFigures {
  return Object.fromEntries(
    SNAPSHOT_FIGURE_COLUMNS.map((k) => [k, null]),
  ) as unknown as SnapshotFigures;
}
