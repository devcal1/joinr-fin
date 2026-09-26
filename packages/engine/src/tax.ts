// The marginal-rate suggestion (stage-5.md §2.10; D85, D90): the resident bracket of the gross
// salary for asOf's financial year, the singles Medicare levy band, and the suggested rate (the
// bracket plus the marginal levy rate; the bracket alone is offered beside it). The tables are the
// public ATO figures in `@joinr/schema` (§3.2). LITO, HELP, the levy surcharge and family thresholds
// are not built; `litoPhaseOut` lets the hint say so in the offset's phase-out range.
import {
  JoinrDecimal,
  LITO_PHASE_OUT_FROM_CENTS,
  LITO_PHASE_OUT_TO_CENTS,
  MEDICARE_LEVY_RATIO,
  MEDICARE_LOW_INCOME_THRESHOLDS,
  MEDICARE_SHADE_IN_FACTOR,
  MEDICARE_SHADE_IN_RATIO,
  RESIDENT_TAX_TABLES,
  type IsoDate,
} from '@joinr/schema';
import { roundCents } from './assetsCommon';
import { checkCents, dec, decN, ratioString, ZERO } from './num';
import { yearWindow } from './periods';
import type { Cents, MarginalRateSuggestion } from './types';

/**
 * The entry for `fy` in a table keyed by FY start year, else the latest one before it, else the
 * earliest (an FY before every table).
 */
function tableFor<T>(table: Readonly<Record<number, T>>, fy: number): { year: number; value: T } {
  const years = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) throw new RangeError('engine: an empty tax table');
  const earlier = years.filter((y) => y <= fy);
  const year = earlier.length > 0 ? earlier[earlier.length - 1]! : years[0]!;
  return { year, value: table[year]! };
}

export function suggestMarginalRate(i: {
  incomeCents: Cents | null;
  asOf: IsoDate;
}): MarginalRateSuggestion | null {
  const financialYear = yearWindow(i.asOf, 'fy').year; // validates asOf
  if (i.incomeCents === null) return null;
  const income = checkCents(i.incomeCents, 'income');
  if (income < 0) return null;
  const incomeDec = decN(income);

  // The bracket: thresholdCents < income ≤ toCents; an income of 0 is in the first band.
  const table = tableFor(RESIDENT_TAX_TABLES, financialYear);
  const bands = table.value.map((b, k, all) => ({
    thresholdCents: b.thresholdCents,
    toCents: k + 1 < all.length ? all[k + 1]!.thresholdCents : null,
    rate: dec(b.ratio, 'tax band ratio'),
  }));
  let band = bands[0]!;
  for (const b of bands) if (b.thresholdCents < income) band = b;
  let tax = ZERO;
  for (const b of bands) {
    const top = b.toCents === null ? income : Math.min(income, b.toCents);
    const taxed = top - b.thresholdCents;
    if (taxed > 0) tax = tax.plus(b.rate.times(taxed));
  }

  // The Medicare levy (singles): none to the threshold, 10 c/$ above it to threshold × 1.25, then 2 %.
  const threshold = tableFor(MEDICARE_LOW_INCOME_THRESHOLDS, financialYear);
  const thresholdCents = threshold.value;
  const shadeInEnd = decN(thresholdCents).times(new JoinrDecimal(MEDICARE_SHADE_IN_FACTOR));
  let medicareBand: MarginalRateSuggestion['medicare']['band'];
  let levyRatio: InstanceType<typeof JoinrDecimal>;
  let levy: InstanceType<typeof JoinrDecimal>;
  if (income <= thresholdCents) {
    medicareBand = 'none';
    levyRatio = ZERO;
    levy = ZERO;
  } else if (incomeDec.lessThanOrEqualTo(shadeInEnd)) {
    medicareBand = 'shade_in';
    levyRatio = new JoinrDecimal(MEDICARE_SHADE_IN_RATIO);
    levy = levyRatio.times(income - thresholdCents);
  } else {
    medicareBand = 'full';
    levyRatio = new JoinrDecimal(MEDICARE_LEVY_RATIO);
    levy = levyRatio.times(income);
  }

  const bracketRatio = ratioString(band.rate);
  return {
    financialYear,
    tableFinancialYear: table.year,
    tableCurrent: table.year === financialYear,
    incomeCents: income,
    bracket: { thresholdCents: band.thresholdCents, toCents: band.toCents, ratio: bracketRatio },
    bracketRatio,
    medicare: {
      thresholdCents,
      thresholdFinancialYear: threshold.year,
      ratio: ratioString(levyRatio),
      band: medicareBand,
    },
    suggestedRatio: ratioString(band.rate.plus(levyRatio)),
    incomeTaxCents: roundCents(tax),
    medicareLevyCents: roundCents(levy),
    litoPhaseOut: income > LITO_PHASE_OUT_FROM_CENTS && income <= LITO_PHASE_OUT_TO_CENTS,
  };
}
