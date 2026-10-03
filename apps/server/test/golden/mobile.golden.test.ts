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
  type InstrumentKind,
  type InvestmentPageResponse,
  type MobilePairResponse,
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
    });
  },
);
