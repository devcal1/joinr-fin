// Realised gains by financial year (stage-2.md §2.5, §2.10, D42): per FY, the gains are summed by
// term and rounded once; total = short + long; `disposals` counts the matches. Rows: every FY with
// a disposal plus the FY of `asOf` (zeros when empty), newest first. No tax, rate or discount.
import { financialYearOfIso, type CapitalGainTerm, type IsoDate } from '@joinr/schema';
import { centsOf, dollarsOf, ZERO, type Dec } from './num';
import type { DisposalResult, FyRealisedRow } from './types';

export interface FyGain {
  financialYear: number;
  term: CapitalGainTerm;
  gain: Dec;
}

/** The FY table from gains (computeInvestments passes the unrounded gains of its matches). */
export function fyRowsFromGains(gains: readonly FyGain[], asOf: IsoDate): FyRealisedRow[] {
  const byFy = new Map<number, { short: Dec; long: Dec; n: number }>();
  const row = (fy: number) => {
    let r = byFy.get(fy);
    if (!r) {
      r = { short: ZERO, long: ZERO, n: 0 };
      byFy.set(fy, r);
    }
    return r;
  };
  for (const g of gains) {
    const r = row(g.financialYear);
    if (g.term === 'long') r.long = r.long.plus(g.gain);
    else r.short = r.short.plus(g.gain);
    r.n += 1;
  }
  row(financialYearOfIso(asOf));
  return [...byFy.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([financialYear, r]) => {
      const shortTermCents = centsOf(r.short);
      const longTermCents = centsOf(r.long);
      return {
        financialYear,
        shortTermCents,
        longTermCents,
        totalCents: shortTermCents + longTermCents,
        disposals: r.n,
      };
    });
}

/**
 * The FY table from disposal rows. A DisposalResult carries its gain already rounded to cents, so
 * this sums those; `computeInvestments` builds its `realisedByFy` from the unrounded gains with
 * the same grouping (§2.5: rounded once per FY and term).
 */
export function realisedByFinancialYear(
  disposals: readonly DisposalResult[],
  asOf: IsoDate,
): FyRealisedRow[] {
  return fyRowsFromGains(
    disposals.map((d) => ({
      financialYear: d.financialYear,
      term: d.term,
      gain: dollarsOf(d.gainCents, 'gainCents'),
    })),
    asOf,
  );
}
