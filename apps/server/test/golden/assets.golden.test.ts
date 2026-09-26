// Server golden (stage-4.md §9.4): the local workbook imported with corrections OFF → DB → the
// Other Assets, Super, Property and Cash APIs (market off, `now` = Net Worth!E52 at 12:00 local),
// compared with the workbook's own cached cells read at runtime, or with expectations recomputed
// from the sheet's own cells where §9.3 says the sheet broke or the app's definition differs by
// decision. Nothing here holds an owner value: only template cell references and rules. Gated on
// the Stage 2–4 engines and importers, and skipped when the workbook is absent. Prints counts only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import { importWorkbook, readWorkbook, type WorkbookReader } from '@joinr/importer';
import {
  describeWithLocalWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  IMPORTER_STAGE4_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  addMonthsIso,
  centsFromNumber,
  JoinrDecimal,
  multiplyToCents,
  type CashPageResponse,
  type IsoDate,
  type OtherAssetsPageResponse,
  type PropertyPageResponse,
  type SuperPageResponse,
} from '@joinr/schema';
import { instruments, trades } from '@joinr/schema/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED;

// ─── Counting (§9.3 rule 13) ────────────────────────────────────────────────────────────────────

type Reason =
  | 'live_window'
  | 'defined_by_decision'
  | 'fixed_definition'
  | 'first_period'
  | 'market_off'
  | 'unpriced'
  | 'never';
type RecomputeReason =
  'no_purchase_date' | 'fx_included' | 'negative_lvr' | 'retirement_tagged' | 'unpriced';
interface Tally {
  compared: number;
  skipped: Partial<Record<Reason, number>>;
  recomputed: Partial<Record<RecomputeReason, number>>;
}
const tallies: Record<string, Tally> = {};
const tally = (area: string): Tally =>
  (tallies[area] ??= { compared: 0, skipped: {}, recomputed: {} });
const compared = (area: string, n = 1) => {
  tally(area).compared += n;
};
const skipped = (area: string, reason: Reason, n = 1) => {
  const s = tally(area).skipped;
  s[reason] = (s[reason] ?? 0) + n;
};
const recomputed = (area: string, reason: RecomputeReason, n = 1) => {
  const s = tally(area).recomputed;
  s[reason] = (s[reason] ?? 0) + n;
};

// ─── Tolerances (§9.5): labels name template cells only, never values ───────────────────────────

const rel = (v: number) => 1e-9 * Math.abs(v);
/** Money (cents) vs a sheet dollar figure × 100, half away from zero; `cents` = the listed bound. */
function expectMoney(actual: number | null, sheetDollars: number | null, label: string, cents = 1) {
  if (sheetDollars === null) {
    expect(actual, label).toBeNull();
    return;
  }
  const want = centsFromNumber(sheetDollars);
  expect(actual, label).not.toBeNull();
  expect(Math.abs(actual! - want) <= Math.max(cents, rel(want)), label).toBe(true);
}
/** A ratio from unrounded decimals: max(1e-9, 1e-9 × |v|). */
function expectRatio(actual: string | null, sheet: number | null, label: string) {
  if (sheet === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(Math.abs(Number(actual) - sheet) <= Math.max(1e-9, rel(sheet)), label).toBe(true);
}

// ─── Date helpers (sheet semantics) ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayOf = (iso: IsoDate) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

// ─── The sheet's rows ───────────────────────────────────────────────────────────────────────────

interface HistoryRow {
  row: number;
  date: IsoDate;
  live: boolean;
}

/** History rows from 3 with a date in A; `live` = B holds a formula (the live row). */
function readHistory(r: WorkbookReader): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (let row = 3; row <= 799; row++) {
    const date = r.date('History', `A${row}`);
    if (date === null) break;
    out.push({ row, date, live: (r.cell('History', `B${row}`)?.formula ?? null) !== null });
  }
  return out;
}

