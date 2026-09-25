// Engine goldens (stage-2.md §9.2–§9.5): the engine on sheet-faithful inputs against the local
// workbook's cached cells. Skipped when reference/ holds no single workbook. Every expected value is
// read at runtime; this file holds template cell references and rules only, and prints counts only.
import {
  ASSET_CLASSES,
  decimalFromNumber,
  INSTRUMENT_KINDS,
  type AssetClass,
  type InstrumentKind,
  type IsoDate,
} from '@joinr/schema';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assetClassOfKind,
  budgetInvestment,
  considerNext,
  nextBuyHint,
  type BudgetInvestResult,
  type ConsiderNextResult,
  type InvestmentsResult,
} from '../../src/index';
import {
  CG_BLOCKS,
  fiveFyWindowStart,
  NET_WORTH_CLASS_ROWS,
  readTiming,
  Sheet,
  TABS,
  type TimingSheet,
} from './adapter';
import { parseMonthlyRate, recomputedPricedTotals, simpleEstReturn } from './sheetFormulas';
import { addDaysIso } from '../../src/num';
import { Tally } from './tally';

const GOLDEN_TIMEOUT = 120_000;

/** Net Worth B38:B43 labels (template text) → asset class. */
const CLASS_LABELS: Readonly<Record<string, AssetClass>> = {
  ETFs: 'etf',
  Stocks: 'stock',
  Crypto: 'crypto',
  'Cash Savings': 'cash',
  'Managed Funds': 'managed_fund',
  'Other assets': 'other_assets',
};
const KIND_OF_CLASS: Partial<Record<AssetClass, InstrumentKind>> = {
  etf: 'etf',
  stock: 'stock',
  crypto: 'crypto',
  managed_fund: 'managed_fund',
};

/** What a tab's broken cells need (§9.3 rules 1 and 2), from the sheet's own cells. */
interface TabState {
  noPrices: boolean;
  recompute: boolean;
  /** Σ numeric value cells of the priced watch rows (the recomputed tab value). */
  valueSum: number;
  recomputedCurrent: (instrumentId: number) => number;
}

function tabState(sheet: Sheet, kind: InstrumentKind): TabState {
  const tab = sheet.tab(kind);
  const { sheet: s, watch: w } = tab.layout;
  const noPrices = tab.watch.every((x) => x.price === null);
  const heldUnpriced = tab.watch.some(
    (x) => x.price === null && (sheet.wb.number(s, `${w.units}${x.row}`) ?? 0) > 0,
  );
  const values = new Map<number, number>();
  for (const x of tab.watch) {
    if (x.price === null) continue;
    const v = sheet.wb.number(s, `${w.value}${x.row}`);
    if (v !== null) values.set(x.instrumentId, v);
  }
  const valueSum = [...values.values()].reduce((a, b) => a + b, 0);
  return {
    noPrices,
    recompute: !noPrices && heldUnpriced,
    valueSum,
    recomputedCurrent: (id) => (valueSum > 0 ? (values.get(id) ?? 0) / valueSum : 0),
  };
}

