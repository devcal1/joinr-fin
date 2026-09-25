// History goldens (stage-2.md §9.2, §9.3 rule 4): the tabs' contributions blocks (watched symbols
// only, as the sheet's live formula filters them), the exited-instrument difference, and the frozen
// History movement columns (all instruments). Counts only are printed; values are never printed.
import { INSTRUMENT_KINDS, type InstrumentKind } from '@joinr/schema';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributionsAt, netPurchases, purchaseWindows } from '../../src/index';
import { dayNumber } from '../../src/num';
import { historyBlock, historyRows, Sheet, TABS } from './adapter';
import { Tally } from './tally';

const GOLDEN_TIMEOUT = 120_000;

describeWithLocalWorkbook('golden: history against the local workbook', () => {
  describe('contributions and movements', { timeout: GOLDEN_TIMEOUT }, () => {
    let sheet: Sheet;
    const tallies: Tally[] = [];

    beforeAll(() => {
      const bytes = readLocalWorkbookBytes();
      if (bytes === null) throw new Error('golden: the local workbook could not be read');
      sheet = new Sheet(readWorkbook(bytes));
    }, GOLDEN_TIMEOUT);

    afterAll(() => {
      for (const t of tallies) console.log(t.line());
    });

    for (const kind of INSTRUMENT_KINDS) {
      const l = TABS[kind];
      if (l.history === null) continue;
      it(`${l.sheet}: the contributions block (watched symbols only) and the exited difference`, () => {
        const t = new Tally(`${l.sheet} history block`);
        tallies.push(t);
        const tab = sheet.tab(kind);
        const rows = historyBlock(sheet.wb, l);
        const dates = rows.map((r) => r.date);
        const watchedTrades = tab.trades.filter((tr) =>
          tab.watchedSymbols.has(tab.symbolOf.get(tr.instrumentId)!),
        );
        const watched = contributionsAt({
          kind,
          trades: watchedTrades,
          dividends: tab.dividends,
          dates,
        });
        rows.forEach((r, i) => {
          t.money(`${l.sheet}!${l.history!.value}${r.row} contributions`, r.value, watched[i]!);
        });

        // Rule 4: with every instrument, the difference is the exited instruments' net order value.
        const all = contributionsAt({ kind, trades: tab.trades, dividends: tab.dividends, dates });
        const exitedTrades = tab.trades.filter(
          (tr) => !tab.watchedSymbols.has(tab.symbolOf.get(tr.instrumentId)!),
        );
        const exited = contributionsAt({ kind, trades: exitedTrades, dividends: [], dates });
        t.note('exited_instruments', new Set(exitedTrades.map((tr) => tr.instrumentId)).size);
        rows.forEach((r, i) => {
          t.check(
            `${l.sheet}!${l.history!.value}${r.row} exited difference`,
            Math.abs(all[i]! - watched[i]! - exited[i]!) <= 1,
          );
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(t.failures).toEqual([]);
      });
    }

    it('History: frozen movement columns equal the net purchases of every instrument', () => {
      const t = new Tally('History movements');
      tallies.push(t);
      const frozen = historyRows(sheet.wb).filter((h) => h.frozen);
      const windows = purchaseWindows(
        frozen.map((h) => h.date),
        null,
      );
      // purchaseWindows sorts its dates; keep the rows in the same order.
      const ordered = [...frozen].sort(
        (a, b) => dayNumber(a.date) - dayNumber(b.date) || a.row - b.row,
      );
      for (const kind of INSTRUMENT_KINDS as readonly InstrumentKind[]) {
        const l = TABS[kind];
        const purchases = netPurchases({ trades: sheet.tab(kind).trades, windows });
        ordered.forEach((h, i) => {
          t.money(
            `History!${l.movements}${h.row} ${l.sheet} movements`,
            sheet.wb.number('History', `${l.movements}${h.row}`) ?? 0,
            purchases[i]!,
          );
        });
      }
      expect(frozen.length).toBeGreaterThan(0);
      expect(t.failures).toEqual([]);
    });
  });
});