/** The frozen rows the importer keeps: one per month, the later run date (stage-1 §4.3). */
function keptRows(history: readonly HistoryRow[]): HistoryRow[] {
  const frozen = history.filter((h) => !h.live);
  const byMonth = new Map<string, HistoryRow>();
  for (const h of frozen) {
    const prev = byMonth.get(h.date.slice(0, 7));
    if (!prev || h.date >= prev.date) byMonth.set(h.date.slice(0, 7), h);
  }
  return frozen.filter((h) => byMonth.get(h.date.slice(0, 7)) === h);
}

/** A SheetOptions value (column L) by its column-P ID, rows 3 → 60. */
function sheetOption(r: WorkbookReader, id: number): string | null {
  for (let row = 3; row <= 60; row++) {
    if (r.number('SheetOptions', `P${row}`) === id) return r.text('SheetOptions', `L${row}`);
  }
  return null;
}

/** The used Property slots D…O (the Stage 1 import predicate). */
function usedPropertyColumns(r: WorkbookReader): string[] {
  const out: string[] = [];
  for (let c = 'D'.charCodeAt(0); c <= 'O'.charCodeAt(0); c++) {
    const col = String.fromCharCode(c);
    const n = (row: number) => r.number('Property', `${col}${row}`);
    const nonZero = (v: number | null) => v !== null && v !== 0;
    if (
      nonZero(n(18)) ||
      nonZero(n(19)) ||
      nonZero(n(28)) ||
      nonZero(n(29)) ||
      r.date('Property', `${col}16`) !== null
    ) {
      out.push(col);
    }
  }
  return out;
}

/**
 * §9.3 rule 6: row 30 of every used slot with a loan is a formula referencing only rows 28 and 29
 * of its own column (principal only), so F11 and the live History AD equal start − current (D66).
 */
function principalOnly(r: WorkbookReader, columns: readonly string[]): boolean {
  return columns.every((col) => {
    const n = (row: number) => r.number('Property', `${col}${row}`);
    if ((n(28) ?? 0) === 0 && (n(29) ?? 0) === 0) return true;
    const formula = r.cell('Property', `${col}30`)?.formula ?? null;
    if (formula === null) return false;
    const refs = formula.toUpperCase().match(/\$?[A-Z]+\$?\d+/g) ?? [];
    return refs.length > 0 && refs.every((ref) => new RegExp(`^\\$?${col}\\$?(28|29)$`).test(ref));
  });
}

// ─── The test ───────────────────────────────────────────────────────────────────────────────────

