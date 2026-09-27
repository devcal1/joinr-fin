// Builders for the Stage 6 FIRE engine tests (stage-6.md §7.3, §10.1). Generic round figures only
// (the repo is public).
import type { IsoMonth } from '@joinr/schema';
import type {
  SavingsPeriod,
  SuperContributionResult,
  SuperResult,
  SuperSgMonth,
} from '../src/index';
import { savingsFigures } from './helpers';

/**
 * A savings period: adjusted figures from income and savings; the raw figures equal them unless
 * `rawSavings` says otherwise (a D51 adjustment in between); `superCents` is the voluntary super.
 */
export function period(
  runDate: string,
  o: {
    income: number;
    savings: number | null;
    rawSavings?: number | null;
    superCents?: number;
    status?: SavingsPeriod['status'];
  },
): SavingsPeriod {
  const superCents = o.superCents ?? 20_000;
  const rawSavings = o.rawSavings === undefined ? o.savings : o.rawSavings;
  const baseline = o.status === 'first';
  return {
    periodMonth: runDate.slice(0, 7),
    runDate,
    after: null,
    through: runDate,
    status: o.status ?? 'closed',
    cashCents: 0,
    cashGainCents: rawSavings,
    cashGainRatio: null,
    addedInvestmentsCents: baseline ? null : superCents,
    added: baseline
      ? null
      : {
          tradesCents: 0,
          otherAssetsCents: 0,
          superCents,
          mortgagePrincipalCents: 0,
          propertyDepositCents: 0,
          offsetsCents: 0,
        },
    income: null,
    adjustmentCents: rawSavings === null || o.savings === null ? 0 : rawSavings - o.savings,
    raw: baseline ? savingsFigures(0, null) : savingsFigures(o.income, rawSavings),
    adjusted: baseline ? savingsFigures(0, null) : savingsFigures(o.income, o.savings),
  };
}

/** The baseline period (no figures). */
export const baselinePeriod = (runDate: string): SavingsPeriod =>
  period(runDate, { income: 0, savings: null, status: 'first' });

/** The month ends of `count` months from `first` (YYYY-MM). */
export function monthEnds(first: IsoMonth, count: number): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  for (let k = 0; k < count; k++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** §10.1: twelve closed months (ten at $3,750 spend, one at $2,500, one at −$6,000: a one-off sale). */
export function examplePeriods(): SavingsPeriod[] {
  return [
    baselinePeriod('2029-02-28'),
    ...monthEnds('2029-03', 12).map((d) =>
      d === '2029-08-31'
        ? period(d, { income: 600_000, savings: 350_000 })
        : d === '2029-11-30'
          ? period(d, { income: 640_000, savings: 1_240_000 })
          : period(d, { income: 600_000, savings: 225_000 }),
    ),
    period('2030-03-15', { income: 600_000, savings: 900_000, status: 'provisional' }),
  ];
}

/** One SG month. */
export const sgMonth = (
  month: IsoMonth,
  fundReceivesCents: number,
  source: SuperSgMonth['source'] = 'estimate',
): SuperSgMonth => ({
  month,
  source,
  grossCents: source === 'none' ? 0 : Math.round(fundReceivesCents / 0.85),
  fundReceivesCents,
  fundId: 1,
  capFinancialYear: Number(month.slice(0, 4)) + (Number(month.slice(5, 7)) >= 7 ? 1 : 0),
});

/** One member contribution as the fund receives it. */
export const contribution = (
  id: number,
  date: string,
  fundReceivesCents: number,
  kind: SuperContributionResult['kind'] = 'after_tax',
): SuperContributionResult => ({
  id,
  fundId: 1,
  date,
  kind,
  amountCents: fundReceivesCents,
  estimate: false,
  preTaxCents: kind === 'salary_sacrifice' ? fundReceivesCents : null,
  fundReceivesCents,
  netPayCostCents: fundReceivesCents,
  concessional: kind === 'salary_sacrifice',
});

/** A super result holding only SG months and contributions (all the derivation reads). */
export function superResult(
  sgMonths: SuperSgMonth[],
  contributions: SuperContributionResult[],
): SuperResult {
  return {
    totalCents: 0,
    funds: [],
    contributions,
    sgMonths,
    periods: [],
    annualised: { cumulativeRatio: null, returnRatio: null, from: null, through: null, days: null },
    capYears: [],
    chart: [],
    snapshot: {
      superValueCents: 0,
      superContribCents: 0,
      superGainCents: null,
      superGainRatio: null,
    },
    flags: [],
  };
}

/** §10.1: SG $850 a month (Feb 2029 – Mar 2030) and $9,800 of after-tax contributions in the months. */
export function exampleSuper(): SuperResult {
  const months = monthEnds('2029-02', 14).map((d) => d.slice(0, 7));
  return superResult(
    months.map((m) => sgMonth(m, 85_000)),
    [
      contribution(4, '2030-03-02', 50_000), // asOf's month: outside the 12 whole months
      contribution(3, '2029-12-15', 490_000),
      contribution(2, '2029-06-15', 490_000),
      contribution(1, '2029-02-27', 50_000), // before the months
    ],
  );
}
