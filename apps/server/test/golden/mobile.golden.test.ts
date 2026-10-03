// Server golden (stage-9.md header "Golden values", §12 #4): the local workbook imported with
// corrections OFF → DB → `GET /api/mobile/today` (market off, `now` = Net Worth!E52 at 12:00
// local), compared with the WORKBOOK'S OWN cached value cells read at runtime (not only with the
// pages, which share `compute(kind)` and would agree by construction):
// - each held, priced holding's `valueCents` = its tab's watch-row value cell (the Stage 2 golden's
//   tab layout and §9.3 rules: rows with no units are not held, unpriced rows are left out);
// - each bullion holding's `valueCents` = Σ the Other Assets value cells (O) of that metal's bullion
//   rows (the rows the importer linked to the metal's feed); with market off and no spot in the
//   import the rows are valued from their stored prices, as the sheet's O, and counted apart;
// - `totals.valueCents` = the four tabs' totals (recomputed from the priced rows when one is
//   unpriced, as Stage 2) + the bullion O cells; and, as a cross-check, = Σ the four investment
//   pages' `summary.valueCents` + Σ the Other Assets page's bullion rows' `valueCents`.
// Stage 10 (stage-10.md header "Golden values", §12 #4), from `GET /api/mobile/periods` on the same
// app: Σ `realisedCents` over every holding of the four kinds (the ALL figures of the held ones,
// priced or not, and the instruments in the Sold figure) = the workbook's Capital Gains V summed
// over every financial year (one cent per disposal); and each held, priced holding's ALL unrealised
// part = its tab's total-return cell − its dividends cell (the Stage 2 golden's partial-lot-fee
// adjustment; a D28 re-link changes the dividends on both sides, so it cancels), with that test's
// unpriced and no-prices skip rules.
// Nothing here holds an owner value: only template cell references and rules. Gated, and skipped
// when the workbook is absent. Prints counts only.
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
} from '@joinr/importer/testing';
import {
  centsFromNumber,
  INSTRUMENT_KINDS,
  JoinrDecimal,
  SOLD_HOLDINGS_KEY,
  type InstrumentKind,
  type InvestmentPageResponse,
  type MobilePairResponse,
  type MobilePeriodsResponse,
  type MobileTodayResponse,
  type OtherAssetsPageResponse,
  type PhoneSectionResponse,
} from '@joinr/schema';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED;

// ─── Template layout (cell references only; the Stage 2 golden's) ──────────────────────────────

interface TabLayout {
  sheet: string;
  lastWatchRow: number;
  price: string;
  units: string;
  value: string;
  total: string;
}

const TABS: Readonly<Record<InstrumentKind, TabLayout>> = {
  stock: { sheet: 'Stocks', lastWatchRow: 12, price: 'D', units: 'G', value: 'H', total: 'E16' },
  etf: { sheet: 'ETFs', lastWatchRow: 11, price: 'D', units: 'F', value: 'G', total: 'F15' },
  managed_fund: {
    sheet: 'Managed Funds',
    lastWatchRow: 11,
    price: 'D',
    units: 'E',
    value: 'F',
    total: 'B16',
  },
  crypto: { sheet: 'Crypto', lastWatchRow: 7, price: 'B', units: 'D', value: 'E', total: 'E9' },
};
const WATCH_TERMINATORS = ['Insert further rows', 'ℹ️'];
const OTHER = 'Other Assets';

// Stage 10: the Stage 2 golden's total-return, dividends and ledger columns and the Capital Gains
// start-row cells (template cell references only).
interface PeriodLayout {
  tr: string;
  dividends: string;
  ledger: { fee: string | null; unrealised: string; remaining: string };
  cgStart: string;
}
const PERIOD_TABS: Readonly<Record<InstrumentKind, PeriodLayout>> = {
  stock: {
    tr: 'I',
    dividends: 'L',
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA4',
  },
  etf: {
    tr: 'H',
    dividends: 'K',
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA3',
  },
  managed_fund: {
    tr: 'G',
    dividends: 'J',
    ledger: { fee: null, unrealised: 'I', remaining: 'K' },
    cgStart: 'AA5',
  },
  crypto: {
    tr: 'F',
    dividends: 'I',
    ledger: { fee: 'E', unrealised: 'J', remaining: 'L' },
    cgStart: 'AA6',
  },
};
const CG = 'Capital Gains';