describeWithLocalWorkbook('assets server golden (import → DB → API)', (workbookPath) => {
  describe.skipIf(!GATED)('corrections off, market off, as of the workbook date', () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    let r: WorkbookReader;
    let asOf: IsoDate;
    let lastRun: IsoDate;
    let history: HistoryRow[];
    let kept: HistoryRow[];
    let other: OtherAssetsPageResponse;
    let sup: SuperPageResponse;
    let property: PropertyPageResponse;
    let cash: CashPageResponse;

    beforeAll(async () => {
      const bytes = new Uint8Array(readFileSync(workbookPath));
      r = readWorkbook(bytes);
      const e52 = r.date('Net Worth', 'E52');
      const c51 = r.date('Net Worth', 'C51');
      if (e52 === null || c51 === null) throw new Error('Net Worth!E52 or C51 is not a date');
      asOf = e52;
      lastRun = c51;
      history = readHistory(r);
      kept = keptRows(history);
      const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
      const now = new Date(y, m - 1, d, 12, 0, 0);

      tempDir = await makeTempDir('joinr-golden-assets-');
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
      const get = async <T>(url: string): Promise<T> => {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        return res.json<T>();
      };
      other = await get<OtherAssetsPageResponse>('/api/other-assets');
      sup = await get<SuperPageResponse>('/api/super');
      property = await get<PropertyPageResponse>('/api/property');
      cash = await get<CashPageResponse>('/api/cash');
      expect(other.asOf).toBe(asOf);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (tempDir) await removeDir(tempDir);
      for (const [area, t] of Object.entries(tallies)) {
        console.log(
          `[golden:server:assets] ${area} compared: ${t.compared} · skipped: ${JSON.stringify(t.skipped)} · recomputed: ${JSON.stringify(t.recomputed)}`,
        );
      }
    });

    it('Other Assets: every row (N, O, P, Q; R of dated rows), D3–D5 and the D73 date', () => {
      const area = 'Other Assets';
      const s = 'Other Assets';
      const bySheetRef = new Map(other.assets.map((a) => [a.sheetRef, a]));
      let rows = 0;
      let valued = 0;
      let gains = 0;
      // Rule 17: Σ P and Σ N over the valued rows, for D4 and D5 without the unpriced rows.
      let unpricedRows = 0;
      let sumP = 0;
      let sumN = 0;
      for (let row = 3; row <= 500; row++) {
        if (r.isBlank(s, `F${row}`)) continue;
        rows += 1;
        const at = (c: string) => `${s}!${c}${row}`;
        const a = bySheetRef.get(at('F'));
        expect(a, at('F')).toBeDefined();
        const n = (c: string) => r.number(s, `${c}${row}`);
        const currency = (r.text(s, `I${row}`) ?? 'AUD').toUpperCase();
        const date = r.date(s, `G${row}`);
        expectMoney(a!.costCents, n('N'), at('N'));
        compared(area);
        if (a!.priceSource === 'manual' && r.isBlank(s, `K${row}`)) {
          // Rule 17: a hand-priced row with a blank K is unpriced in the app ("No price yet"),
          // not the sheet's 100 % loss (O = M × 0, P = −N); its cost still counts above.
          expect(a!.flags, at('K')).toContain('unpriced');
          expect(a!.valueCents, at('O')).toBeNull();
          expect(a!.gainCents, at('P')).toBeNull();
          expect(a!.gainRatio, at('Q')).toBeNull();
          expect(a!.cagrRatio, at('R')).toBeNull();
          skipped(area, 'unpriced', 4);
          unpricedRows += 1;
          continue;
        }
        if (currency !== 'AUD') {
          // Market off: no live FX rate, so the value is unknown (live_fx_missing).
          expect(a!.valueCents, at('O')).toBeNull();
          skipped(area, 'market_off', 4);
          continue;
        }
        const O = n('O');
        const N = n('N');
        expectMoney(a!.valueCents, O, at('O'));
        // P = O − N: the app subtracts the two rounded figures, so the row adds up (±1 cent).
        expectMoney(a!.gainCents, n('P'), at('P'));
        compared(area, 2);
        if (a!.valueCents !== null) valued += 1;
        if (a!.gainCents !== null) gains += 1;
        const P = n('P');
        if (O !== null && N !== null && P !== null) {
          sumP += P;
          sumN += N;
        }
        // Q = P ÷ N; a zero cost is the sheet's error and the engine's null (rule 15).
        if (N === 0) {
          expect(a!.gainRatio, at('Q')).toBeNull();
          compared(area); // rule 15: the sheet's error, IFERROR 0 or "-" is the engine's null
        } else {
          expectRatio(a!.gainRatio, n('Q'), at('Q'));
          compared(area);
        }
        // R: dated rows as cached (at E52); undated rows from the D73 assumed date (rule 1).
        if (O === null || N === null || N <= 0) continue;
        if (date !== null) {
          expectRatio(a!.cagrRatio, n('R'), at('R'));
          compared(area);
        } else {
          const days = dayOf(asOf) - dayOf(other.assumedDate!);
          const want = days > 0 ? (O / N) ** (365.25 / days) - 1 : null;
          if (want === null) expect(a!.cagrRatio, at('R')).toBeNull();
          else
            expect(
              Math.abs(Number(a!.cagrRatio) - want) <= Math.max(1e-9, 1e-9 * Math.abs(want)),
              at('R'),
            ).toBe(true);
          recomputed(area, 'no_purchase_date');
        }
      }
      expect(other.assets).toHaveLength(rows);

      // D3 (Σ n rounded rows: ⌈n/2⌉ cents), D4 (Σ n gains: n cents), D5. An unpriced row's O is
      // 0 in the sheet, so D3 holds either way.
      expectMoney(other.totals.valueCents, r.number(s, 'D3'), `${s}!D3`, Math.ceil(valued / 2));
      compared(area);
      if (unpricedRows === 0) {
        expectMoney(other.totals.gainCents, r.number(s, 'D4'), `${s}!D4`, Math.max(1, gains));
        expectRatio(other.totals.gainRatio, r.number(s, 'D5'), `${s}!D5`);
        compared(area, 2);
      } else {
        // Rule 17: D4 and D5 recomputed without the unpriced rows' 100 % losses (Σ P, Σ P ÷ Σ N
        // over the other valued rows).
        expectMoney(other.totals.gainCents, sumP, `${s}!D4 (rule 17)`, Math.max(1, gains));
        expectRatio(other.totals.gainRatio, sumN > 0 ? sumP / sumN : null, `${s}!D5 (rule 17)`);
        recomputed(area, 'unpriced', 2);
      }
      // D73: the earliest imported snapshot's run date.
      expect(other.assumedDate).toBe(kept[0]?.date ?? null);
      compared(area);
    });

    it('Super: B12, the provisional B16, every closed Q and the History-derived contributions', () => {
      const area = 'Super';
      // B12, or Σ B2:B7 when the Retirement-tagged auto lines are used (rule 16).
      const autoLines = ['B8', 'B9', 'B10'].map((c) => r.number('Super', c) ?? 0);
      if (autoLines.some((v) => v !== 0)) {
        let funds = 0;
        for (let row = 2; row <= 7; row++) funds += r.number('Super', `B${row}`) ?? 0;
        expectMoney(sup.totalCents, funds, 'Super!B2:B7');
        recomputed(area, 'retirement_tagged');
      } else {
        expectMoney(sup.totalCents, r.number('Super', 'B12'), 'Super!B12');
        compared(area);
      }
      // B16: the provisional period's net-pay cost (imported months keep it, D71).
      const provisional = sup.periods.find((p) => p.status === 'provisional');
      expect(provisional, 'provisional period').toBeDefined();
      expectMoney(
        provisional!.flows?.memberNetPayCents ?? null,
        r.number('Super', 'B16') ?? 0,
        'Super!B16',
      );
      compared(area);
      // Every recorded period's value is its History Q.
      const byRun = new Map(sup.periods.map((p) => [p.runDate, p]));
      for (const h of kept) {
        const p = byRun.get(h.date);
        expect(p, `History!A${h.row}`).toBeDefined();
        expectMoney(p!.valueCents, r.number('History', `Q${h.row}`), `History!Q${h.row}`);
        compared(area);
      }
      skipped(area, 'live_window', history.filter((h) => h.live).length);
      // The History-derived contributions (§3.5 item 2): one per kept row with a non-zero R, dated
      // at its run date. D37 (rule 16): with SheetOptions ID 43 "Yes", a row's R also holds the
      // window's buys of Retirement-tagged Stocks, ETFs and Managed Funds holdings (the imported
      // trades and tags), which are left out (never below 0; 0 gives no entry).
      const retirement = (sheetOption(r, 43) ?? '').toLowerCase() === 'yes';
      const tagged = new Set(
        database.db
          .select({ id: instruments.id, kind: instruments.kind, tag: instruments.isRetirement })
          .from(instruments)
          .all()
          .filter((i) => i.tag && ['stock', 'etf', 'managed_fund'].includes(i.kind))
          .map((i) => i.id),
      );
      const buys = database.db
        .select()
        .from(trades)
        .all()
        .filter((t) => tagged.has(t.instrumentId) && new JoinrDecimal(t.units).greaterThan(0));
      const expected = new Map<string, number>();
      kept.forEach((h, i) => {
        const R = r.number('History', `R${h.row}`);
        if (R === null || R === 0) return;
        const rCents = centsFromNumber(R);
        const from = i === 0 ? addMonthsIso(h.date, -1) : kept[i - 1]!.date;
        const excluded = retirement
          ? buys
              .filter((t) => t.tradeDate > from && t.tradeDate <= h.date)
              .reduce((s, t) => s + multiplyToCents(t.units, t.price), 0)
          : 0;
        if (excluded > 0) recomputed(area, 'retirement_tagged');
        const amount = excluded > 0 ? Math.max(0, rCents - excluded) : rCents;
        if (amount !== 0) expected.set(`History!R${h.row}`, amount);
      });
      const derived = sup.contributions.filter((c) => c.sheetRef?.startsWith('History!R'));
      expect(derived.map((c) => c.sheetRef).sort()).toEqual([...expected.keys()].sort());
      for (const c of derived) {
        const want = expected.get(c.sheetRef!)!;
        expect(Math.abs(c.amountCents - want) <= 1, c.sheetRef!).toBe(true);
      }
      compared(area, 2); // the count and each amount (Σ History!R of the kept rows)
      // Every History-derived entry falls in its own snapshot's period.
      for (const c of derived) {
        const row = Number(c.sheetRef!.slice('History!R'.length));
        const h = history.find((x) => x.row === row);
        expect(c.date, `History!A${row}`).toBe(h?.date);
      }
      skipped(area, 'defined_by_decision', 2); // B11, B19 (D69)
    });

    it('Property: F6–F12, Net Worth!C21, per property 21, 22, 34 and the imported X30', () => {
      const area = 'Property';
      const s = 'Property';
      const t = property.totals;
      const columns = usedPropertyColumns(r);
      expectMoney(
        t.purchaseCents,
        r.number(s, 'F6'),
        `${s}!F6`,
        Math.max(1, Math.ceil(columns.length / 2)),
      );
      expectMoney(
        t.valueCents,
        r.number(s, 'F7'),
        `${s}!F7`,
        Math.max(1, Math.ceil(columns.length / 2)),
      );
      expectMoney(
        t.gainCents,
        r.number(s, 'F8'),
        `${s}!F8`,
        Math.max(1, Math.ceil(columns.length / 2)),
      );
      compared(area, 3);
      // F9 = F8 ÷ F6 (IFERROR 0 when F6 = 0: the engine's null, rule 15).
      const f6 = r.number(s, 'F6') ?? 0;
      if (f6 === 0) {
        expect(t.gainRatio, `${s}!F9`).toBeNull();
        compared(area); // rule 15: the sheet's error, IFERROR 0 or "-" is the engine's null
      } else {
        expectRatio(t.gainRatio, r.number(s, 'F9'), `${s}!F9`);
        compared(area);
      }
      const f10 = r.number(s, 'F10');
      expectMoney(t.mortgageCents, f10 === null ? null : Math.abs(f10), `|${s}!F10|`);
      compared(area);
      const principalRule = principalOnly(r, columns);
      if (principalRule) {
        expectMoney(t.principalPaidCents, r.number(s, 'F11'), `${s}!F11`);
        compared(area);
      } else {
        skipped(area, 'defined_by_decision');
      }
      // F12: displayed negative (rule 8); "-" when F7 = 0 (the engine's null, rule 15).
      const f12 = r.number(s, 'F12');
      if (f12 === null) {
        expect(t.lvrRatio, `${s}!F12`).toBeNull();
        compared(area); // rule 15: the sheet's error, IFERROR 0 or "-" is the engine's null
      } else if (f12 < 0) {
        expectRatio(t.lvrRatio, -f12, `−${s}!F12`);
        recomputed(area, 'negative_lvr');
      } else {
        expectRatio(t.lvrRatio, f12, `${s}!F12`);
        compared(area);
      }
      const c21 = r.number('Net Worth', 'C21');
      expectMoney(t.startBalanceCents, c21 === null ? null : Math.abs(c21), '|Net Worth!C21|');
      compared(area);

      // Per property (the slot column from its sheet ref) and per loan.
      const slotOf = (ref: string | null) => /^Property!([A-Z]+)\d+$/.exec(ref ?? '')?.[1] ?? null;
      for (const p of property.properties) {
        const col = slotOf(p.sheetRef);
        expect(col, p.sheetRef ?? 'property').not.toBeNull();
        const at = (row: number) => `${s}!${col}${row}`;
        expectMoney(p.gainCents, r.number(s, `${col}21`), at(21));
        compared(area);
        const purchase = r.number(s, `${col}18`) ?? 0;
        if (purchase === 0) {
          expect(p.gainRatio, at(22)).toBeNull();
          compared(area); // rule 15: the sheet's error, IFERROR 0 or "-" is the engine's null
        } else {
          expectRatio(p.gainRatio, r.number(s, `${col}22`), at(22));
          compared(area);
        }
        const value = r.number(s, `${col}19`) ?? 0;
        if (value === 0) {
          expect(p.lvrRatio, at(34)).toBeNull();
          compared(area); // rule 15: the sheet's error, IFERROR 0 or "-" is the engine's null
        } else {
          expectRatio(p.lvrRatio, r.number(s, `${col}34`), at(34));
          compared(area);
        }
        skipped(area, 'fixed_definition', 3); // 23, 33, 35 (§11 fixes 8, 3, 2)
        skipped(area, 'defined_by_decision'); // 31 (D66)
      }
      for (const l of property.loans) {
        if (l.propertyId === null) continue;
        const col = slotOf(l.sheetRef);
        if (col === null) continue;
        const x30 = r.number(s, `${col}30`);
        expect(l.imported, `${s}!${col}30`).not.toBeNull();
        expectMoney(
          l.imported!.paymentsPaidCents,
          x30 === null ? null : Math.abs(x30),
          `|${s}!${col}30|`,
        );
        compared(area);
      }
    });

    it("Cash: the provisional period's super, principal, other-asset and offsets parts", () => {
      const area = 'Cash provisional';
      const p = cash.periods.find((x) => x.status === 'provisional');
      expect(p?.added, 'provisional period').toBeTruthy();
      const added = p!.added!;
      expect(cash.staticUntilStage4).toBe(false);
      // The super part: B16's net-pay cost (the History-derived entries sit in closed periods).
      expectMoney(added.superCents, r.number('Super', 'B16') ?? 0, 'Super!B16');
      compared(area);
      // The mortgage principal: live AD − the last frozen AD, when the setting counts it.
      const live = history.find((h) => h.live);
      const lastFrozen = history.filter((h) => !h.live && h.date <= lastRun).at(-1);
      const include = cash.settings.values['savings.includeMortgagePrincipal'] === true;
      if (!include) {
        expect(added.mortgagePrincipalCents).toBe(0);
        compared(area);
      } else if (!live || !lastFrozen || !principalOnly(r, usedPropertyColumns(r))) {
        skipped(area, 'defined_by_decision');
      } else {
        const ad = (row: number) => r.number('History', `AD${row}`) ?? 0;
        expectMoney(added.mortgagePrincipalCents, ad(live.row) - ad(lastFrozen.row), 'ΔHistory!AD');
        compared(area);
      }
      // The other-asset flows dated in (C51, E52]: the sheet's N by G (dated AUD rows).
      let flows = 0;
      let n = 0;
      let foreign = false;
      for (let row = 3; row <= 500; row++) {
        if (r.isBlank('Other Assets', `F${row}`)) continue;
        const g = r.date('Other Assets', `G${row}`);
        if (g === null || g <= lastRun || g > asOf) continue;
        if ((r.text('Other Assets', `I${row}`) ?? 'AUD').toUpperCase() !== 'AUD') foreign = true;
        flows += r.number('Other Assets', `N${row}`) ?? 0;
        n += 1;
      }
      if (foreign) {
        skipped(area, 'market_off');
      } else {
        expectMoney(
          added.otherAssetsCents,
          flows,
          'Σ Other Assets!N by G',
          Math.max(1, Math.ceil(n / 2)),
        );
        compared(area);
      }
      // An import writes no offset link; without an account flagged Offset there is no Δ offsets.
      expect(cash.accounts.every((a) => a.linkedLoan === null)).toBe(true);
      compared(area);
      if (cash.accounts.some((a) => a.isOffset)) {
        skipped(area, 'defined_by_decision');
      } else {
        expect(added.offsetsCents).toBe(0);
        expect(cash.periods.every((x) => x.added === null || x.added.offsetsCents === 0)).toBe(
          true,
        );
        compared(area);
      }
    });
  });
});
