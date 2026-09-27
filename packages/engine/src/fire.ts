// The FIRE planner (stage-6.md §2.4, §2.5; D97–D102, §11 fixes 1–23). `deriveFireInputs` turns the
// Stage 3–5 results into the planner's inputs (pre-super net worth and its debts, the yearly spend
// and savings from the closed periods of the 12-month window, the super contribution a year from the
// super engine, the growth weights); `projectFire` runs the corrected model: the exact real rate, the
// bridge to the access age, super sized by the withdrawal rate and topped up from the FIRE pot, the
// FIRE year found by stepping whole years, and the year-by-year plan path in today's dollars. Every
// figure is a decimal until it leaves as cents or a 12-significant-digit ratio, rounded once.
import {
  addMonthsIso,
  FIRE_GROWTH_WEIGHT_KEYS,
  FIRE_HORIZON_AGE,
  type FireGrowthWeightKey,
  type FireMilestoneKind,
  type FireMissingInput,
  type FirePhase,
  type FireStatus,
  type IsoDate,
  type IsoMonth,
} from '@joinr/schema';
import { byRunDate, unroundedSavings } from './kpis';
import { netWorthOf } from './netWorth';
import {
  centsOf,
  checkCents,
  dayNumber,
  dec,
  decN,
  dollarsOf,
  isSafeCents,
  maxDec,
  mean,
  minDec,
  ONE,
  ratioString,
  sum,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import type {
  Cents,
  FireDerived,
  FireDeriveInput,
  FireMilestone,
  FirePeriodRow,
  FireProjection,
  FireProjectionInput,
  FireRow,
  SavingsFigures,
} from './types';

const MONTHS_PER_YEAR = 12;

/** A tiny slack (dollars) so a top-up that closes the shortfall exactly is not split in two. */
const TOP_UP_SLACK: Dec = decN(1e-12);

const centsOrNull = (d: Dec | null): Cents | null => (d === null ? null : centsOf(d));

/** The calendar year of an ISO date (checked). */
function yearOf(date: IsoDate): number {
  dayNumber(date);
  return Number(date.slice(0, 4));
}

/** clamp(x, 0, 1) as a ratio string. */
function clampRatio(x: Dec): string {
  return ratioString(minDec(ONE, maxDec(ZERO, x)));
}

// ═══ Derivation (§2.4) ═══════════════════════════════════════════════════════════════════════════

/** A period's figures before rounding: income, savings and spend (null without a spend figure). */
function unroundedFigures(f: SavingsFigures): { income: Dec; savings: Dec; spend: Dec } | null {
  const savings = unroundedSavings(f);
  if (f.spendCents === null || f.incomeCents === null || savings === null) return null;
  const income = dollarsOf(f.incomeCents, 'income');
  return { income, savings, spend: income.minus(savings) };
}

/** The 12 whole calendar months before `asOf`'s month (D99). */
function contributionMonths(asOf: IsoDate): { fromMonth: IsoMonth; toMonth: IsoMonth } {
  const first = `${asOf.slice(0, 7)}-01`;
  return {
    fromMonth: addMonthsIso(first, -MONTHS_PER_YEAR).slice(0, 7),
    toMonth: addMonthsIso(first, -1).slice(0, 7),
  };
}

/** Where each growth weight comes from and which rate grows it (D102, §2.4 step 5). */
const WEIGHT_RATE: Readonly<Record<FireGrowthWeightKey, 'cash' | 'market'>> = {
  cash: 'cash',
  offsets: 'cash',
  etf: 'market',
  stock: 'market',
  managed_fund: 'market',
  crypto: 'market',
  other_assets: 'market',
  investment_property: 'market',
  super: 'market',
};

export function deriveFireInputs(input: FireDeriveInput): FireDerived {
  dayNumber(input.asOf);

  // Step 1: pre-super net worth (D68, the sheet's E45 rule) and the debts inside it.
  const b = netWorthOf(input.figures);
  const primary = input.property.properties.filter((p) => p.isPrimaryResidence);
  const primaryIds = new Set(primary.map((p) => p.id));
  const primaryResidenceCents = sumCents(primary.map((p) => checkCents(p.valueCents, 'value')));
  const primaryResidenceDebtCents = sumCents(primary.map((p) => checkCents(p.debtCents, 'debt')));
  const primaryResidenceLoanGrossCents = sumCents(
    input.property.loans
      .filter((l) => l.propertyId !== null && primaryIds.has(l.propertyId))
      .map((l) => checkCents(l.balanceCents, 'loan balance')),
  );
  const preSuperCents = b.netWorthCents - b.superCents - primaryResidenceCents;
  const debtCents = sumCents(
    input.liabilities.map((l) => Math.abs(checkCents(l.balanceCents, 'liability'))),
  );

  // Step 2: the closed periods of the Stage 3 12-month window with a spend figure.
  const avg = input.kpis.avgWindow;
  const periods =
    avg === null
      ? []
      : byRunDate(input.savings).filter(
          (p) =>
            p.status === 'closed' && p.runDate >= avg.from && unroundedFigures(p.adjusted) !== null,
        );

  // Step 3: spend and savings per period (D97; savings capped at income where spend is floored).
  const counted = periods.map((p) => {
    const f = unroundedFigures(p.adjusted)!;
    const superNetPay = dollarsOf(p.added?.superCents ?? 0, 'voluntary super');
    const countedSpend = maxDec(ZERO, f.spend);
    const countedSavings = f.income.minus(countedSpend).minus(superNetPay);
    const row: FirePeriodRow = {
      periodMonth: p.periodMonth,
      runDate: p.runDate,
      incomeCents: centsOf(f.income),
      spendCents: centsOf(f.spend),
      countedSpendCents: centsOf(countedSpend),
      superNetPayCents: centsOf(superNetPay),
      countedSavingsCents: centsOf(countedSavings),
      floored: f.spend.isNegative() && !f.spend.isZero(),
    };
    return { period: p, row, countedSpend, countedSavings, superNetPay };
  });
  const rows = counted.map((c) => c.row);
  const floored = rows.filter((r) => r.floored).length;
  const yearly = (values: readonly Dec[]): Dec | null => {
    const m = mean(values);
    return m === null ? null : m.times(MONTHS_PER_YEAR);
  };
  const spendYearly = yearly(counted.map((c) => c.countedSpend));
  const savingsYearly = yearly(counted.map((c) => c.countedSavings));
  const superExcluded = yearly(counted.map((c) => c.superNetPay));
  // The sheet's rules (E47, E48) on the same periods and the unadjusted figures.
  const raw = counted
    .map((c) => unroundedFigures(c.period.raw))
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const rawSpendYearly = yearly(raw.map((f) => f.spend));
  const rawSavingsYearly = yearly(raw.map((f) => f.savings));
  const last = rows[rows.length - 1];
  const window =
    avg === null || last === undefined
      ? null
      : { from: avg.from, through: last.runDate, periods: rows.length };

  // Step 4: the super contribution a year (D99): SG + member contributions as the fund receives
  // them over the 12 whole months before asOf's month.
  const { fromMonth, toMonth } = contributionMonths(input.asOf);
  const inMonths = (month: IsoMonth) => month >= fromMonth && month <= toMonth;
  const sgMonths = input.superResult.sgMonths.filter((m) => inMonths(m.month));
  const sgCents = sumCents(sgMonths.map((m) => checkCents(m.fundReceivesCents, 'SG')));
  const contributions = input.superResult.contributions.filter((c) => inMonths(c.date.slice(0, 7)));
  const memberCents = sumCents(
    contributions.map((c) => checkCents(c.fundReceivesCents, 'contribution')),
  );
  const sources = new Set(sgMonths.map((m) => m.source).filter((s) => s !== 'none'));
  const sgSource: FireDerived['superContribution']['sgSource'] =
    sources.size === 0
      ? 'none'
      : sources.size > 1
        ? 'mixed'
        : sources.has('statement')
          ? 'statement'
          : 'estimate';

  // Step 5: the growth weights (D102): values ≤ 0 left out, the primary residence never weighted.
  const classValue = (key: string): Cents =>
    input.classes.find((c) => c.key === key)?.valueCents ?? 0;
  const valueOf: Readonly<Record<FireGrowthWeightKey, Cents>> = {
    cash: classValue('cash'),
    offsets: classValue('offsets'),
    etf: classValue('etf'),
    stock: classValue('stock'),
    managed_fund: classValue('managed_fund'),
    crypto: classValue('crypto'),
    other_assets: classValue('other_assets'),
    investment_property: sumCents(
      input.property.properties.filter((p) => !p.isPrimaryResidence).map((p) => p.valueCents),
    ),
    super: classValue('super'),
  };
  const weights = FIRE_GROWTH_WEIGHT_KEYS.filter((key) => checkCents(valueOf[key]) > 0).map(
    (key) => ({ key, valueCents: valueOf[key], rate: WEIGHT_RATE[key] }),
  );
  const weightOf = (rate: 'cash' | 'market') =>
    sumCents(weights.filter((w) => w.rate === rate).map((w) => w.valueCents));

  return {
    preSuper: {
      netWorthCents: b.netWorthCents,
      superCents: b.superCents,
      primaryResidenceCents,
      primaryResidenceDebtCents,
      primaryResidenceLoanGrossCents,
      preSuperCents,
      debtCents,
      preSuperExHomeLoanCents: preSuperCents + primaryResidenceLoanGrossCents,
    },
    window,
    rows,
    spend: {
      yearlyCents: centsOrNull(spendYearly),
      flooredPeriods: floored,
      rawYearlyCents: centsOrNull(rawSpendYearly),
    },
    savings: {
      yearlyCents: savingsYearly === null ? null : centsOf(maxDec(ZERO, savingsYearly)),
      cappedPeriods: floored,
      superExcludedCents: superExcluded === null ? 0 : centsOf(superExcluded),
      rawYearlyCents: rawSavingsYearly === null ? null : centsOf(maxDec(ZERO, rawSavingsYearly)),
    },
    superContribution: {
      yearlyCents: sgCents + memberCents,
      sgCents,
      memberCents,
      fromMonth,
      toMonth,
      sgSource,
      contributions: contributions.length,
    },
    growth: { weights, cashWeightCents: weightOf('cash'), marketWeightCents: weightOf('market') },
  };
}

// ═══ Projection (§2.5) ═══════════════════════════════════════════════════════════════════════════

/** A ratio input, or null. */
const ratioOrNull = (value: string | null, what: string): Dec | null =>
  value === null ? null : dec(value, what);

/** The model's closed forms at one real rate (§2.3 notation). */
interface Model {
  r: Dec;
  n: number;
  q: (t: number) => Dec;
  s: (t: number) => Dec;
  a: (t: number) => Dec;
  debtAt: (t: number) => Dec;
  projected: (t: number) => Dec;
  superAt: (t: number) => Dec;
  bridge: (t: number) => number;
  /** Null without a spend. */
  target: Dec | null;
  shortfall: (t: number) => Dec;
  /** The signed needed pre-super figure (§2.5 step 3). */
  needed: (t: number) => Dec;
}

function model(o: {
  r: Dec;
  i: Dec;
  n: number;
  A0: Dec;
  L: Dec;
  B0: Dec;
  P: Dec;
  C: Dec;
  S: Dec | null;
  wr: Dec;
}): Model {
  const { r, i, n, A0, L, B0, P, C, S, wr } = o;
  const growth = ONE.plus(r);
  const deflator = ONE.plus(i);
  const qCache = new Map<number, Dec>();
  const q = (t: number): Dec => {
    let v = qCache.get(t);
    if (v === undefined) {
      v = growth.pow(t);
      qCache.set(t, v);
    }
    return v;
  };
  const s = (t: number): Dec => (r.isZero() ? decN(t) : q(t).minus(ONE).div(r));
  const a = (t: number): Dec => (t <= 0 ? ZERO : r.isZero() ? decN(t) : ONE.minus(q(-t)).div(r));
  const debtAt = (t: number): Dec => L.times(deflator.pow(-t));
  const projected = (t: number): Dec =>
    A0.plus(L)
      .times(q(t))
      .minus(debtAt(t))
      .plus(P.times(s(t)));
  const superAt = (t: number): Dec => B0.times(q(t)).plus(C.times(s(t)));
  const bridge = (t: number): number => Math.max(0, n - t);
  const target = S === null ? null : S.div(wr);
  const shortfall = (t: number): Dec =>
    target === null ? ZERO : maxDec(ZERO, target.minus(superAt(t).times(q(bridge(t)))));
  const needed = (t: number): Dec => {
    if (target === null || S === null) return ZERO;
    if (t >= n) return target.minus(superAt(t));
    return S.times(a(bridge(t))).plus(shortfall(t).div(q(bridge(t))));
  };
  return { r, n, q, s, a, debtAt, projected, superAt, bridge, target, shortfall, needed };
}

/** Top-ups (§2.5 step 6): C a year from FIRE start (the last partial), else a level amount. */
function topUpPayments(m: Model, k: number, C: Dec): { payments: Dec[]; level: boolean } {
  if (k >= m.n) return { payments: [], level: false };
  const D = m.shortfall(k);
  if (!D.greaterThan(0)) return { payments: [], level: false };
  const N = m.n - k;
  if (C.greaterThan(0) && C.times(m.s(N)).greaterThanOrEqualTo(D)) {
    const payments: Dec[] = [];
    let grown = ZERO;
    for (let j = 0; j < N; j++) {
      const factor = m.q(N - 1 - j);
      if (grown.plus(C.times(factor)).greaterThanOrEqualTo(D.minus(TOP_UP_SLACK))) {
        payments.push(maxDec(ZERO, D.minus(grown).div(factor)));
        break;
      }
      payments.push(C);
      grown = grown.plus(C.times(factor));
    }
    return { payments, level: false };
  }
  const level = D.div(m.s(N));
  return { payments: Array.from({ length: N }, () => level), level: true };
}

export function projectFire(input: FireProjectionInput): FireProjection {
  const horizonAge = input.horizonAge ?? FIRE_HORIZON_AGE;
  const asOfYear = yearOf(input.asOf);
  const A0 = dollarsOf(input.preSuperCents, 'pre-super');
  const L = dollarsOf(input.preSuperDebtCents, 'pre-super debts').abs();
  const B0 = dollarsOf(input.superCents, 'super');
  const P = input.savingsPerYearCents === null ? null : dollarsOf(input.savingsPerYearCents);
  const X = dollarsOf(input.extraSavingsPerYearCents, 'extra savings');
  const C = maxDec(ZERO, dollarsOf(input.superContributionPerYearCents, 'super contribution'));
  const S = input.yearlySpendCents === null ? null : dollarsOf(input.yearlySpendCents, 'spend');
  const i = ratioOrNull(input.inflationRatio, 'inflation');
  const wr = ratioOrNull(input.withdrawalRatio, 'withdrawal rate');
  const cashRate = ratioOrNull(input.growth.cashInterestRatio, 'cash interest rate');
  const marketRate = ratioOrNull(input.growth.marketReturnRatio, 'market return');
  const cashW = maxDec(ZERO, dollarsOf(input.growth.cashWeightCents, 'cash weight'));
  const marketW = maxDec(ZERO, dollarsOf(input.growth.marketWeightCents, 'market weight'));
  const savingsUsed = maxDec(ZERO, (P ?? ZERO).plus(X));

  // Step 1: inputs and states.
  const missing: FireMissingInput[] = [];
  const age = input.birthYear === null ? null : asOfYear - input.birthYear;
  const ageOk = age !== null && age >= 0 && age < horizonAge;
  if (!ageOk) missing.push('birthYear');
  const accessOk = input.accessAge !== null && input.accessAge < horizonAge;
  if (!accessOk) missing.push('accessAge');
  if (i === null) missing.push('inflationRate');
  if (wr === null || !wr.greaterThan(0)) missing.push('withdrawalRate');
  const noWeights = cashW.isZero() && marketW.isZero();
  const marketMissing =
    marketRate === null && (marketW.greaterThan(0) || (noWeights && cashRate === null));
  if (marketMissing) missing.push('marketReturn');
  const cashMissing = cashRate === null && cashW.greaterThan(0);
  if (cashMissing) missing.push('cashInterestRate');
  let g: Dec | null = null;
  if (!marketMissing && !cashMissing) {
    g = noWeights
      ? (marketRate ?? cashRate)
      : cashW
          .times(cashRate ?? ZERO)
          .plus(marketW.times(marketRate ?? ZERO))
          .div(cashW.plus(marketW));
  }
  if (g !== null && i !== null && (!ONE.plus(g).greaterThan(0) || !ONE.plus(i).greaterThan(0))) {
    missing.push('rates');
  }

  const ageNow = ageOk ? age : null;
  const n = ageOk && accessOk ? input.accessAge! - age : null;
  const common = {
    ageNow,
    accessYear: n === null ? null : asOfYear + n,
    yearsToAccess: n,
    savingsPerYearCents: centsOf(savingsUsed),
    noSavingsHistory: P === null,
  };

  // The needs_input shape: every projected figure null, the two current figures kept.
  const needsInput = (why: FireMissingInput[]): FireProjection => ({
    status: 'needs_input',
    missing: why,
    ...common,
    rates: null,
    target: null,
    fire: null,
    topUps: null,
    preSuper: {
      currentCents: input.preSuperCents,
      neededAtFireCents: null,
      projectedAtFireCents: null,
      progressRatio: null,
    },
    super: {
      currentCents: input.superCents,
      neededAtAccessCents: null,
      projectedAtAccessCents: null,
      neededAtFireCents: null,
      progressRatio: null,
    },
    milestones: [],
    rows: [],
  });

  if (
    missing.length > 0 ||
    g === null ||
    i === null ||
    wr === null ||
    ageNow === null ||
    n === null
  ) {
    return needsInput(missing);
  }

  // Every projected figure leaves through this converter: a figure beyond the safe-integer cents
  // range (an extreme rate over a long horizon) sets `overflow` and the result becomes
  // needs_input ['rates'] (triage SPEC-1 / CODE-1); it never throws.
  let overflow = false;
  const cents = (d: Dec): Cents => {
    if (!isSafeCents(d)) {
      overflow = true;
      return 0;
    }
    return centsOf(d);
  };
  const safeCentsOrNull = (d: Dec | null): Cents | null => (d === null ? null : cents(d));

  const r = ONE.plus(g).div(ONE.plus(i)).minus(ONE);
  const H = horizonAge - ageNow;
  // Step 2: spend.
  const spendOk = S !== null && S.greaterThan(0);
  const m = model({ r, i, n, A0, L, B0, P: savingsUsed, C, S: spendOk ? S : null, wr });
  // S ÷ wr beyond the cents range: the spend is bounded, so only the withdrawal rate can cause it.
  if (m.target !== null && !isSafeCents(m.target)) return needsInput(['withdrawalRate']);

  // Step 4: the FIRE year, stepped year by year.
  let k: number | null = null;
  if (spendOk) {
    for (let t = 0; t <= H; t++) {
      if (m.projected(t).greaterThanOrEqualTo(m.needed(t))) {
        k = t;
        break;
      }
    }
  }
  const { payments, level } = k === null ? { payments: [], level: false } : topUpPayments(m, k, C);
  const topUpYears = payments.length;

  // Step 6: the plan path.
  const end = Math.min(k === null ? Math.max(n, 0) + 1 : Math.max(n, k) + 1, H);
  const rows: FireRow[] = [];
  const superStart: Dec[] = [];
  let A = A0;
  let B = B0;
  const deflator = ONE.plus(i);
  for (let t = 0; t <= end; t++) {
    const debt = m.debtAt(t);
    const aGrowth = A.plus(debt).times(r).plus(debt.times(i).div(deflator));
    const bGrowth = B.times(r);
    let saved = ZERO;
    let spent = ZERO;
    let topUp = ZERO;
    let contributed = ZERO;
    let withdrawn = ZERO;
    let phase: FirePhase;
    if (k === null || t < k) {
      phase = 'accumulation';
      saved = savingsUsed;
      contributed = C;
    } else if (t < n) {
      spent = S!;
      const j = t - k;
      if (j < topUpYears) {
        phase = 'top_up';
        topUp = payments[j]!;
      } else {
        phase = 'drawdown';
      }
    } else {
      phase = k > n ? 'retired' : 'access';
      withdrawn = minDec(S!, maxDec(ZERO, B.plus(bGrowth)));
      spent = S!.minus(withdrawn);
    }
    const aEnd = A.plus(aGrowth).plus(saved).minus(spent).minus(topUp);
    const bEnd = B.plus(bGrowth).plus(contributed).plus(topUp).minus(withdrawn);
    const needed = spendOk ? m.needed(t) : null;
    const projected = m.projected(t);
    superStart.push(B);
    rows.push({
      t,
      year: asOfYear + t,
      age: ageNow + t,
      phase,
      preSuper: {
        startCents: cents(A),
        growthCents: cents(aGrowth),
        savedCents: cents(saved),
        spentCents: cents(spent),
        topUpCents: cents(topUp),
        endCents: cents(aEnd),
      },
      super: {
        startCents: cents(B),
        growthCents: cents(bGrowth),
        contributedCents: cents(contributed),
        topUpCents: cents(topUp),
        withdrawnCents: cents(withdrawn),
        endCents: cents(bEnd),
      },
      helper:
        needed === null
          ? null
          : {
              neededCents: cents(maxDec(ZERO, needed)),
              projectedCents: cents(projected),
              gapCents: cents(needed.minus(projected)),
            },
    });
    A = aEnd;
    B = bEnd;
  }

  const status: FireStatus = !spendOk
    ? 'spend_needed'
    : k === null
      ? 'not_reachable'
      : k === 0
        ? 'fire'
        : 'on_track';
  const target = m.target;
  const neededAtFire = k === null ? null : maxDec(ZERO, m.needed(k));
  const superAtFireStart = k === null || target === null ? null : target.div(m.q(m.bridge(k)));

  // Step 8: milestones in time order (ties keep the kind order).
  const marks: { kind: FireMilestoneKind; t: number }[] = [{ kind: 'today', t: 0 }];
  if (k !== null && k > 0) marks.push({ kind: 'fire_start', t: k });
  if (k !== null && topUpYears > 0) marks.push({ kind: 'top_ups_end', t: k + topUpYears });
  if (n > 0) marks.push({ kind: 'access', t: n });
  const milestones: FireMilestone[] = marks
    .map((mk, order) => ({ ...mk, order }))
    .sort((x, y) => x.t - y.t || x.order - y.order)
    .map(({ kind, t }) => ({ kind, t, year: asOfYear + t, age: ageNow + t }));

  const result: FireProjection = {
    status,
    missing: [],
    ...common,
    rates: {
      nominalRatio: ratioString(g),
      inflationRatio: ratioString(i),
      realRatio: ratioString(r),
      simpleRealRatio: ratioString(g.minus(i)),
    },
    target:
      target === null
        ? null
        : {
            superAtAccessCents: cents(target),
            superAtFireStartCents: safeCentsOrNull(superAtFireStart),
          },
    fire:
      k === null
        ? null
        : {
            yearsToGo: k,
            year: asOfYear + k,
            age: ageNow + k,
            afterAccess: k > n,
            bridgeYears: m.bridge(k),
          },
    topUps:
      k === null || topUpYears === 0
        ? null
        : {
            years: topUpYears,
            perYearCents: cents(payments[0]!),
            lastCents: cents(payments[topUpYears - 1]!),
            totalCents: cents(sum(payments)),
            level,
            endYear: asOfYear + k + topUpYears,
          },
    preSuper: {
      currentCents: input.preSuperCents,
      neededAtFireCents: safeCentsOrNull(neededAtFire),
      projectedAtFireCents: k === null ? null : cents(m.projected(k)),
      progressRatio:
        neededAtFire === null || !neededAtFire.greaterThan(0)
          ? null
          : clampRatio(A0.div(neededAtFire)),
    },
    super: {
      currentCents: input.superCents,
      neededAtAccessCents: safeCentsOrNull(target),
      projectedAtAccessCents: safeCentsOrNull(superStart[Math.max(n, 0)] ?? null),
      neededAtFireCents: safeCentsOrNull(superAtFireStart),
      progressRatio: target === null || !target.greaterThan(0) ? null : clampRatio(B0.div(target)),
    },
    milestones,
    rows,
  };
  return overflow ? needsInput(['rates']) : result;
}