interface LedgerRow {
  symbol: string;
  units: number;
  fee: number;
  unrealised: number | null;
  remaining: number | null;
}

/** The tab's non-blank ledger rows from the Capital Gains start row (the Stage 2 reader). */
function ledgerRows(r: WorkbookReader, kind: InstrumentKind): LedgerRow[] {
  const t = TABS[kind];
  const l = PERIOD_TABS[kind];
  const start = r.number(CG, l.cgStart);
  if (start === null) throw new Error(`${CG}!${l.cgStart} is not a row number`);
  const out: LedgerRow[] = [];
  for (let row = start; row <= r.lastRow(t.sheet); row++) {
    const symbol = r.text(t.sheet, `A${row}`)?.trim() ?? '';
    if (symbol === '') continue;
    out.push({
      symbol,
      units: r.number(t.sheet, `C${row}`) ?? 0,
      fee: l.ledger.fee === null ? 0 : (r.number(t.sheet, `${l.ledger.fee}${row}`) ?? 0),
      unrealised: r.number(t.sheet, `${l.ledger.unrealised}${row}`),
      remaining: r.number(t.sheet, `${l.ledger.remaining}${row}`),
    });
  }
  return out;
}

/** The Stage 2 rule 5: δ = fee × sold ÷ units over a holding's partly sold lots. */
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

// ─── Counts (printed; never values) ────────────────────────────────────────────────────────────

const counts: Record<string, { compared: number; skipped: Record<string, number> }> = {};
const tally = (area: string) => (counts[area] ??= { compared: 0, skipped: {} });
const compared = (area: string, n = 1) => {
  tally(area).compared += n;
};
const skipped = (area: string, reason: string, n = 1) => {
  const t = tally(area);
  t.skipped[reason] = (t.skipped[reason] ?? 0) + n;
};

function expectCents(actual: number | null, sheetDollars: number, label: string, cents = 1): void {
  const expected = centsFromNumber(sheetDollars);
  expect(actual, label).not.toBeNull();
  expect(Math.abs(actual! - expected), label).toBeLessThanOrEqual(
    Math.max(cents, 1e-9 * Math.abs(expected)),
  );
}

