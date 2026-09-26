// Stage 4 goldens (stage-4.md §9.2–§9.5): the Other Assets, Super and Property engines on
// sheet-faithful inputs against the local workbook's cached cells. Skipped when reference/ holds no
// single workbook. Every expected value is read at runtime; this file holds template cell
// references and rules only, and prints counts only (compared, skipped by reason, recomputed by
// reason). TODAY()-dependent cells are compared at the workbook's as-of (Net Worth!E52).
import { negateCents } from '../../src/assetsCommon';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amortise,
  assetsSnapshotColumns,
  computeOtherAssets,
  computeProperty,
  computeSuper,
  otherAssetsCostHeldAt,
  type OtherAssetsResult,
  type PropertiesResult,
  type SuperResult,
} from '../../src/index';
import { daysBetween } from '../../src/num';
import { Sheet } from './adapter';
import { AssetsSheet, OTHER_ASSETS, PROPERTY, SUPER } from './assetsAdapter';
import {
  cagrFromCells,
  costBefore,
  costDatedBetween,
  costOnOrBefore,
  cumipmt,
  datedifYears,
  edate,
  roundUp,
  sheetNper,
} from './assetsFormulas';
import { AssetsTally, sheetCents, type AssetsRecomputeReason } from './assetsTally';
import { monthEnd } from './cashflowAdapter';

const GOLDEN_TIMEOUT = 120_000;

