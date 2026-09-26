// Server golden (stage-2.md §9.4): the local workbook imported with corrections OFF → DB → the
// investments API, compared with the workbook's own cached cells, read at runtime. Nothing here
// holds an owner value: only template cell references and rules (§9.3). Gated on the engine and
// the importer, and skipped when the workbook is absent. The output prints counts only.
//
// Rules applied (§9.3): unpriced holdings are left out of the tab totals (recomputed from the
// sheet's own cells); a tab with no priced row skips its price-dependent cells; watch rows with no
// units are `not_held`; dividends the sheet did not link but the app links (D28) are added to the
// sheet's total return (and that holding's XIRR is not compared); a partly-sold lot's fee is
// pro-rated in the app (δ = fee × sold / units is added back, `partial_lot_fee`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASHFLOW_ENGINE_IMPLEMENTED, ENGINE_IMPLEMENTED } from '@joinr/engine';
import { importWorkbook, readWorkbook, type WorkbookReader } from '@joinr/importer';
import {
  describeWithLocalWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  centsFromNumber,
  INSTRUMENT_KINDS,
  type HoldingDetailResponse,
  type HoldingRowDto,
  type InstrumentKind,
  type InvestmentPageResponse,
} from '@joinr/schema';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

// Stage 3 (stage-3.md §4.5): the investment pages' timing chain reads the live cash, budget and
// savings, so the pages need the Stage 3 engine; the H2 check also needs the dated side-income
// deposits the Stage 3 importer writes.
const GATED = ENGINE_IMPLEMENTED && CASHFLOW_ENGINE_IMPLEMENTED && IMPORTER_IMPLEMENTED;
const TIMING_GATED = GATED && IMPORTER_STAGE3_IMPLEMENTED;

// ─── Template layout (cell references only) ────────────────────────────────────────────────────

interface TabLayout {
  kind: InstrumentKind;
  sheet: string;
  lastWatchRow: number;
  watch: {
    price: string;
    units: string;
    value: string;
    tr: string;
    trRatio: string;
    xirr: string;
    dividends: string;
  };
  totals: { value: string; tr: string; trRatio: string };
  ledger: { fee: string | null; unrealised: string; remaining: string };
  /** Capital Gains: the ledger's first row (AA3:AA6) and its row count (AA8:AA11). */
  cgStart: string;
  cgCount: string;
  /** Net Worth gain cell (D4:D7). */
  netWorthGain: string;
}

const TABS: Readonly<Record<InstrumentKind, TabLayout>> = {
  stock: {
    kind: 'stock',
    sheet: 'Stocks',
    lastWatchRow: 12,
    watch: { price: 'D', units: 'G', value: 'H', tr: 'I', trRatio: 'J', xirr: 'K', dividends: 'L' },
    totals: { value: 'E16', tr: 'E17', trRatio: 'E18' },
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA4',
    cgCount: 'AA9',
    netWorthGain: 'D5',
  },
  etf: {
    kind: 'etf',
    sheet: 'ETFs',
    lastWatchRow: 11,
    watch: { price: 'D', units: 'F', value: 'G', tr: 'H', trRatio: 'I', xirr: 'J', dividends: 'K' },
    totals: { value: 'F15', tr: 'F16', trRatio: 'F17' },
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA3',
    cgCount: 'AA8',
    netWorthGain: 'D4',
  },
  managed_fund: {
    kind: 'managed_fund',
    sheet: 'Managed Funds',
    lastWatchRow: 11,
    watch: { price: 'D', units: 'E', value: 'F', tr: 'G', trRatio: 'H', xirr: 'I', dividends: 'J' },
    totals: { value: 'B16', tr: 'H16', trRatio: 'H17' },
    ledger: { fee: null, unrealised: 'I', remaining: 'K' },
    cgStart: 'AA5',
    cgCount: 'AA11',
    netWorthGain: 'D6',
  },
  crypto: {
    kind: 'crypto',
    sheet: 'Crypto',
    lastWatchRow: 7,
    watch: { price: 'B', units: 'D', value: 'E', tr: 'F', trRatio: 'G', xirr: 'H', dividends: 'I' },
    totals: { value: 'E9', tr: 'E10', trRatio: 'E11' },
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA6',
    cgCount: 'AA10',
    netWorthGain: 'D7',
  },
};

/** Capital Gains blocks, in the sheet's order. */
const CG_BLOCK_ORDER: readonly InstrumentKind[] = ['etf', 'stock', 'crypto', 'managed_fund'];
const CG = 'Capital Gains';
const WATCH_TERMINATORS = ['Insert further rows', 'ℹ️'];