describeWithLocalWorkbook('golden: the investment engine against the local workbook', () => {
  describe('cached cells', { timeout: GOLDEN_TIMEOUT }, () => {
    let sheet: Sheet;
    const results = new Map<InstrumentKind, InvestmentsResult>();
    const states = new Map<InstrumentKind, TabState>();
    const tallies = new Map<string, Tally>();
    const tallyOf = (area: string) => {
      let t = tallies.get(area);
      if (!t) {
        t = new Tally(area);
        tallies.set(area, t);
      }
      return t;
    };
    let timing: TimingSheet;
    let budget: BudgetInvestResult;
    let consider: ConsiderNextResult;

    beforeAll(() => {
      const bytes = readLocalWorkbookBytes();
      if (bytes === null) throw new Error('golden: the local workbook could not be read');
      sheet = new Sheet(readWorkbook(bytes));
      for (const kind of INSTRUMENT_KINDS) {
        results.set(kind, sheet.run(kind));
        states.set(kind, tabState(sheet, kind));
      }
      timing = readTiming(sheet.wb, sheet.asOf);
      const lastPurchase = lastStockOrEtfBuy(results);
      budget = budgetInvestment({
        ...timing.input,
        lastSnapshotCashShare:
          timing.recomputedH43 === null ? null : decimalFromNumber(timing.recomputedH43),
        lastPurchaseDate: lastPurchase,
      });
      consider = considerNext({
        classes: classInputs(results, timing),
        cashCents: timing.input.cashCents,
        emergencyFundCents: budget.emergencyFundCents,
      });
    }, GOLDEN_TIMEOUT);

    afterAll(() => {
      // Counts only (§7.3 step 9): never a value or a symbol.
      for (const t of tallies.values()) console.log(t.line());
    });

    for (const kind of INSTRUMENT_KINDS) {
      it(`${TABS[kind].sheet}: watch rows and summary`, () => {
        const t = tallyOf(TABS[kind].sheet);
        compareWatchRows(sheet, kind, results.get(kind)!, states.get(kind)!, t);
        compareSummary(sheet, kind, results.get(kind)!, states.get(kind)!, t);
        expect(t.failures).toEqual([]);
        expect(t.compared).toBeGreaterThan(0);
      });

      it(`${TABS[kind].sheet}: ledger rows`, () => {
        const t = tallyOf(TABS[kind].sheet);
        compareLedger(sheet, kind, results.get(kind)!, t);
        expect(t.failures).toEqual([]);
      });
    }

    it('Capital Gains: remaining units, realised gains and the FY totals', () => {
      const t = tallyOf('Capital Gains');
      compareCapitalGains(sheet, results, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('D28: re-linked dividends raise total return and dividends by exactly the linked amounts', () => {
      for (const kind of INSTRUMENT_KINDS) {
        compareRelinked(sheet, kind, results.get(kind)!, tallyOf(TABS[kind].sheet));
      }
      const failures = INSTRUMENT_KINDS.flatMap((k) => tallyOf(TABS[k].sheet).failures);
      expect(failures).toEqual([]);
    });

    it('Budget chain, the last purchase date and the D40 amount', () => {
      const t = tallyOf('Budget and timing');
      compareBudget(sheet, timing, budget, results, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Consider next (Net Worth) and the next-buy hints', () => {
      const t = tallyOf('Net Worth');
      compareConsiderNext(sheet, timing, consider, results, states, t);
      for (const kind of INSTRUMENT_KINDS) {
        compareHint(
          sheet,
          kind,
          consider,
          results.get(kind)!,
          states.get(kind)!,
          tallyOf(TABS[kind].sheet),
        );
      }
      const failures = [t, ...INSTRUMENT_KINDS.map((k) => tallyOf(TABS[k].sheet))].flatMap(
        (x) => x.failures,
      );
      expect(failures).toEqual([]);
    });
  });
});

// ─── Watch rows (§9.2, §9.3 rules 1, 2, 5, 12, 13) ─────────────────────────────────────────────

function compareWatchRows(
  sheet: Sheet,
  kind: InstrumentKind,
  r: InvestmentsResult,
  st: TabState,
  t: Tally,
): void {
  const tab = sheet.tab(kind);
  const { sheet: s, watch: w } = tab.layout;
  const wb = sheet.wb;
  const totals = recomputedPricedTotals(sheet, kind);
  for (const x of tab.watch) {
    const h = r.holdings.find((y) => y.instrumentId === x.instrumentId)!;
    const at = (col: string, what: string) => `${s}!${col}${x.row} ${what}`;
    const num = (col: string) => wb.number(s, `${col}${x.row}`);
    const units = num(w.units);
    const held = (units ?? 0) > 0;
    const unpricedHeld = held && x.price === null;
    const delta = totals.deltaBySymbol.get(x.symbol) ?? 0;
    const lotAdjust = delta !== 0 ? ('partial_lot_fee' as const) : undefined;
    /** Rule 12: the engine gives null where the sheet shows 0 or "-" for a holding not held. */
    const notHeld = (col: string, what: string, engine: unknown) => {
      t.skip('not_held');
      if (engine !== null) t.failures.push(at(col, `${what} should be null when not held`));
    };

    t.units(at(w.units, 'units'), units, h.netUnits);

    // Value.
    if (st.noPrices) t.skip('no_prices');
    else if (unpricedHeld) t.skip('unpriced');
    else
      t.money(
        at(w.value, 'value'),
        held ? num(w.value) : (num(w.value) ?? 0),
        h.valueCents ?? (held ? null : 0),
      );

    // Total return $ and %.
    if (st.noPrices) t.skip('no_prices', 2);
    else if (!held) {
      notHeld(w.tr, 'total return', h.totalReturnCents);
      notHeld(w.trPct, 'total return %', h.totalReturnRatio);
    } else if (unpricedHeld) t.skip('unpriced', 2);
    else {
      const tr = num(w.tr);
      t.money(
        at(w.tr, 'total return'),
        tr === null ? null : tr + delta,
        h.totalReturnCents,
        lotAdjust,
      );
      const cost = totals.costBySymbol.get(x.symbol) ?? null;
      const pct =
        delta !== 0 ? (tr === null || cost === null ? null : (tr + delta) / cost) : num(w.trPct);
      t.ratio(at(w.trPct, 'total return %'), pct, h.totalReturnRatio, lotAdjust);
    }

    // XIRR.
    if (st.noPrices) t.skip('no_prices');
    else if (!held) t.skip('not_held');
    else if (unpricedHeld) t.skip('unpriced');
    else t.xirr(at(w.xirr, 'xirr'), num(w.xirr), h.xirr);

    // Dividends (crypto: the staking total, price-free).
    if (!held) t.skip('not_held');
    else t.money(at(w.div, 'dividends'), num(w.div) ?? 0, h.dividendsCents);

    // Crypto's staking yield is a lookup into the current-FY dividends table (rule 13).
    if (kind === 'crypto') t.skip('fy_table_lookup');

    // Average price.
    if (!held) notHeld(w.ave, 'average price', h.averagePrice);
    else t.price(at(w.ave, 'average price'), num(w.ave), h.averagePrice);

    // Current allocation and difference.
    const target = num(w.target);
    if (st.noPrices) t.skip('no_prices', 2);
    else if (unpricedHeld) t.skip('unpriced', 2);
    else if (st.recompute) {
      const current = st.recomputedCurrent(x.instrumentId);
      t.ratio(at(w.cur, 'current'), current, h.currentRatio, 'recomputed');
      if (target === null)
        t.check(at(w.diff, 'difference (no target)'), h.differenceRatio === null, 'recomputed');
      else t.ratio(at(w.diff, 'difference'), current - target, h.differenceRatio, 'recomputed');
    } else {
      t.ratio(at(w.cur, 'current'), num(w.cur) ?? 0, h.currentRatio);
      if (target === null)
        t.check(at(w.diff, 'difference (no target)'), h.differenceRatio === null);
      else t.ratio(at(w.diff, 'difference'), num(w.diff), h.differenceRatio);
    }

    // Managed-fund fee estimate (MF W).
    if (w.estFee !== null) {
      if (st.noPrices) t.skip('no_prices');
      else if (unpricedHeld) t.skip('unpriced');
      else
        t.money(
          at(w.estFee, 'est. fee'),
          num(w.estFee) ?? 0,
          h.estMgmtFeeCents ?? (held ? null : 0),
        );
    }
  }
}

// ─── Summary cells ─────────────────────────────────────────────────────────────────────────────

function compareSummary(
  sheet: Sheet,
  kind: InstrumentKind,
  r: InvestmentsResult,
  st: TabState,
  t: Tally,
): void {
  const tab = sheet.tab(kind);
  const { sheet: s, summary: sm, watch: w } = tab.layout;
  const wb = sheet.wb;
  const at = (addr: string, what: string) => `${s}!${addr} ${what}`;
  const totals = recomputedPricedTotals(sheet, kind);
  const n = r.holdings.filter((h) => h.status === 'held' && h.valueCents !== null).length;
  const trCached = wb.number(s, sm.tr);
  const adjusted = st.recompute || totals.deltaTotal !== 0;
  const adjustReason = st.recompute ? ('recomputed' as const) : ('partial_lot_fee' as const);

  if (st.noPrices) {
    t.skip('no_prices', 4); // value, total return $ and %, simple est. return
  } else {
    if (st.recompute)
      t.summaryMoney(at(sm.value, 'value'), st.valueSum, r.summary.valueCents, n, 'recomputed');
    else t.summaryMoney(at(sm.value, 'value'), wb.number(s, sm.value), r.summary.valueCents, n);
    t.summaryMoney(
      at(sm.tr, 'total return'),
      trCached === null ? null : trCached + totals.deltaTotal,
      r.summary.totalReturnCents,
      n,
      totals.deltaTotal !== 0 ? 'partial_lot_fee' : undefined,
    );
    const recomputedPct =
      trCached === null || totals.cost === 0 ? null : (trCached + totals.deltaTotal) / totals.cost;
    if (adjusted)
      t.ratio(
        at(sm.trPct, 'total return %'),
        recomputedPct,
        r.summary.totalReturnRatio,
        adjustReason,
      );
    else
      t.ratio(at(sm.trPct, 'total return %'), wb.number(s, sm.trPct), r.summary.totalReturnRatio);

    // The simple est. return helper over the engine's own lots of priced holdings (§9.1).
    const priced = new Set(
      r.holdings
        .filter((h) => h.status === 'held' && h.valueCents !== null)
        .map((h) => h.instrumentId),
    );
    const engineLots = r.lots
      .filter((l) => priced.has(l.instrumentId))
      .map((l) => ({
        date: l.tradeDate,
        price: Number(l.price),
        remaining: Number(l.remainingUnits),
      }));
    const helper =
      r.summary.totalReturnRatio === null
        ? null
        : simpleEstReturn(Number(r.summary.totalReturnRatio), engineLots, sheet.asOf);
    if (adjusted) {
      const expected =
        recomputedPct === null ? null : simpleEstReturn(recomputedPct, totals.lots, sheet.asOf);
      t.xirr(at(sm.simple, 'simple est. return'), expected, helper, adjustReason);
    } else {
      t.xirr(at(sm.simple, 'simple est. return'), wb.number(s, sm.simple), helper);
    }
  }

  t.exact(
    at(sm.rate, '1Y rate'),
    parseMonthlyRate(wb.text(s, sm.rate)),
    r.summary.investmentRatePerMonthCents,
  );

  if (sm.divAll !== null) {
    const windowStart = sm.divAllFiveFy ? fiveFyWindowStart(wb) : null;
    const before =
      windowStart !== null &&
      sheet.dividendRows.some(
        (d) => d.type === tab.layout.type && d.paymentDate < `${windowStart}-07-01`,
      );
    if (sm.divAllFiveFy && (windowStart === null || before)) t.skip('five_fy_window');
    else
      t.money(
        at(sm.divAll, 'dividends all time'),
        wb.number(s, sm.divAll) ?? 0,
        r.summary.dividendsAllTimeCents,
      );
  }
  if (sm.divFy !== null) {
    t.money(
      at(sm.divFy, 'dividends this FY'),
      wb.number(s, sm.divFy) ?? 0,
      r.summary.dividendsThisFyCents,
    );
  }
  if (sm.heldCount !== null)
    t.exact(at(sm.heldCount, 'held count'), wb.number(s, sm.heldCount), r.summary.heldCount);
  if (sm.targetCount !== null) {
    if (st.recompute) {
      let count = 0;
      for (const x of tab.watch) {
        const target = wb.number(s, `${w.target}${x.row}`);
        if (target !== null && target > 0) count += 1;
        else if (x.price !== null && st.recomputedCurrent(x.instrumentId) > 0) count += 1;
      }
      t.exact(at(sm.targetCount, 'target count'), count, r.summary.targetCount, 'recomputed');
    } else {
      t.exact(
        at(sm.targetCount, 'target count'),
        wb.number(s, sm.targetCount),
        r.summary.targetCount,
      );
    }
  }

  // Regional look-through: the current row, then the target row (§9.2; rule 1 for the current).
  if (sm.regionRow !== null && w.regions !== null) {
    const keys = ['us', 'asia', 'aus', 'other'] as const;
    keys.forEach((key, i) => {
      const col = w.regions![i]!;
      const slice = r.allocation.byRegion?.find((x) => x.key === key) ?? null;
      const curRef = at(`${col}${sm.regionRow}`, `${key} current`);
      if (st.noPrices) t.skip('no_prices');
      else if (st.recompute) {
        let expected = 0;
        for (const x of tab.watch) {
          if (x.price === null) continue;
          expected += st.recomputedCurrent(x.instrumentId) * (wb.number(s, `${col}${x.row}`) ?? 0);
        }
        t.ratio(curRef, expected, slice?.currentRatio ?? null, 'recomputed');
      } else {
        t.ratio(curRef, wb.number(s, `${col}${sm.regionRow}`) ?? 0, slice?.currentRatio ?? null);
      }
      t.ratio(
        at(`${col}${sm.regionRow! + 1}`, `${key} target`),
        wb.number(s, `${col}${sm.regionRow! + 1}`) ?? 0,
        slice?.targetRatio ?? null,
      );
    });
  }
}

// ─── Ledger rows (§9.2; rule 5 for partly-sold lots) ────────────────────────────────────────────

function compareLedger(sheet: Sheet, kind: InstrumentKind, r: InvestmentsResult, t: Tally): void {
  const tab = sheet.tab(kind);
  const { sheet: s, ledger: lg } = tab.layout;
  const wb = sheet.wb;
  const totals = recomputedPricedTotals(sheet, kind);
  const priced = new Set(tab.watch.filter((x) => x.price !== null).map((x) => x.symbol));
  for (const x of tab.ledger) {
    const at = (col: string, what: string) => `${s}!${col}${x.row} ${what}`;
    const num = (col: string) => wb.number(s, `${col}${x.row}`);
    const tr = r.trades.find((y) => y.tradeId === x.tradeId);
    if (!tr) {
      t.failures.push(at('A', 'has no engine trade'));
      continue;
    }
    const sign = x.units < 0 ? -1 : 1;
    t.money(at(lg.order, 'order value'), num(lg.order), sign * tr.orderValueCents);
    if (kind === 'crypto' && lg.fee !== null)
      t.money(at(lg.fee, 'fee'), num(lg.fee) ?? 0, tr.feeCents);
    if (x.units <= 0) continue;
    const lot = r.lots.find((l) => l.tradeId === x.tradeId);
    if (!lot) {
      t.failures.push(at('A', 'has no engine lot'));
      continue;
    }
    const soldUnits = String(Number(lot.units) - Number(lot.remainingUnits));
    t.units(at(lg.sold, 'sold units'), num(lg.sold) ?? 0, soldUnits);
    t.units(at(lg.remaining, 'remaining'), num(lg.remaining), lot.remainingUnits);
    if (kind === 'crypto') continue; // crypto J and K are price-dependent and not compared (§9.2)
    const remaining = num(lg.remaining) ?? 0;
    if (!(remaining > 0)) {
      // A fully sold parcel: the sheet leaves J and K blank; the engine gives null.
      t.check(
        at(lg.unrealised, 'unrealised (sold)'),
        lot.unrealisedCents === null && num(lg.unrealised) === null,
      );
      t.check(
        at(lg.pct, 'unrealised % (sold)'),
        lot.unrealisedRatio === null && num(lg.pct) === null,
      );
      continue;
    }
    if (!priced.has(x.symbol)) {
      t.skip('unpriced', 2);
      continue;
    }
    const delta = totals.deltaByRow.get(x.row) ?? 0;
    const adjust = delta !== 0 ? ('partial_lot_fee' as const) : undefined;
    const j = num(lg.unrealised);
    const g = num(lg.order);
    t.money(
      at(lg.unrealised, 'unrealised'),
      j === null ? null : j + delta,
      lot.unrealisedCents,
      adjust,
    );
    const pct = delta !== 0 ? (j === null || !g ? null : (j + delta) / g) : num(lg.pct);
    t.ratio(at(lg.pct, 'unrealised %'), pct, lot.unrealisedRatio, adjust);
  }
}

// ─── Capital Gains (§9.2, rule 10) ─────────────────────────────────────────────────────────────

function compareCapitalGains(
  sheet: Sheet,
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  t: Tally,
): void {
  const wb = sheet.wb;
  const cg = 'Capital Gains';
  let row = 2;
  for (const block of CG_BLOCKS) {
    const tab = sheet.tab(block.kind);
    const r = results.get(block.kind)!;
    const count = wb.number(cg, block.countCell) ?? 0;
    t.exact(`${cg}!${block.countCell} row count`, count, tab.ledger.length);
    for (let i = 0; i < count; i++, row++) {
      const x = tab.ledger[i];
      if (!x || wb.text(cg, `A${row}`) !== x.symbol) {
        t.failures.push(`${cg}!A${row} does not map to its ledger row`);
        continue;
      }
      if (x.units > 0) {
        const lot = r.lots.find((l) => l.tradeId === x.tradeId);
        t.units(`${cg}!O${row} remaining`, wb.number(cg, `O${row}`), lot?.remainingUnits ?? null);
      } else if (x.units < 0) {
        const tr = r.trades.find((y) => y.tradeId === x.tradeId);
        t.money(
          `${cg}!P${row} short term`,
          wb.number(cg, `P${row}`) ?? 0,
          tr?.realisedShortCents ?? null,
        );
        t.money(
          `${cg}!Q${row} long term`,
          wb.number(cg, `Q${row}`) ?? 0,
          tr?.realisedLongCents ?? null,
        );
        t.money(`${cg}!S${row} total`, wb.number(cg, `S${row}`), tr?.realisedCents ?? null);
      } else {
        // A zero-unit row is neither a lot nor a disposal: count it, never drop it silently.
        t.skip('zero_units');
      }
    }
  }
  // FY totals over the union of FY starts; a missing FY counts as 0 on either side.
  const sheetFy = new Map<number, number>();
  for (let r = 11; r <= 80; r++) {
    const start = wb.date(cg, `U${r}`);
    if (start === null) break;
    sheetFy.set(Number(start.slice(0, 4)), wb.number(cg, `V${r}`) ?? 0);
  }
  const engineFy = new Map<number, number>();
  for (const r of results.values()) {
    for (const row of r.realisedByFy) {
      engineFy.set(row.financialYear, (engineFy.get(row.financialYear) ?? 0) + row.totalCents);
    }
  }
  const fys = new Set([...sheetFy.keys(), ...engineFy.keys()]);
  for (const fy of [...fys].sort()) {
    t.summaryMoney(
      `${cg}!V (FY ${fy})`,
      sheetFy.get(fy) ?? 0,
      engineFy.get(fy) ?? 0,
      INSTRUMENT_KINDS.length,
    );
  }
}

// ─── D28 re-link (§9.3 rule 3) ─────────────────────────────────────────────────────────────────

function compareRelinked(
  sheet: Sheet,
  kind: InstrumentKind,
  base: InvestmentsResult,
  t: Tally,
): void {
  const tab = sheet.tab(kind);
  const relinked = sheet.run(kind, { relink: true });
  const linkedDividends = new Map<number, number>();
  const baseLinks = new Map(tab.dividends.map((d) => [d.id, d.instrumentId]));
  for (const d of relinked.dividends) {
    if (d.instrumentId === null || baseLinks.get(d.dividendId) !== null) continue;
    const net = tab.dividends.find((x) => x.id === d.dividendId)!.netAmountCents;
    linkedDividends.set(d.instrumentId, (linkedDividends.get(d.instrumentId) ?? 0) + net);
  }
  for (const [id, amount] of linkedDividends) {
    const before = base.holdings.find((h) => h.instrumentId === id)!;
    const after = relinked.holdings.find((h) => h.instrumentId === id)!;
    t.note('d28_relinked');
    const ref = `${tab.layout.sheet} re-linked holding ${tab.instruments.findIndex((i) => i.id === id) + 1}`;
    if (after.dividendsCents - before.dividendsCents !== amount)
      t.failures.push(`${ref}: dividends`);
    if (
      before.totalReturnCents !== null &&
      after.totalReturnCents! - before.totalReturnCents !== amount
    ) {
      t.failures.push(`${ref}: total return`);
    }
    if (before.xirr !== null && after.xirr === before.xirr)
      t.failures.push(`${ref}: xirr unchanged`);
  }
}

// ─── Budget chain (§9.2; rule 6) ───────────────────────────────────────────────────────────────

function lastStockOrEtfBuy(
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
): IsoDate | null {
  const dates = (['stock', 'etf'] as const)
    .map((k) => results.get(k)!.summary.lastBuyDate)
    .filter((d): d is IsoDate => d !== null)
    .sort();
  return dates.at(-1) ?? null;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function compareBudget(
  sheet: Sheet,
  timing: TimingSheet,
  b: BudgetInvestResult,
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  t: Tally,
): void {
  const wb = sheet.wb;
  const num = (s: string, a: string) => wb.number(s, a);
  const lastPurchase = lastStockOrEtfBuy(results);
  t.exact('SheetOptions!H20 last ETF/stock buy', wb.date('SheetOptions', 'H20'), lastPurchase);
  t.ratio(
    'SheetOptions!H43 last-snapshot cash share (recomputed)',
    num('SheetOptions', 'H43'),
    timing.recomputedH43,
  );

  // Budget!B2: rule 6 when side income is included (the unfilled period is dropped).
  const b2 = num('Budget', 'B2');
  const asOfLess365 = addDaysIso(sheet.asOf, -365);
  const b2Expected = timing.input.includeSideIncome
    ? b2 === null
      ? null
      : b2 -
        (num('Side Income', 'C6') ?? 0) +
        mean(timing.sideIncome.filter((p) => p.periodStart > asOfLess365).map((p) => p.amount))
    : b2;
  t.money('Budget!B2 monthly income', b2Expected, b.monthlyIncomeCents);
  t.money('Budget!C24 yearly fund', num('Budget', 'C24'), b.yearlyFundCents);
  t.money('Budget!J4 planned spend', num('Budget', 'J4'), b.plannedSpendCents);
  t.money('Budget!L7 leftover', num('Budget', 'L7'), b.leftoverCents);
  t.money('Budget!D3 emergency fund', num('Budget', 'D3'), b.emergencyFundCents);
  t.money('Budget!C28 investment row', num('Budget', 'C28'), b.investmentRowCents);
  t.money('Budget!C29 cash row', num('Budget', 'C29'), b.cashRowCents);
  t.ratio('SheetOptions!H41 invest share', num('SheetOptions', 'H41'), b.investShareRatio);
  t.ratio('SheetOptions!H42 cash share', num('SheetOptions', 'H42'), b.cashShareRatio);

  // SheetOptions!H2 read the cash row (D40, rule 6): recompute it from the investment row.
  const h41 = num('SheetOptions', 'H41');
  const tax = num('SheetOptions', 'H31');
  const c28 = num('Budget', 'C28');
  const h20 = wb.date('SheetOptions', 'H20');
  if (h41 === null || tax === null || c28 === null || b2Expected === null) {
    t.check('SheetOptions!H2 inputs present', false);
  } else {
    const since =
      h20 === null ? [] : timing.sideIncome.filter((p) => p.periodEnd > h20).map((p) => p.amount);
    const side = since.length === 0 ? 0 : h41 * (1 - tax) * mean(since);
    const base = timing.input.useBudgetForInvest ? c28 : b2Expected * h41;
    t.money('SheetOptions!H2 monthly amount to invest (D40)', base + side, b.monthlyInvestCents);
  }
}

// ─── Consider next and hints (§9.2; rules 1 and 11) ────────────────────────────────────────────

function classInputs(
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  timing: TimingSheet,
): Record<AssetClass, { valueCents: number; targetRatio: string | null }> {
  const value = (cls: AssetClass): number => {
    const kind = KIND_OF_CLASS[cls];
    if (kind) return results.get(kind)!.summary.valueCents;
    return cls === 'cash' ? timing.input.cashCents : timing.otherAssetsCents;
  };
  return Object.fromEntries(
    ASSET_CLASSES.map((cls) => [
      cls,
      { valueCents: value(cls), targetRatio: timing.classTargets[cls] },
    ]),
  ) as Record<AssetClass, { valueCents: number; targetRatio: string | null }>;
}

/** The class values the sheet would have had with its broken totals recomputed (rule 1). */
function recomputedClassValues(
  sheet: Sheet,
  states: ReadonlyMap<InstrumentKind, TabState>,
): Record<AssetClass, number> {
  const tabValue = (kind: InstrumentKind): number => {
    const st = states.get(kind)!;
    if (st.recompute || st.noPrices) return st.valueSum;
    return sheet.wb.number(TABS[kind].sheet, TABS[kind].summary.value) ?? 0;
  };
  return {
    etf: tabValue('etf'),
    stock: tabValue('stock'),
    crypto: tabValue('crypto'),
    cash: sheet.wb.number('Cash', 'C13') ?? 0,
    managed_fund: tabValue('managed_fund'),
    other_assets: sheet.wb.number('Other Assets', 'D3') ?? 0,
  };
}

/** The watch row with the lowest recomputed difference among priced rows with a target > 0. */
function recomputedHintSymbol(sheet: Sheet, kind: InstrumentKind, st: TabState): string | null {
  const tab = sheet.tab(kind);
  const { sheet: s, watch: w } = tab.layout;
  let best: { symbol: string; diff: number } | null = null;
  for (const x of tab.watch) {
    const target = sheet.wb.number(s, `${w.target}${x.row}`);
    if (x.price === null || target === null || !(target > 0)) continue;
    const diff = st.recomputedCurrent(x.instrumentId) - target;
    if (best === null || diff < best.diff) best = { symbol: x.symbol, diff };
  }
  return best?.symbol ?? null;
}

function compareConsiderNext(
  sheet: Sheet,
  timing: TimingSheet,
  cn: ConsiderNextResult,
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  states: ReadonlyMap<InstrumentKind, TabState>,
  t: Tally,
): void {
  const wb = sheet.wb;
  const anyRecompute = [...states.values()].some((st) => st.recompute);
  const adjust = anyRecompute ? ('recomputed' as const) : undefined;
  const values = recomputedClassValues(sheet, states);
  const total = ASSET_CLASSES.reduce((a, c) => a + values[c], 0);
  const share = (c: AssetClass) => (total === 0 ? 0 : values[c] / total);
  const deltas = new Map<AssetClass, number>();
  for (const cls of ASSET_CLASSES) {
    const row = NET_WORTH_CLASS_ROWS[cls];
    const engineRow = cn.rows.find((r) => r.assetClass === cls)!;
    const expected = anyRecompute ? share(cls) : wb.number('Net Worth', `C${row}`);
    t.ratio(`Net Worth!C${row} ${cls} current`, expected, engineRow.currentRatio, adjust);
    const target = wb.number('Net Worth', `D${row}`);
    if (target !== null) deltas.set(cls, share(cls) - target);
  }
  const argmin = (classes: readonly AssetClass[]): AssetClass | null => {
    let best: AssetClass | null = null;
    for (const c of classes) {
      const d = deltas.get(c);
      if (d !== undefined && (best === null || d < deltas.get(best)!)) best = c;
    }
    return best;
  };

  // E45: cash when it is below the emergency fund, else the most underweight class.
  const cash = wb.number('Cash', 'C13') ?? 0;
  const ef = wb.number('Budget', 'D3');
  const e45 = ef !== null && cash < ef ? 'cash' : argmin(ASSET_CLASSES);
  const cachedE45 = CLASS_LABELS[wb.text('Net Worth', 'E45') ?? ''] ?? null;
  t.exact('Net Worth!E45 consider next', anyRecompute ? e45 : cachedE45, cn.assetClass, adjust);

  // SheetOptions!H9 (rule 11): the minimum over E38:E42 only, no emergency-fund rule; its holding
  // part is nextBuyHint for that class's kind.
  const h9Class = argmin(ASSET_CLASSES.filter((c) => c !== 'other_assets'));
  const h9Kind = h9Class === null ? undefined : KIND_OF_CLASS[h9Class];
  let ok = h9Class !== null;
  if (h9Class !== null && h9Kind !== undefined) {
    const hint = nextBuyHint({
      kind: h9Kind,
      considerNext: { ...cn, assetClass: h9Class, reason: 'most_underweight' },
      holdings: results.get(h9Kind)!.holdings,
      parcelCents: null,
    });
    const symbol =
      hint.instrumentId === null ? null : sheet.tab(h9Kind).symbolOf.get(hint.instrumentId);
    ok =
      hint.assetClass === h9Class &&
      symbol === recomputedHintSymbol(sheet, h9Kind, states.get(h9Kind)!);
  }
  t.check('SheetOptions!H9 investment choice (class and holding)', ok, 'recomputed');
}

function compareHint(
  sheet: Sheet,
  kind: InstrumentKind,
  cn: ConsiderNextResult,
  r: InvestmentsResult,
  st: TabState,
  t: Tally,
): void {
  const tab = sheet.tab(kind);
  const cell = tab.layout.summary.hint;
  if (cell === null) return;
  const ref = `${tab.layout.sheet}!${cell} next investment`;
  if (st.noPrices) {
    t.skip('no_prices');
    return;
  }
  const text = sheet.wb.text(tab.layout.sheet, cell);
  const m = text === null ? null : /^Consider (.+?)(?: \(\$[^)]*\))?$/.exec(text);
  const named = m ? m[1]! : null;
  const hint = nextBuyHint({ kind, considerNext: cn, holdings: r.holdings, parcelCents: null });
  const namedClass = named === null ? undefined : CLASS_LABELS[named];
  if (namedClass !== undefined) {
    // Another class is suggested: the engine names the same class and no holding.
    t.check(ref, hint.assetClass === namedClass && hint.instrumentId === null);
    return;
  }
  const symbol = hint.instrumentId === null ? null : tab.symbolOf.get(hint.instrumentId);
  const ownClass = hint.assetClass === assetClassOfKind(kind);
  if (st.recompute)
    t.check(ref, ownClass && symbol === recomputedHintSymbol(sheet, kind, st), 'recomputed');
  else t.check(ref, ownClass && named !== null && symbol === named);
}