describeWithLocalWorkbook(
  'mobile server golden (import → DB → /api/mobile/today)',
  (workbookPath) => {
    describe.skipIf(!GATED)('corrections off, market off, as of the workbook date', () => {
      let tempDir: string;
      let database: AppDatabase;
      let app: FastifyInstance;
      let r: WorkbookReader;
      let today: MobileTodayResponse;
      let periods: MobilePeriodsResponse;
      let other: OtherAssetsPageResponse;
      const pages = {} as Record<InstrumentKind, InvestmentPageResponse>;

      beforeAll(async () => {
        const bytes = new Uint8Array(readFileSync(workbookPath));
        r = readWorkbook(bytes);
        const asOf = r.date('Net Worth', 'E52');
        if (asOf === null) throw new Error('Net Worth!E52 is not a date');
        const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
        const now = new Date(y, m - 1, d, 12, 0, 0);
        tempDir = await makeTempDir('joinr-golden-mobile-');
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
        // Pair a test phone (the code and key stay in memory; never printed).
        const open = await app.inject({ method: 'POST', url: '/api/phone/pairing' });
        const code = open.json<PhoneSectionResponse>().pairing!.code;
        const paired = await app.inject({
          method: 'POST',
          url: '/api/mobile/pair',
          payload: { code },
        });
        expect(paired.statusCode).toBe(201);
        const key = paired.json<MobilePairResponse>().key;
        const res = await app.inject({
          method: 'GET',
          url: '/api/mobile/today',
          headers: { authorization: `Bearer ${key}` },
        });
        expect(res.statusCode).toBe(200);
        today = res.json<MobileTodayResponse>();
        const periodsRes = await app.inject({
          method: 'GET',
          url: '/api/mobile/periods',
          headers: { authorization: `Bearer ${key}` },
        });
        expect(periodsRes.statusCode).toBe(200);
        periods = periodsRes.json<MobilePeriodsResponse>();
        for (const kind of INSTRUMENT_KINDS) {
          pages[kind] = (
            await app.inject({ method: 'GET', url: `/api/investments/${kind}` })
          ).json<InvestmentPageResponse>();
        }
        other = (
          await app.inject({ method: 'GET', url: '/api/other-assets' })
        ).json<OtherAssetsPageResponse>();
      }, 120_000);

      afterAll(async () => {
        await app?.close();
        if (tempDir) await removeDir(tempDir);
        for (const [area, c] of Object.entries(counts)) {
          console.log(
            `[golden:mobile] ${area} compared: ${c.compared} · skipped: ${JSON.stringify(c.skipped)}`,
          );
        }
      });

      it("each held holding, each bullion holding and the total equal the workbook's own value cells", () => {
        const bySymbol = new Map(
          today.holdings.filter((h) => h.instrumentId !== null).map((h) => [h.symbol, h]),
        );
        let sheetTotal = 0;
        let pricedRows = 0;
        for (const kind of INSTRUMENT_KINDS) {
          const t = TABS[kind];
          const area = t.sheet;
          let held = 0;
          let priced = 0;
          let sumValue = 0;
          for (let row = 2; row <= t.lastWatchRow; row++) {
            const symbol = r.text(t.sheet, `A${row}`)?.trim() ?? '';
            if (symbol === '') continue;
            if (WATCH_TERMINATORS.some((x) => symbol.startsWith(x))) break;
            const units = r.number(t.sheet, `${t.units}${row}`) ?? 0;
            const h = bySymbol.get(symbol);
            if (units <= 0) {
              // Not held: never listed on the phone.
              expect(h, `${area}!A${row}`).toBeUndefined();
              skipped(area, 'not_held');
              continue;
            }
            if (h === undefined) {
              skipped(area, 'not_instrument');
              continue;
            }
            held += 1;
            const price = r.number(t.sheet, `${t.price}${row}`) ?? 0;
            if (price <= 0) {
              expect(h.valueCents, `${area}!${t.value}${row}`).toBeNull();
              skipped(area, 'unpriced');
              continue;
            }
            priced += 1;
            const value = r.number(t.sheet, `${t.value}${row}`);
            expect(value, `${area}!${t.value}${row}`).not.toBeNull();
            expectCents(h.valueCents, value!, `${area}!${t.value}${row}`);
            sumValue += value!;
            compared(area);
          }
          const totalCell = r.number(t.sheet, t.total);
          if (held === priced && totalCell !== null) {
            sheetTotal += totalCell;
            compared(area);
          } else {
            sheetTotal += sumValue;
            skipped(area, 'total_recomputed');
          }
          pricedRows += priced;
        }

        // Bullion: Σ O of the rows the import linked to each metal.
        let bullionRows = 0;
        for (const metal of ['silver', 'gold'] as const) {
          const rows = other.assets.filter(
            (a) =>
              a.priceSource === 'bullion' &&
              (a.metal ?? 'silver') === metal &&
              new JoinrDecimal(a.remainingUnits).greaterThan(0),
          );
          if (rows.length === 0) continue;
          const h = today.holdings.find((x) => x.key === `bullion-${metal}`);
          expect(h, metal).toBeDefined();
          const spot = other.spot.find((s) => s.metal === metal);
          let sheetSum = 0;
          for (const a of rows) {
            const row = /^Other Assets!F(\d+)$/.exec(a.sheetRef ?? '')?.[1];
            const O = row === undefined ? null : r.number(OTHER, `O${row}`);
            if (O !== null) sheetSum += O;
          }
          // Market off: with no spot in the import the rows are valued from their stored prices (the
          // web's fallback, K), which the sheet's O = M × K also uses; counted apart.
          const area =
            spot === undefined || spot.audPerOz === null ? 'Bullion (stored prices)' : 'Bullion';
          expectCents(
            h!.valueCents,
            sheetSum,
            `${area} ${metal} Σ ${OTHER}!O`,
            Math.max(1, Math.ceil(rows.length / 2)),
          );
          sheetTotal += sheetSum;
          bullionRows += rows.length;
          compared(area);
        }

        // The total: the sheet's own cells (⌈n/2⌉ cents over the rows summed).
        const n = pricedRows + bullionRows;
        expectCents(
          today.totals.valueCents,
          sheetTotal,
          'mobile totals.valueCents',
          Math.max(1, Math.ceil(n / 2)),
        );
        compared('Totals');

        // The cross-check with the pages (exact: the same engine figures).
        const pagesSum =
          INSTRUMENT_KINDS.reduce((s, k) => s + pages[k].summary.valueCents, 0) +
          other.assets
            .filter(
              (a) =>
                a.priceSource === 'bullion' && new JoinrDecimal(a.remainingUnits).greaterThan(0),
            )
            .reduce((s, a) => s + (a.valueCents ?? 0), 0);
        expect(today.totals.valueCents).toBe(pagesSum);
        compared('Totals');
      });

      it("ALL (Stage 10): Σ realised = Capital Gains V; each held, priced holding's unrealised = TR − dividends", () => {
        const all = periods.periods.find((p) => p.period === 'ALL')!;
        const figure = new Map(all.figures.map((f) => [f.key, f]));

        // Σ realisedCents of every holding of the four kinds: the held ones' ALL figures (priced or
        // not) + the Sold figure less the metals no longer held.
        let heldRealised = 0;
        for (const h of periods.holdings) {
          if (h.instrumentId === null) continue;
          heldRealised += figure.get(h.key)!.realisedCents!;
        }
        let soldMetals = 0;
        for (const metal of ['silver', 'gold'] as const) {
          const rows = other.assets.filter(
            (a) => a.priceSource === 'bullion' && (a.metal ?? 'silver') === metal,
          );
          if (rows.length === 0) continue;
          if (rows.some((a) => new JoinrDecimal(a.remainingUnits).greaterThan(0))) continue;
          soldMetals += rows.reduce((s, a) => s + a.realisedCents, 0);
        }
        const sold = figure.get(SOLD_HOLDINGS_KEY)?.realisedCents ?? 0;
        const realised = heldRealised + sold - soldMetals;
        // The pages agree exactly (the same engine figures).
        expect(realised).toBe(
          INSTRUMENT_KINDS.reduce((s, k) => s + pages[k].summary.realisedCents, 0),
        );
        let disposals = 0;
        for (const k of INSTRUMENT_KINDS)
          for (const row of pages[k].realisedByFy) disposals += row.disposals;
        let sheetRealised = 0;
        let years = 0;
        for (let row = 11; row <= r.lastRow(CG); row++) {
          if (r.date(CG, `U${row}`) === null) break;
          sheetRealised += r.number(CG, `V${row}`) ?? 0;
          years += 1;
        }
        expect(years, `${CG}!U11`).toBeGreaterThan(0);
        expectCents(realised, sheetRealised, `Σ ${CG}!V`, Math.max(1, disposals));
        compared('Periods ALL realised');

        // Each held, priced holding's unrealised part.
        const bySymbol = new Map(
          periods.holdings.filter((h) => h.instrumentId !== null).map((h) => [h.symbol, h]),
        );
        for (const kind of INSTRUMENT_KINDS) {
          const t = TABS[kind];
          const l = PERIOD_TABS[kind];
          const area = `Periods ALL ${t.sheet}`;
          const ledger = ledgerRows(r, kind);
          const rows: { row: number; symbol: string; priced: boolean }[] = [];
          for (let row = 2; row <= t.lastWatchRow; row++) {
            const symbol = r.text(t.sheet, `A${row}`)?.trim() ?? '';
            if (symbol === '') continue;
            if (WATCH_TERMINATORS.some((x) => symbol.startsWith(x))) break;
            if ((r.number(t.sheet, `${t.units}${row}`) ?? 0) <= 0) {
              skipped(area, 'not_held');
              continue;
            }
            if (!bySymbol.has(symbol)) {
              skipped(area, 'not_instrument');
              continue;
            }
            rows.push({ row, symbol, priced: (r.number(t.sheet, `${t.price}${row}`) ?? 0) > 0 });
          }
          const noPrices = rows.length > 0 && rows.every((x) => !x.priced);
          for (const { row, symbol, priced } of rows) {
            const f = figure.get(bySymbol.get(symbol)!.key)!;
            const label = `${t.sheet}!${l.tr}${row} − ${l.dividends}${row}`;
            if (!priced) {
              expect(f.status, label).toBe('unpriced');
              expect(f.unrealisedCents, label).toBeNull();
              skipped(area, noPrices ? 'no_prices' : 'unpriced');
              continue;
            }
            const tr = r.number(t.sheet, `${l.tr}${row}`) ?? 0;
            const div = r.number(t.sheet, `${l.dividends}${row}`) ?? 0;
            const fee = partialLotFee(ledger.filter((x) => x.symbol === symbol));
            if (fee.lots > 0) skipped(area, 'adjusted_partial_lot_fee', fee.lots);
            expect(f.status, label).toBe('ok');
            expectCents(f.unrealisedCents, tr - div + fee.delta, label);
            compared(area);
          }
        }
      });
    });
  },
);
