// FIRE goldens (stage-6.md §9): the sheet mode (fireSheet on the tab's cached inputs) against every
// cached output cell (areas A–C), the app's raw input path against E47/E48 recomputed over the
// closed rows (area D), and the tab's inputs recomputed from their source cells (area E). The
// corrected model is not compared with cached cells (§9.3 rule 6: D97–D102 change every input and
// the model); it runs once on the sheet's inputs as an invariant check. Counts only are printed;
// a failure names the template cell, never a value.
import { decimalFromNumber } from '@joinr/schema';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSuper, fireSheet, projectFire } from '../../src/index';
import type { FireDerived, FireSheetResult, FireSheetValue } from '../../src/index';
import { Sheet } from './adapter';
import { AssetsSheet } from './assetsAdapter';
import {
  FIRE_GRID_COLUMNS,
  FIRE_KPI_CELLS,
  FIRE_OUTPUT_CELLS,
  FireSheetTab,
  type CachedCell,
} from './fireAdapter';
import { averageHelpers, sheetE45, sheetE49, type AverageHelpers } from './fireFormulas';
import { DOLLAR_TOLERANCE, FireTally, RAW_YEARLY_TOLERANCE_CENTS, within } from './fireTally';

const GOLDEN_TIMEOUT = 120_000;

/** Sheet dollars → cents, half away from zero. */
const sheetCents = (dollars: number): number => {
  const c = Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
  return c === 0 ? 0 : c;
};

/**
 * §9.3 rule 1: numbers within the §9.5 tolerance; texts exactly ("" for a blank); a cached error
 * value matches an error from the sheet mode, or its "-" where the template wraps it in IFERROR.
 */
function matches(cached: CachedCell, engine: FireSheetValue): boolean {
  if (cached.isError) {
    if (typeof engine !== 'string') return false;
    return engine.startsWith('#') || (engine === '-' && /IFERROR/i.test(cached.formula ?? ''));
  }
  if (typeof cached.value === 'number') {
    return (
      typeof engine === 'number' && within(engine - cached.value, DOLLAR_TOLERANCE, cached.value)
    );
  }
  return typeof engine === 'string' && engine === cached.value;
}

/** A cell with neither a formula nor a value (§9.3 rule 2). */
const noFormula = (c: CachedCell): boolean => !c.hasFormula && c.value === '';