// ─── Tolerances (§9.5) ─────────────────────────────────────────────────────────────────────────

const rel = (v: number) => 1e-9 * Math.abs(v);
function expectCents(actual: number | null, sheetDollars: number, label: string, cents = 1): void {
  const expected = centsFromNumber(sheetDollars);
  expect(actual, label).not.toBeNull();
  expect(Math.abs(actual! - expected), label).toBeLessThanOrEqual(Math.max(cents, rel(expected)));
}
function expectRatio(actual: string | null, sheet: number, label: string, tol = 1e-7): void {
  expect(actual, label).not.toBeNull();
  expect(Math.abs(Number(actual) - sheet), label).toBeLessThanOrEqual(Math.max(tol, rel(sheet)));
}
function expectUnits(actual: string | null, sheet: number, label: string): void {
  expect(actual, label).not.toBeNull();
  expect(Math.abs(Number(actual) - sheet), label).toBeLessThanOrEqual(Math.max(1e-8, rel(sheet)));
}

// ─── Counts (printed; never values) ────────────────────────────────────────────────────────────

interface TabCounts {
  compared: number;
  skipped: Record<string, number>;
  adjusted: Record<string, number>;
}
const counts: Record<string, TabCounts> = {};
function tally(tab: string): TabCounts {
  return (counts[tab] ??= { compared: 0, skipped: {}, adjusted: {} });
}
const compared = (tab: string, n = 1) => {
  tally(tab).compared += n;
};
const skipped = (tab: string, reason: string, n = 1) => {
  const t = tally(tab);
  t.skipped[reason] = (t.skipped[reason] ?? 0) + n;
};
const adjusted = (tab: string, reason: string, n = 1) => {
  const t = tally(tab);
  t.adjusted[reason] = (t.adjusted[reason] ?? 0) + n;
};

// ─── Sheet readers ──────────────────────────────────────────────────────────────────────────────

interface WatchRow {
  row: number;
  symbol: string;
  units: number | null;
  price: number | null;
}

function watchRows(r: WorkbookReader, t: TabLayout): WatchRow[] {
  const out: WatchRow[] = [];
  for (let row = 2; row <= t.lastWatchRow; row++) {
    const symbol = r.text(t.sheet, `A${row}`)?.trim() ?? '';
    if (symbol === '') continue;
    if (WATCH_TERMINATORS.some((x) => symbol.startsWith(x))) break;
    out.push({
      row,
      symbol,
      units: r.number(t.sheet, `${t.watch.units}${row}`),
      price: r.number(t.sheet, `${t.watch.price}${row}`),
    });
  }
  return out;
}

interface LedgerRow {
  row: number;
  symbol: string;
  units: number;
  price: number;
  fee: number;
  unrealised: number | null;
  remaining: number | null;
}

/** The tab's non-blank ledger rows, in sheet order, from the Capital Gains start row. */
function ledgerRows(r: WorkbookReader, t: TabLayout): LedgerRow[] {
  const start = r.number(CG, t.cgStart);
  if (start === null) throw new Error(`${CG}!${t.cgStart} is not a row number`);
  const out: LedgerRow[] = [];
  for (let row = start; row <= r.lastRow(t.sheet); row++) {
    const symbol = r.text(t.sheet, `A${row}`)?.trim() ?? '';
    if (symbol === '') continue;
    out.push({
      row,
      symbol,
      units: r.number(t.sheet, `C${row}`) ?? 0,
      price: r.number(t.sheet, `D${row}`) ?? 0,
      fee: t.ledger.fee === null ? 0 : (r.number(t.sheet, `${t.ledger.fee}${row}`) ?? 0),
      unrealised: r.number(t.sheet, `${t.ledger.unrealised}${row}`),
      remaining: r.number(t.sheet, `${t.ledger.remaining}${row}`),
    });
  }
  return out;
}

/** §9.3 rule 5: δ over a holding's partly-sold lots whose unrealised the sheet computed. */
function partialLotFee(lots: readonly LedgerRow[]): { delta: number; lots: number } {
  let delta = 0;
  let n = 0;
  for (const l of lots) {
    if (l.units <= 0 || l.unrealised === null || l.remaining === null || l.fee === 0) continue;
    if (l.remaining < l.units) {
      delta += (l.fee * (l.units - l.remaining)) / l.units;
      n += 1;
    }
  }
  return { delta, lots: n };
}