describeWithLocalWorkbook('golden: the Stage 4 assets engines against the local workbook', () => {
  describe('cached cells', { timeout: GOLDEN_TIMEOUT }, () => {
    let a: AssetsSheet;
    let other: OtherAssetsResult;
    let sup: SuperResult;
    let prop: PropertiesResult;
    const tallies: AssetsTally[] = [];
    const tallyOf = (area: string) => {
      const t = new AssetsTally(area);
      tallies.push(t);
      return t;
    };
    /** Adapter validations (the helpers recompute a cell the goldens skip; never counted). */
    const validations: string[] = [];
    const validate = (ref: string, ok: boolean) => {
      if (!ok) validations.push(ref);
    };

    beforeAll(() => {
      const bytes = readLocalWorkbookBytes();
      if (bytes === null) throw new Error('golden: the local workbook could not be read');
      a = new AssetsSheet(new Sheet(readWorkbook(bytes)));
      other = computeOtherAssets(a.otherAssetsInput());
      sup = computeSuper(a.superInput());
      prop = computeProperty(a.propertyInput());
    }, GOLDEN_TIMEOUT);

    afterAll(() => {
      // Counts only (§9.3 rule 13): never a value, an item, a fund or a lender.
      for (const t of tallies) console.log(t.line());
      console.log(`[golden] Stage 4 adapter validations: failed: ${validations.length}`);
    });

    it('Other Assets: M–R per row and D3–D5 (rules 1, 14, 15)', () => {
      const t = tallyOf('Other Assets rows and totals');
      compareOtherAssetRows(a, other, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Other Assets history: Y:AC and the cost line (rules 3–5)', () => {
      const t = tallyOf('Other Assets history');
      compareOtherAssetsHistory(a, other, t, validate);
      // The live chart point is the totals (compared as D3, D4; §9.3 rule 4).
      const live = other.chart.find((p) => p.live);
      validate('Other Assets live chart point', live?.valueCents === other.totals.valueCents);
      expect(t.failures).toEqual([]);
      expect(validations).toEqual([]);
    });

    it('Super: B12, B16 and E:J per History row (rules 2, 6, 7, 16)', () => {
      const t = tallyOf('Super');
      compareSuper(a, sup, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Property: F6–F12, Net Worth C21, the slot rows and Z:AF (rules 2, 6, 8–10, 15)', () => {
      const t = tallyOf('Property');
      compareProperty(a, prop, t, validate);
      expect(t.failures).toEqual([]);
      expect(validations).toEqual([]);
    });

    it('History live row: Q–T, X–AE, AJ–AK through assetsSnapshotColumns (rules 2, 6, 16)', () => {
      const t = tallyOf('History live row');
      compareLiveRow(a, other, sup, prop, t);
      expect(t.failures).toEqual([]);
    });

    it('Cash!L parts: the dated other-asset flows per window (rule 11)', () => {
      const t = tallyOf('Cash!L other-asset flows');
      compareCashFlows(a, other, t);
      expect(t.failures).toEqual([]);
    });
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** A money cell the sheet leaves blank (null ↔ null exactly) or holds. */
function moneyOrBlank(
  t: AssetsTally,
  ref: string,
  sheet: number | null,
  engine: number | null,
  reason?: AssetsRecomputeReason,
): void {
  if (sheet === null) t.check(ref, engine === null, reason);
  else t.money(ref, sheet, engine, reason);
}

/** A ratio cell the sheet leaves blank or shows an error for a zero denominator (null ↔ null). */
function ratioOrBlank(
  t: AssetsTally,
  ref: string,
  sheet: number | null,
  engine: string | null,
  reason?: AssetsRecomputeReason,
): void {
  if (sheet === null) t.check(ref, engine === null, reason);
  else t.ratio(ref, sheet, engine, reason);
}

/** Σ Super!B2:B7 (the funds) and Σ B8:B10 (the Retirement-tagged auto lines, D37). */
function superParts(a: AssetsSheet): { funds: number; auto: number } {
  let funds = 0;
  for (let r = SUPER.fundsFrom; r <= SUPER.fundsTo; r++) {
    if (!a.wb.isBlank(SUPER.sheet, `A${r}`)) funds += a.wb.number(SUPER.sheet, `B${r}`) ?? 0;
  }
  const auto = SUPER.autoLines.reduce((s, addr) => s + (a.wb.number(SUPER.sheet, addr) ?? 0), 0);
  return { funds, auto };
}

/** Rule 16: the Retirement-tagged buys History R holds for the window `(from, to]` (0 when off). */
function retirementPart(a: AssetsSheet, from: string, to: string): number {
  return a.retirementContributions ? a.retirementBuysCents(from, to) : 0;
}

// ─── Other Assets rows and totals (§9.2; rules 1, 14, 15) ─────────────────────────────────────

function compareOtherAssetRows(a: AssetsSheet, other: OtherAssetsResult, t: AssetsTally): void {
  const s = OTHER_ASSETS.sheet;
  const byId = new Map(other.assets.map((r) => [r.id, r]));
  let valued = 0;
  let gained = 0;
  let everyValuedRowCosted = true;
  for (const row of a.otherAssets) {
    const r = byId.get(row.row);
    const ref = (col: string) => `${s}!${col}${row.row}`;
    if (r === undefined) {
      t.check(`${ref('F')} (no engine row)`, false);
      continue;
    }
    // M: the sheet leaves it blank when H ≤ 0 (the engine: 0 units).
    t.units(ref('M'), row.M === null ? 0 : Math.max(0, row.M), r.remainingUnits);
    moneyOrBlank(t, ref('N'), row.N, r.costCents);
    moneyOrBlank(t, ref('O'), row.O, r.valueCents);
    moneyOrBlank(t, ref('P'), row.P, r.gainCents);
    // Q = P ÷ N: blank with P, and an error when N = 0, where the engine has no ratio (rule 15).
    ratioOrBlank(t, ref('Q'), row.Q, r.gainRatio);
    if (row.O !== null) valued += 1;
    if (row.P !== null) gained += 1;
    if (row.O !== null && row.N === null) everyValuedRowCosted = false;

    // R: the sheet's RRI over TODAY() − G at the as-of.
    if (row.P === null || row.N === null || row.O === null) {
      ratioOrBlank(t, ref('R'), row.R, r.cagrRatio);
    } else if (row.purchaseDate === null) {
      // Rule 1: TODAY() − 0 is meaningless; the D73 assumed date instead.
      const days = a.assumedDate === null ? null : daysBetween(a.assumedDate, a.asOf);
      const expected = days === null ? null : cagrFromCells(row.O, row.N, days);
      ratioOrBlank(t, ref('R'), expected, r.cagrRatio, 'no_purchase_date');
    } else if (row.currency !== 'AUD') {
      // Rule 14: the engine's CAGR includes FX; recomputed from the sheet's own AUD cells.
      const expected = cagrFromCells(row.O, row.N, daysBetween(row.purchaseDate, a.asOf));
      ratioOrBlank(t, ref('R'), expected, r.cagrRatio, 'fx_included');
    } else {
      ratioOrBlank(t, ref('R'), row.R, r.cagrRatio);
    }
  }
  const wb = a.wb;
  t.sumMoney(`${s}!D3`, wb.number(s, 'D3'), other.totals.valueCents, valued);
  t.sumGains(`${s}!D4`, wb.number(s, 'D4'), other.totals.gainCents, gained);
  // D5 = D4 ÷ (D3 − D4) equals the engine's Σ gains ÷ Σ costs when every valued row has a cost;
  // a zero cost total is the sheet's IFERROR 0 and the engine's null (rule 15).
  if (!everyValuedRowCosted) t.skip('defined_by_decision');
  else {
    t.ratioOrZeroDenominator(
      `${s}!D5`,
      wb.number(s, 'D5'),
      other.totals.gainRatio,
      other.totals.costCents === 0,
    );
  }
}

// ─── Other Assets history Y:AC (§9.2; rules 3–5) ──────────────────────────────────────────────

function compareOtherAssetsHistory(
  a: AssetsSheet,
  other: OtherAssetsResult,
  t: AssetsTally,
  validate: (ref: string, ok: boolean) => void,
): void {
  const s = OTHER_ASSETS.sheet;
  const wb = a.wb;
  const costRows = a.costRows();
  const dated = a.otherAssets.filter((r) => r.purchaseDate !== null).map((r) => r.asset);
  const hasUndated = a.otherAssets.some((r) => r.purchaseDate === null);
  const points = new Map(other.chart.filter((p) => !p.live).map((p) => [p.date, p]));
  const liveDate = a.live?.date ?? null;
  for (let yr = OTHER_ASSETS.historyFirstRow; yr <= OTHER_ASSETS.lastRow; yr++) {
    const date = wb.date(s, `Y${yr}`);
    if (date === null) break;
    const ref = (col: string) => `${s}!${col}${yr}`;
    // Rule 4: the current month's row is blank in the sheet (the chart's zero, §11 fix 14).
    const lastRow = wb.date(s, `Y${yr + 1}`) === null;
    if (date === liveDate || (lastRow && wb.number(s, `Z${yr}`) === null)) {
      t.skip('current_month_blank', 4);
      continue;
    }
    const point = points.get(date) ?? null;
    // Z: the dated items' cost held (the sheet's `<`); a purchase on the date is recomputed with
    // `≤` (rule 3, §11 fix 13).
    const [engineZ] = otherAssetsCostHeldAt({ assets: dated, assumedDate: null, dates: [date] });
    const sheetZ = wb.number(s, `Z${yr}`);
    // The helper reproduces the sheet's own Z from G and N (an adapter check, not counted).
    validate(
      `${ref('Z')} helper`,
      sheetZ !== null && Math.abs(costBefore(costRows, date) - sheetZ) <= 0.005,
    );
    const boundary = costRows.some((c) => c.purchaseDate === date && c.cost !== null);
    if (boundary) {
      t.money(ref('Z'), costOnOrBefore(costRows, date, null), engineZ ?? null, 'boundary_purchase');
    } else {
      t.money(ref('Z'), sheetZ, engineZ ?? null);
    }
    // AA, AB: the stored History AJ, AK.
    const aa = wb.number(s, `AA${yr}`);
    const ab = wb.number(s, `AB${yr}`);
    t.money(ref('AA'), aa, point?.valueCents ?? null);
    t.money(ref('AB'), ab, point?.gainCents ?? null);
    // AC = AB ÷ (AA − AB), the engine's from the stored cents (rule 5: none on the first row).
    if (yr === OTHER_ASSETS.historyFirstRow) t.skip('never');
    else if (aa === null || ab === null) t.check(ref('AC'), false);
    else {
      const den = sheetCents(aa) - sheetCents(ab);
      t.ratioOrZeroDenominator(
        ref('AC'),
        den === 0 ? null : sheetCents(ab) / den,
        point?.gainRatio ?? null,
        den === 0,
      );
    }
    // Rule 3: the D73 line (every item; undated ones from the assumed date), recomputed.
    if (hasUndated) {
      t.money(
        `${ref('Z')} (D73)`,
        costOnOrBefore(costRows, date, a.assumedDate),
        point?.costCents ?? null,
        'assumed_date',
      );
    }
  }
}

// ─── Super (§9.2; rules 2, 6, 7, 16) ──────────────────────────────────────────────────────────

function compareSuper(a: AssetsSheet, sup: SuperResult, t: AssetsTally): void {
  const s = SUPER.sheet;
  const wb = a.wb;
  const { funds, auto } = superParts(a);
  // B12 = Σ B2:B10; rule 16: with Retirement-tagged auto lines, the funds alone.
  if (auto !== 0) t.money(`${s}!B12`, funds, sup.totalCents, 'retirement_tagged');
  else t.money(`${s}!B12`, wb.number(s, SUPER.total), sup.totalCents);
  // B16: the live month's contribution, the provisional R.
  t.money(`${s}!B16`, wb.number(s, SUPER.voluntary) ?? 0, sup.snapshot.superContribCents);
  // B11 (the reported gain) and B19 (SLOPE × 365): the derived gain and the chained return (D69).
  t.skip('defined_by_decision', 2);

  const periods = new Map(
    sup.periods.filter((p) => p.status !== 'provisional').map((p) => [p.runDate, p]),
  );
  const provisional = sup.periods.find((p) => p.status === 'provisional') ?? null;
  const windows = new Map(a.snapshotWindows().map((w) => [w.row.row, w]));
  const kept = new Set(a.kept.map((h) => h.row));
  let previous: string | null = null;
  for (const h of a.history) {
    const ref = (col: string) => `${s}!${col}${h.row}`;
    if (!h.frozen) {
      // Rule 2: the live row's date is the month end, not the provisional run date.
      t.skip('live_window');
      const buys = previous === null ? 0 : retirementPart(a, previous, h.date);
      const g = wb.number(s, `G${h.row}`);
      if (buys > 0) {
        t.money(
          ref('G'),
          wb.number(s, SUPER.voluntary) ?? 0,
          provisional?.flows?.memberNetPayCents ?? null,
          'retirement_tagged',
        );
      } else {
        t.money(ref('G'), g, provisional?.flows?.memberNetPayCents ?? null);
      }
      if (auto !== 0)
        t.money(ref('H'), funds, provisional?.valueCents ?? null, 'retirement_tagged');
      else t.money(ref('H'), wb.number(s, `H${h.row}`), provisional?.valueCents ?? null);
      t.skip('defined_by_decision', 2); // I, J (D69)
      continue;
    }
    previous = h.date;
    if (!kept.has(h.row)) {
      // A second row in one month: never imported (the importer's one-per-month rule).
      t.skip('never', 4);
      t.skip('defined_by_decision', 2);
      continue;
    }
    const p = periods.get(h.date) ?? null;
    t.exact(ref('E'), wb.date(s, `E${h.row}`), p?.runDate ?? null);
    if (p?.status === 'first')
      t.skip('first_period'); // the baseline carries no flows (rule 11)
    else {
      const w = windows.get(h.row);
      const buys = w === undefined ? 0 : retirementPart(a, w.from, w.to);
      const g = wb.number(s, `G${h.row}`);
      if (buys > 0 && g !== null) {
        const r = sheetCents(g);
        t.check(
          ref('G'),
          (p?.flows?.memberNetPayCents ?? null) === Math.max(0, r - buys),
          'retirement_tagged',
        );
      } else {
        t.money(ref('G'), g, p?.flows?.memberNetPayCents ?? null);
      }
    }
    t.money(ref('H'), wb.number(s, `H${h.row}`), p?.valueCents ?? null);
    t.skip('defined_by_decision', 2); // I, J (D69)
  }
}

// ─── Property (§9.2; rules 2, 6, 8–10, 15) ────────────────────────────────────────────────────

function compareProperty(
  a: AssetsSheet,
  prop: PropertiesResult,
  t: AssetsTally,
  validate: (ref: string, ok: boolean) => void,
): void {
  const s = PROPERTY.sheet;
  const p = PROPERTY.rows;
  const wb = a.wb;
  const num = (addr: string) => wb.number(s, addr);
  const tot = prop.totals;
  const properties = a.slots.length;
  const loans = a.slots.filter((x) => x.loan !== null).length;
  const principalOnly = a.principalOnlyPayments();

  t.sumMoney(`${s}!F6`, num('F6'), tot.purchaseCents, properties);
  t.sumMoney(`${s}!F7`, num('F7'), tot.valueCents, properties);
  t.sumMoney(`${s}!F8`, num('F8'), tot.gainCents, properties);
  t.ratioOrZeroDenominator(`${s}!F9`, num('F9'), tot.gainRatio, tot.purchaseCents === 0);
  t.sumMoney(`${s}!F10`, num('F10'), negateCents(tot.mortgageCents), loans);
  // Rule 6: F11 is principal only when every row 30 is its own start − current.
  if (principalOnly) t.sumMoney(`${s}!F11`, num('F11'), tot.principalPaidCents, loans);
  else t.skip('defined_by_decision');
  // Rule 8: F12 is negative in the sheet (§11 fix 5); "-" when F7 = 0 (rule 15).
  const f12 = num('F12');
  if (tot.valueCents === 0) t.check(`${s}!F12`, tot.lvrRatio === null);
  else if (f12 !== null && f12 < 0) t.ratio(`${s}!F12`, -f12, tot.lvrRatio, 'negative_lvr');
  else t.ratio(`${s}!F12`, f12, tot.lvrRatio);
  // SPEC-6: Net Worth C21 = −|Σ row 28|; D21 and E21 are aliases of F11 and F10 (not counted).
  t.sumMoney(
    'Net Worth!C21',
    wb.number('Net Worth', 'C21'),
    negateCents(tot.startBalanceCents),
    loans,
  );
  const f11 = num('F11');
  const f10 = num('F10');
  validate('Net Worth!D21', f11 !== null && wb.number('Net Worth', 'D21') === Math.abs(f11));
  validate('Net Worth!E21', f10 !== null && wb.number('Net Worth', 'E21') === -Math.abs(f10));

  for (const slot of a.slots) {
    const ref = (row: number) => `${s}!${slot.col}${row}`;
    const cell = (row: number) => num(`${slot.col}${row}`);
    const row = prop.properties.find((x) => x.id === slot.id);
    if (row === undefined) {
      t.check(`${ref(p.purchase)} (no engine property)`, false);
      continue;
    }
    t.money(ref(p.gain), cell(p.gain), row.gainCents);
    t.ratioOrZeroDenominator(
      ref(p.gainRatio),
      cell(p.gainRatio),
      row.gainRatio,
      row.purchaseValueCents === 0,
    );
    // Row 23 is a simple annualisation (§11 fix 8): skipped; the helper validates the adapter.
    t.skip('fixed_definition');
    const bought = slot.property.purchaseDate;
    const g22 = cell(p.gainRatio);
    const g23 = cell(p.simpleAnnual);
    if (bought !== null && g22 !== null && g23 !== null && daysBetween(bought, a.asOf) !== 0) {
      const expected = (g22 / daysBetween(bought, a.asOf)) * 365;
      validate(
        ref(p.simpleAnnual),
        Math.abs(expected - g23) <= Math.max(1e-9, 1e-9 * Math.abs(g23)),
      );
    }
    t.ratioOrZeroDenominator(ref(p.lvr), cell(p.lvr), row.lvrRatio, row.valueCents === 0);

    const loan =
      slot.loan === null ? null : (prop.loans.find((l) => l.id === slot.loan!.id) ?? null);
    if (slot.loan === null) continue;
    if (loan === null) {
      t.check(`${ref(p.balance)} (no engine loan)`, false);
      continue;
    }
    t.skip('defined_by_decision'); // row 31: interest is derived (D66)
    t.skip('fixed_definition', 2); // rows 33 (CUMIPMT) and 35 (NPER, EDATE): §11 fixes 2, 3
    const sheetMode = a.sheetModeLoan(slot);
    if (sheetMode === null) {
      t.skip('sheet_mode_unavailable', 2);
    } else {
      // Rule 10: X32 is the sheet-mode first period's interest; ⌈NPER⌉ with the whole-cent payment
      // stands in for X35.
      const sm = amortise(sheetMode);
      t.money(ref(p.periodInterest), cell(p.periodInterest), sm.firstPeriodInterestCents);
      const m = sheetMode.compoundingPerYear;
      const rate = Number(sheetMode.annualRate) / m;
      const np = sheetNper(rate, -sheetMode.paymentCents / 100, sheetMode.balanceCents / 100);
      t.exact(`${ref(p.payoff)} (NPER)`, np === null ? null : Math.ceil(np), sm.payments);
    }
    // Rule 9: the helper recomputes X35 and X33 from the sheet's own cells (not counted).
    const freq = cell(p.compounding);
    const annual = cell(p.rate);
    const pay = cell(p.payment);
    const balance = cell(p.balance);
    const payoff = wb.date(s, `${slot.col}${p.payoff}`);
    if (
      freq !== null &&
      freq > 0 &&
      annual !== null &&
      pay !== null &&
      balance !== null &&
      payoff !== null
    ) {
      const np = sheetNper(annual / freq, -Math.abs(pay) * (12 / freq), Math.abs(balance));
      validate(ref(p.payoff), np !== null && edate(a.asOf, (12 / freq) * np) === payoff);
      const n = roundUp(datedifYears(a.asOf, payoff) * freq);
      const future = cell(p.futureInterest);
      const interest = Math.abs(cell(p.interest) ?? 0);
      const expected = -cumipmt(annual / freq, n, Math.abs(balance), 1, n) + interest;
      validate(
        ref(p.futureInterest),
        future !== null && Math.abs(expected - future) <= Math.max(1e-6, 1e-9 * Math.abs(future)),
      );
    }
  }

  // The hidden history Z:AF: Property row r ↔ History row r − 2 (rules 2, 6, 8).
  const points = new Map(prop.chart.filter((x) => !x.live).map((x) => [x.date, x]));
  const live = prop.chart.find((x) => x.live) ?? null;
  const lvrFromCents = (
    ref: string,
    ad: number | null,
    aa: number | null,
    engine: string | null,
  ) => {
    if (ad === null || aa === null) t.check(ref, false);
    else {
      const den = sheetCents(aa);
      // An AC of 0 with AA = 0 is the sheet's IFERROR; the engine's null matches it (rule 8).
      t.ratioOrZeroDenominator(ref, den === 0 ? null : sheetCents(ad) / den, engine, den === 0);
    }
  };
  for (const h of a.history) {
    const r = h.row + PROPERTY.historyOffset;
    const ref = (col: string) => `${s}!${col}${r}`;
    const cell = (col: string) => num(`${col}${r}`);
    if (!h.frozen) {
      t.skip('live_window'); // Z: the month end, not the as-of (rule 2)
      t.money(ref('AA'), cell('AA'), live?.valueCents ?? null);
      t.money(ref('AB'), cell('AB'), live?.purchaseCents ?? null);
      lvrFromCents(ref('AC'), cell('AD'), cell('AA'), live?.lvrRatio ?? null);
      t.money(ref('AD'), cell('AD'), live?.mortgageCents ?? null);
      t.skip('defined_by_decision'); // AE: interest is derived (D66)
      if (principalOnly) t.money(ref('AF'), cell('AF'), live?.principalPaidCents ?? null);
      else t.skip('defined_by_decision');
      continue;
    }
    const point = points.get(h.date) ?? null;
    if (point === null && !a.kept.some((k) => k.row === h.row)) {
      t.skip('never', 7); // a second row in one month is never imported
      continue;
    }
    t.exact(ref('Z'), wb.date(s, `Z${r}`), point?.date ?? null);
    t.money(ref('AA'), cell('AA'), point?.valueCents ?? null);
    t.money(ref('AB'), cell('AB'), point?.purchaseCents ?? null);
    lvrFromCents(ref('AC'), cell('AD'), cell('AA'), point?.lvrRatio ?? null);
    t.money(ref('AD'), cell('AD'), point?.mortgageCents ?? null);
    t.money(ref('AE'), cell('AE'), point?.interestFeesCents ?? null);
    t.money(ref('AF'), cell('AF'), point?.principalPaidCents ?? null);
  }
}

// ─── The History live row (§9.2; rules 2, 6, 16) ──────────────────────────────────────────────

function compareLiveRow(
  a: AssetsSheet,
  other: OtherAssetsResult,
  sup: SuperResult,
  prop: PropertiesResult,
  t: AssetsTally,
): void {
  const h = a.live;
  if (h === null) return;
  const cols = assetsSnapshotColumns({ otherAssets: other, super: sup, property: prop });
  const ref = (col: string) => `History!${col}${h.row}`;
  const cell = (col: string) => a.wb.number('History', `${col}${h.row}`);
  const properties = a.slots.length;
  const loans = a.slots.filter((x) => x.loan !== null).length;
  const valued = a.otherAssets.filter((r) => r.O !== null).length;
  const gained = a.otherAssets.filter((r) => r.P !== null).length;

  // Q, R (rule 16: the Retirement-tagged auto lines and buys).
  const { funds, auto } = superParts(a);
  if (auto !== 0) t.money(ref('Q'), funds, cols.superValueCents, 'retirement_tagged');
  else t.money(ref('Q'), cell('Q'), cols.superValueCents);
  const previous = a.history.filter((x) => x.frozen && x.date < h.date).at(-1)?.date ?? null;
  const buys = previous === null ? 0 : retirementPart(a, previous, h.date);
  if (buys > 0) {
    t.money(
      ref('R'),
      a.wb.number(SUPER.sheet, SUPER.voluntary) ?? 0,
      cols.superContribCents,
      'retirement_tagged',
    );
  } else {
    t.money(ref('R'), cell('R'), cols.superContribCents);
  }
  t.skip('defined_by_decision', 2); // S, T: the derived gain (D69)
  t.sumMoney(ref('X'), cell('X'), cols.propertyValueCents, properties);
  t.sumMoney(ref('Y'), cell('Y'), cols.propertyPurchaseCents, properties);
  t.sumMoney(ref('Z'), cell('Z'), cols.propertyEquityCents, properties + loans);
  t.sumMoney(ref('AA'), cell('AA'), cols.propertyGainCents, properties);
  t.sumMoney(ref('AB'), cell('AB'), cols.mortgageBalanceCents, loans);
  t.skip('defined_by_decision'); // AC: interest and fees are derived (D66)
  if (a.principalOnlyPayments()) {
    t.sumMoney(ref('AD'), cell('AD'), cols.mortgagePrincipalPaidCents, loans);
  } else {
    t.skip('defined_by_decision');
  }
  t.ratio(ref('AE'), cell('AE'), cols.propertyGainRatio);
  t.sumMoney(ref('AJ'), cell('AJ'), cols.otherValueCents, valued);
  t.sumGains(ref('AK'), cell('AK'), cols.otherGainCents, gained);
}

// ─── Cash!L parts: the dated other-asset flows per window (§9.2; rule 11) ─────────────────────

function compareCashFlows(a: AssetsSheet, other: OtherAssetsResult, t: AssetsTally): void {
  const costRows = a.costRows();
  const engineBetween = (after: string, through: string) => {
    const flows = other.savingsFlows.filter((f) => f.date > after && f.date <= through);
    return { total: flows.reduce((s, f) => s + f.amountCents, 0), count: flows.length };
  };
  a.history.forEach((h, i) => {
    const ref = `Cash!L${h.row} (other assets)`;
    if (i === 0) {
      t.skip('first_period'); // row 3's window is its calendar month
      return;
    }
    const prev = a.history[i - 1]!.date;
    const sheet = costDatedBetween(costRows, prev, h.date);
    let engine = engineBetween(prev, h.date);
    if (!h.frozen) {
      // The live window: the sheet's runs to the month end, the engine's to the as-of.
      const tail = costDatedBetween(costRows, a.asOf, monthEnd(a.asOf));
      if (tail.count > 0) {
        t.skip('live_window');
        return;
      }
      engine = engineBetween(prev, a.asOf);
    }
    const n = Math.max(sheet.count, engine.count);
    t.sumMoney(ref, sheet.total, engine.total, n);
  });
}