describeWithLocalWorkbook('golden: the FIRE tab against the local workbook', () => {
  describe('sheet mode, raw input path and inputs', { timeout: GOLDEN_TIMEOUT }, () => {
    let tab: FireSheetTab;
    let result: FireSheetResult;
    let derived: FireDerived;
    let helpers: AverageHelpers;
    let sheet: Sheet;
    const tallies: FireTally[] = [];
    const tallyOf = (area: string) => {
      const t = new FireTally(area);
      tallies.push(t);
      return t;
    };

    beforeAll(() => {
      const bytes = readLocalWorkbookBytes();
      if (bytes === null) throw new Error('golden: the local workbook could not be read');
      sheet = new Sheet(readWorkbook(bytes));
      tab = new FireSheetTab(sheet);
      result = fireSheet(tab.sheetInput());
      derived = tab.derived();
      helpers = averageHelpers(tab.cashRows, tab.lastRun);
    }, GOLDEN_TIMEOUT);

    afterAll(() => {
      // Counts only (§9.3 rule 7): never a value.
      for (const t of tallies) console.log(t.line());
    });

    it('A. headline and forecasts: every output cell', () => {
      const t = tallyOf('FIRE A headline and forecasts');
      for (const addr of FIRE_OUTPUT_CELLS) {
        const cached = addr === 'E57' ? tab.yearCell(addr) : tab.cell(addr);
        if (noFormula(cached)) {
          t.skip('no_formula');
          continue;
        }
        // Rule 2: E64 is a DUMMYFUNCTION wrapper; an error cached there cannot be compared.
        if (addr === 'E64' && cached.isError) {
          t.skip('never');
          continue;
        }
        t.check(`${tab.name}!${addr}`, matches(cached, result.cells[addr]));
      }
      expect(t.compared).toBeGreaterThan(0);
      expect(t.failures).toEqual([]);
    });

    it('B. the KPI table', () => {
      const t = tallyOf('FIRE B KPI table');
      for (const addr of FIRE_KPI_CELLS) {
        const cached = tab.cell(addr);
        if (noFormula(cached)) {
          t.skip('no_formula');
          continue;
        }
        t.check(`${tab.name}!${addr}`, matches(cached, result.cells[addr]));
      }
      expect(t.compared).toBeGreaterThan(0);
      expect(t.failures).toEqual([]);
    });

    it('C. the grid: every row G–T and V–X', () => {
      const t = tallyOf('FIRE C grid');
      const rows = tab.gridRows();
      // The row count is an adapter check (not counted): one sheet-mode row per grid year.
      expect(rows.length).toBe(result.rows.length);
      rows.forEach((row, h) => {
        const mine = result.rows[h];
        for (const col of FIRE_GRID_COLUMNS) {
          const addr = `${col}${row}`;
          const cached = col === 'G' ? tab.yearCell(addr) : tab.cell(addr);
          if (noFormula(cached)) {
            t.skip('no_formula');
            continue;
          }
          t.check(`${tab.name}!${addr}`, mine !== undefined && matches(cached, mine[col]));
        }
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(t.failures).toEqual([]);
    });

    it('D. the raw input path: E47 and E48 over the closed rows', () => {
      const t = tallyOf('FIRE D raw input path');
      // Adapter checks (not counted): the helpers over all rows equal the cached cells.
      const adapter: string[] = [];
      const e48 = tab.number('E48');
      if (!(
        e48 !== null &&
        helpers.e48All !== null &&
        within(helpers.e48All - e48, DOLLAR_TOLERANCE, e48)
      )) {
        adapter.push('E48 all rows');
      }
      const e47 = tab.cell('E47');
      // Rule 4: a text E47 skips only this adapter check (text_input, not counted).
      if (typeof e47.value === 'number') {
        const ok =
          helpers.e47All !== null &&
          within(helpers.e47All - e47.value, DOLLAR_TOLERANCE, e47.value);
        if (!ok) adapter.push('E47 all rows');
      }
      expect(adapter).toEqual([]);

      const raw = (ref: string, helper: number | null, cents: number | null) =>
        t.check(
          ref,
          helper !== null &&
            cents !== null &&
            Math.abs(cents - sheetCents(helper)) <= RAW_YEARLY_TOLERANCE_CENTS,
          'closed_rows',
        );
      raw(
        `${tab.name}!E47 savings.rawYearlyCents`,
        helpers.e47Closed,
        derived.savings.rawYearlyCents,
      );
      raw(`${tab.name}!E48 spend.rawYearlyCents`, helpers.e48Closed, derived.spend.rawYearlyCents);
      expect(derived.window?.periods).toBe(helpers.closedRows.e48);
      expect(t.failures).toEqual([]);
    });

    it('E. the sheet inputs from their sources: E45, E46, E49', () => {
      const t = tallyOf('FIRE E sheet inputs');
      t.dollars(`${tab.name}!E45`, tab.number('E45'), sheetE45(tab.wb), 'sheet_cells');
      const e46 = tab.number('E46');
      const c10 = tab.wb.number('Net Worth', 'C10');
      const superTotal = computeSuper(new AssetsSheet(sheet).superInput()).totalCents;
      t.check(
        `${tab.name}!E46`,
        e46 !== null &&
          c10 !== null &&
          within(e46 - c10, DOLLAR_TOLERANCE, c10) &&
          Math.abs(superTotal - sheetCents(e46)) <= 1,
        'sheet_cells',
      );
      t.dollars(`${tab.name}!E49`, tab.number('E49'), sheetE49(tab.wb), 'sheet_cells');
      expect(t.failures).toEqual([]);
    });

    it('the corrected model runs on the sheet inputs (rule 6: an invariant check, not counted)', () => {
      const input = tab.sheetInput();
      const cents = (dollars: number) => sheetCents(dollars);
      const p = projectFire({
        asOf: tab.asOf,
        birthYear: input.birthYear,
        accessAge: input.accessAge,
        inflationRatio: decimalFromNumber(input.inflation),
        withdrawalRatio: decimalFromNumber(input.withdrawalRate),
        preSuperCents: cents(input.preSuper),
        preSuperDebtCents: 0,
        superCents: cents(input.superBalance),
        savingsPerYearCents: derived.savings.yearlyCents,
        extraSavingsPerYearCents: 0,
        superContributionPerYearCents: cents(input.superContributionPerYear),
        yearlySpendCents: derived.spend.yearlyCents,
        growth: {
          cashWeightCents: 0,
          marketWeightCents: 1,
          cashInterestRatio: null,
          marketReturnRatio: decimalFromNumber(input.growth),
        },
      });
      expect(p.status).not.toBe('needs_input');
      expect(p.rows.length).toBeGreaterThan(0);
      const broken: number[] = [];
      for (const r of p.rows) {
        const a = r.preSuper;
        const b = r.super;
        const aSum = a.startCents + a.growthCents + a.savedCents - a.spentCents - a.topUpCents;
        const bSum =
          b.startCents + b.growthCents + b.contributedCents + b.topUpCents - b.withdrawnCents;
        if (Math.abs(aSum - a.endCents) > 1 || Math.abs(bSum - b.endCents) > 1) broken.push(r.t);
        if (r.helper !== null && r.helper.neededCents < 0) broken.push(r.t);
      }
      expect(broken).toEqual([]);
    });
  });
});