/** The app's cost definition from the sheet's own ledger cells: Σ D × L + E × L / C, live lots. */
function ledgerCost(lots: readonly LedgerRow[]): number {
  let cost = 0;
  for (const l of lots) {
    if (l.units <= 0 || l.remaining === null || l.remaining <= 0) continue;
    cost += l.price * l.remaining + (l.fee * l.remaining) / l.units;
  }
  return cost;
}

// ─── The test ───────────────────────────────────────────────────────────────────────────────────

describeWithLocalWorkbook('investments server golden (import → DB → API)', (workbookPath) => {
  describe.skipIf(!GATED)('corrections off, market off, as of the workbook date', () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    let r: WorkbookReader;
    const pages = {} as Record<InstrumentKind, InvestmentPageResponse>;

    beforeAll(async () => {
      const bytes = new Uint8Array(readFileSync(workbookPath));
      r = readWorkbook(bytes);
      const asOf = r.date('Net Worth', 'E52');
      if (asOf === null) throw new Error('Net Worth!E52 is not a date');
      const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
      const now = new Date(y, m - 1, d, 12, 0, 0);

      tempDir = await makeTempDir('joinr-golden-');
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
      app = await buildApp({ config, db: database, now: () => now });
      for (const kind of INSTRUMENT_KINDS) {
        const res = await app.inject({ method: 'GET', url: `/api/investments/${kind}` });
        expect(res.statusCode, kind).toBe(200);
        pages[kind] = res.json<InvestmentPageResponse>();
        expect(pages[kind].asOf).toBe(asOf);
      }
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (tempDir) await removeDir(tempDir);
      for (const [tab, c] of Object.entries(counts)) {
        console.log(
          `[golden:server] ${tab} compared: ${c.compared} · skipped: ${JSON.stringify(c.skipped)} · adjusted: ${JSON.stringify(c.adjusted)}`,
        );
      }
    });

    /** The per-holding and tab comparisons shared by every investment tab. */
    function compareTab(kind: InstrumentKind): void {
      const t = TABS[kind];
      const tab = t.sheet;
      const page = pages[kind];
      const bySymbol = new Map(page.holdings.map((h) => [h.symbol, h]));
      const ledger = ledgerRows(r, t);
      const rows = watchRows(r, t);
      const heldRows = rows.filter((w) => (w.units ?? 0) > 0 && bySymbol.has(w.symbol));
      const pricedRows = heldRows.filter((w) => (w.price ?? 0) > 0);
      const noPrices = pricedRows.length === 0;

      // unpricedCount = held watch rows without a positive cached price.
      expect(page.summary.unpricedCount, `${tab} unpricedCount`).toBe(
        heldRows.length - pricedRows.length,
      );
      compared(tab);

      let trAdjust = 0;
      let costSum = 0;
      let needsRecompute = heldRows.length !== pricedRows.length;
      let sumValue = 0;

      for (const w of rows) {
        const h: HoldingRowDto | undefined = bySymbol.get(w.symbol);
        const cell = (col: string) => `${tab}!${col}${w.row}`;
        if (!h) {
          skipped(tab, 'not_instrument');
          continue;
        }
        if ((w.units ?? 0) <= 0) {
          // §9.3 rule 12: no units held; the app has no total return or average price.
          expect(h.totalReturnCents, cell(t.watch.tr)).toBeNull();
          expect(h.totalReturnRatio, cell(t.watch.trRatio)).toBeNull();
          compared(tab, 2);
          skipped(tab, 'not_held', 2);
          continue;
        }
        if (h.flags.includes('oversell')) skipped(tab, 'oversell');
        else {
          expectUnits(h.units, w.units!, cell(t.watch.units));
          compared(tab);
        }
        if ((w.price ?? 0) <= 0) {
          // §9.3 rules 1–2: left out and flagged; its price-dependent cells are not compared.
          expect(h.flags, cell(t.watch.price)).toContain('unpriced');
          expect(h.valueCents, cell(t.watch.value)).toBeNull();
          expect(h.totalReturnCents, cell(t.watch.tr)).toBeNull();
          skipped(tab, noPrices ? 'no_prices' : 'unpriced', 4);
          continue;
        }

        const lots = ledger.filter((l) => l.symbol === w.symbol);
        const fee = partialLotFee(lots);
        const sheetDiv = r.number(t.sheet, `${t.watch.dividends}${w.row}`) ?? 0;
        const divDelta = h.dividendsCents / 100 - sheetDiv;
        const relinked = Math.abs(divDelta) >= 0.005;
        if (fee.lots > 0) adjusted(tab, 'partial_lot_fee', fee.lots);
        if (relinked) adjusted(tab, 'd28_relinked');
        trAdjust += fee.delta + (relinked ? divDelta : 0);
        costSum += ledgerCost(lots);

        const value = r.number(t.sheet, `${t.watch.value}${w.row}`);
        expect(value, cell(t.watch.value)).not.toBeNull();
        expectCents(h.valueCents, value!, cell(t.watch.value));
        sumValue += value!;

        const tr = r.number(t.sheet, `${t.watch.tr}${w.row}`) ?? 0;
        const trExpected = tr + fee.delta + (relinked ? divDelta : 0);
        expectCents(h.totalReturnCents, trExpected, cell(t.watch.tr));

        if (fee.lots === 0 && !relinked) {
          const ratio = r.number(t.sheet, `${t.watch.trRatio}${w.row}`);
          expect(ratio, cell(t.watch.trRatio)).not.toBeNull();
          expectRatio(h.totalReturnRatio, ratio!, cell(t.watch.trRatio));
        } else {
          needsRecompute = true;
          adjusted(tab, 'recomputed');
          expectRatio(h.totalReturnRatio, trExpected / ledgerCost(lots), cell(t.watch.trRatio));
        }
        compared(tab, 3);

        const xirr = r.number(t.sheet, `${t.watch.xirr}${w.row}`);
        if (relinked) skipped(tab, 'd28_relinked');
        else if (xirr === null) skipped(tab, 'sheet_blank');
        else {
          expectRatio(h.xirr, xirr, cell(t.watch.xirr), 1e-6);
          compared(tab);
        }
      }

      // Tab totals (§9.3 rule 1 recomputes them when a held row is unpriced).
      if (noPrices) {
        skipped(tab, 'no_prices', 3);
        skipped('Net Worth', 'no_prices');
        return;
      }
      const n = pricedRows.length;
      const sumTol = Math.max(1, Math.ceil(n / 2));
      const valueCell = r.number(t.sheet, t.totals.value);
      if (heldRows.length === pricedRows.length && valueCell !== null) {
        expectCents(page.summary.valueCents, valueCell, `${tab}!${t.totals.value}`, sumTol);
      } else {
        adjusted(tab, 'recomputed');
        expectCents(page.summary.valueCents, sumValue, `${tab}!${t.totals.value}`, sumTol);
      }
      const trTotal = r.number(t.sheet, t.totals.tr) ?? 0;
      const trTotalExpected = trTotal + trAdjust;
      expectCents(page.summary.totalReturnCents, trTotalExpected, `${tab}!${t.totals.tr}`, sumTol);
      if (!needsRecompute && trAdjust === 0) {
        const ratio = r.number(t.sheet, t.totals.trRatio);
        expect(ratio, `${tab}!${t.totals.trRatio}`).not.toBeNull();
        expectRatio(page.summary.totalReturnRatio, ratio!, `${tab}!${t.totals.trRatio}`);
      } else {
        adjusted(tab, 'recomputed');
        expectRatio(
          page.summary.totalReturnRatio,
          trTotalExpected / costSum,
          `${tab}!${t.totals.trRatio}`,
        );
      }
      compared(tab, 3);

      // The Stage 1 `derived_later_stage` Net Worth gain line for this tab.
      const nwGain = r.number('Net Worth', t.netWorthGain);
      if (nwGain === null) skipped('Net Worth', 'sheet_blank');
      else {
        expectCents(
          page.summary.totalReturnCents,
          nwGain + trAdjust,
          `Net Worth!${t.netWorthGain}`,
          sumTol,
        );
        compared('Net Worth');
      }
    }

    it('Stocks: holdings and E16–E18', () => compareTab('stock'));
    it('ETFs: holdings, the recomputed total, F16 + D28 dividends, unpriced count', () =>
      compareTab('etf'));
    it('Managed Funds: the fund rows and B16, H16, H17', () => compareTab('managed_fund'));
    it('Crypto: units and the unpriced count (price cells only when priced)', () =>
      compareTab('crypto'));

    it('realised by FY across the four kinds = Capital Gains V (union of FYs)', () => {
      const app = new Map<number, { cents: number; disposals: number }>();
      for (const kind of INSTRUMENT_KINDS) {
        for (const row of pages[kind].realisedByFy) {
          const cur = app.get(row.financialYear) ?? { cents: 0, disposals: 0 };
          app.set(row.financialYear, {
            cents: cur.cents + row.totalCents,
            disposals: cur.disposals + row.disposals,
          });
        }
      }
      const sheet = new Map<number, number>();
      for (let row = 11; row <= r.lastRow(CG); row++) {
        const start = r.date(CG, `U${row}`);
        if (start === null) break;
        sheet.set(Number(start.slice(0, 4)), r.number(CG, `V${row}`) ?? 0);
      }
      expect(sheet.size, `${CG}!U11`).toBeGreaterThan(0);
      for (const fy of new Set([...app.keys(), ...sheet.keys()])) {
        const a = app.get(fy) ?? { cents: 0, disposals: 0 };
        expectCents(a.cents, sheet.get(fy) ?? 0, `${CG}!V (FY ${fy})`, Math.max(1, a.disposals));
        compared(CG);
      }
    });

    it('lot remaining units = Capital Gains O (one holding detail per kind)', async () => {
      let blockStart = 2;
      for (const kind of CG_BLOCK_ORDER) {
        const t = TABS[kind];
        const count = r.number(CG, t.cgCount) ?? 0;
        const ledger = ledgerRows(r, t);
        expect(ledger.length, `${CG}!${t.cgCount}`).toBe(count);
        const indexOfRow = new Map(ledger.map((l, i) => [l.row, i]));
        // The holding with the most parcels.
        const holding = [...pages[kind].holdings].sort(
          (a, b) =>
            ledger.filter((l) => l.symbol === b.symbol).length -
            ledger.filter((l) => l.symbol === a.symbol).length,
        )[0];
        if (holding) {
          const res = await app.inject({
            method: 'GET',
            url: `/api/instruments/${holding.instrumentId}`,
          });
          expect(res.statusCode).toBe(200);
          const detail = res.json<HoldingDetailResponse>();
          const refOf = new Map(detail.trades.map((tr) => [tr.id, tr.sheetRef]));
          for (const lot of detail.lots) {
            const ref = refOf.get(lot.tradeId);
            const m = ref ? /!A(\d+)$/.exec(ref) : null;
            expect(m, `lot ${lot.tradeId} sheet row`).not.toBeNull();
            const index = indexOfRow.get(Number(m![1]));
            expect(index, `${t.sheet}!A${m![1]}`).toBeDefined();
            const cgRow = blockStart + index!;
            const l = ledger[index!]!;
            // The block row maps to this ledger row (column A and the units agree).
            // Compared as a boolean so a failure names the cell, never the symbol (§7.0).
            expect(
              r.text(CG, `A${cgRow}`)?.trim() === l.symbol,
              `${CG}!A${cgRow} symbol matches`,
            ).toBe(true);
            const cgUnits = r.number(CG, `C${cgRow}`);
            expect(cgUnits, `${CG}!C${cgRow}`).not.toBeNull();
            expect(Math.abs(cgUnits! - l.units), `${CG}!C${cgRow}`).toBeLessThanOrEqual(
              Math.max(1e-8, rel(l.units)),
            );
            const o = r.number(CG, `O${cgRow}`);
            expect(o, `${CG}!O${cgRow}`).not.toBeNull();
            expectUnits(lot.remainingUnits, o!, `${CG}!O${cgRow}`);
            compared(CG);
          }
        }
        blockStart += count;
      }
    });

    it.skipIf(!TIMING_GATED)(
      'timing.monthlyInvestCents = the recomputed SheetOptions!H2 (§9.3 rule 6)',
      () => {
        const timing = pages.etf.timing;
        const lastBuy = r.date('SheetOptions', 'H20');
        // A boolean, so a failure never prints the date (§7.0).
        expect(timing.lastPurchaseDate === lastBuy, 'SheetOptions!H20 matches').toBe(true);
        compared('SheetOptions');
        if (timing.budget.useBudget !== true) {
          skipped('SheetOptions', 'budget_switch_off');
          return;
        }
        const c28 = r.number('Budget', 'C28') ?? 0;
        const share = r.number('SheetOptions', 'H41') ?? 0;
        const tax = r.number('SheetOptions', 'H31') ?? 0;
        const amounts: number[] = [];
        for (let row = 2; row <= 799; row++) {
          const end = r.date('Side Income', `F${row}`);
          if (end === null) continue;
          const filled =
            !r.isBlank('Side Income', `G${row}`) || !r.isBlank('Side Income', `H${row}`);
          if (!filled || lastBuy === null || end <= lastBuy) continue;
          amounts.push(r.number('Side Income', `I${row}`) ?? 0);
        }
        const mean = amounts.length === 0 ? 0 : amounts.reduce((a, b) => a + b, 0) / amounts.length;
        if (amounts.length > 0) adjusted('SheetOptions', 'recomputed');
        expectCents(timing.monthlyInvestCents, c28 + share * (1 - tax) * mean, 'SheetOptions!H2');
        compared('SheetOptions');
      },
    );
  });
});
