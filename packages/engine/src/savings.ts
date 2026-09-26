// The savings engine (stage-3.md §2.5; D51, §11 fixes 12, 18, 19): per snapshot period the cash,
// its gain, the added investments (recomputed from the dated inputs, never from the stored History
// movement columns), the income, and the sheet's raw figures beside the app's adjusted ones. The
// first snapshot is the baseline (cash only); the provisional period uses the live values.
import type { IsoDate } from '@joinr/schema';
import {
  centsOf,
  checkCents,
  dayNumber,
  dec,
  dollarsOf,
  ratioString,
  sum,
  ZERO,
  type Dec,
} from './num';
import { periodIndexOf, periodWindows } from './periods';
import type {
  Cents,
  EngineTrade,
  SavingsFigures,
  SavingsInput,
  SavingsLiveInput,
  SavingsPeriod,
  SavingsResult,
  SavingsSnapshotInput,
} from './types';

/** The figures of a period with no savings (the baseline). */
const NO_FIGURES: SavingsFigures = {
  incomeCents: null,
  savingsCents: null,
  savingsRatio: null,
  spendCents: null,
};

/** Units × price of a trade in dollars (sells negative, fees excluded). */
function orderValue(t: EngineTrade): Dec {
  return dec(t.units, `trade ${t.id} units`).times(dec(t.price, `trade ${t.id} price`));
}

/** §2.5 steps 6–8: savings, ratio and spend from income (cents) and unrounded savings. */
function figures(incomeCents: Cents, savings: Dec | null): SavingsFigures {
  const income = dollarsOf(incomeCents, 'income');
  const defined = savings !== null && income.greaterThan(0);
  return {
    incomeCents,
    savingsCents: savings === null ? null : centsOf(savings),
    savingsRatio: defined ? ratioString(savings.div(income)) : null,
    spendCents: defined ? centsOf(income.minus(savings)) : null,
  };
}

/** The values a period reads from its snapshot, or from `live` for the provisional period. */
interface PeriodValues {
  cash: Cents | null;
  superContrib: Cents | null;
  salary: Cents | null;
  propertyPurchase: Cents | null;
  mortgageBalance: Cents | null;
  principalPaid: Cents | null;
}

function snapshotValues(s: SavingsSnapshotInput): PeriodValues {
  return {
    cash: s.cashValueCents,
    superContrib: s.superContribCents,
    salary: s.salaryMonthlyCents,
    propertyPurchase: s.propertyPurchaseCents,
    mortgageBalance: s.mortgageBalanceCents,
    principalPaid: s.mortgagePrincipalPaidCents,
  };
}

function liveValues(l: SavingsLiveInput): PeriodValues {
  return {
    cash: l.cashCents,
    superContrib: l.superContribCents,
    salary: l.salaryMonthlyCents,
    propertyPurchase: l.propertyPurchaseCents,
    mortgageBalance: l.mortgageBalanceCents,
    principalPaid: l.mortgagePrincipalPaidCents,
  };
}

/** A null money cell counts as 0 inside a sum (§2.1). */
const orZero = (c: Cents | null): Cents => c ?? 0;

export function computeSavings(input: SavingsInput): SavingsResult {
  const asOfDay = dayNumber(input.asOf);
  const windows = periodWindows(input.snapshots, input.asOf, input.live !== null);
  const indexOf = (date: IsoDate): number => periodIndexOf(dayNumber(date), windows, asOfDay);

  // Bucket every dated input by its window (§2.3).
  const trades: Dec[] = windows.map(() => ZERO);
  for (const t of input.trades) {
    const i = indexOf(t.tradeDate);
    if (i >= 0) trades[i] = trades[i]!.plus(orderValue(t));
  }
  const otherAssets: Cents[] = windows.map(() => 0);
  for (const p of input.otherAssetPurchases) {
    const i = indexOf(p.date);
    if (i >= 0) otherAssets[i]! += checkCents(p.amountCents, 'other-asset purchase');
  }
  const sideIncome: Cents[] = windows.map(() => 0);
  for (const d of input.sideIncome) {
    const i = indexOf(d.date);
    if (i >= 0) sideIncome[i]! += checkCents(d.amountCents, 'side-income deposit');
  }
  // Step 5: cash dividends are the sheet's `Reinvested? = "No"`; the rest (reinvested or unknown)
  // are income only in the adjusted figures (§11 fix 12).
  const cashDividends: Cents[] = windows.map(() => 0);
  const otherDividends: Cents[] = windows.map(() => 0);
  for (const d of input.dividends) {
    const i = indexOf(d.paymentDate);
    if (i < 0) continue;
    const net = checkCents(d.netAmountCents, `dividend ${d.id}`);
    if (d.reinvested === false) cashDividends[i]! += net;
    else otherDividends[i]! += net;
  }
  // D51: adjustments by month (several for one month add up).
  const adjustments = new Map<string, Cents>();
  for (const a of input.adjustments) {
    const amount = checkCents(a.amountCents, `adjustment ${a.periodMonth}`);
    adjustments.set(a.periodMonth, (adjustments.get(a.periodMonth) ?? 0) + amount);
  }

  const periods: SavingsPeriod[] = [];
  let prev: PeriodValues | null = null;
  windows.forEach((w, i) => {
    const v: PeriodValues =
      w.snapshot !== null ? snapshotValues(w.snapshot) : liveValues(input.live!);
    const base = {
      periodMonth: w.periodMonth,
      runDate: w.runDate,
      after: w.after,
      through: w.through,
      status: w.status,
      cashCents: v.cash,
    };
    if (prev === null) {
      // §2.3, §11 fix 18: the first snapshot is the baseline, cash only.
      periods.push({
        ...base,
        cashGainCents: null,
        cashGainRatio: null,
        addedInvestmentsCents: null,
        added: null,
        income: null,
        adjustmentCents: 0,
        raw: NO_FIGURES,
        adjusted: NO_FIGURES,
      });
      prev = v;
      return;
    }
    const p: PeriodValues = prev;

    // Step 2: the cash gain (J) and its ratio (K).
    const gain = v.cash === null || p.cash === null ? null : v.cash - p.cash;
    const gainRatio =
      gain === null || p.cash === null || p.cash === 0
        ? null
        : ratioString(dollarsOf(gain).div(dollarsOf(p.cash)));

    // Step 3: the added investments (L), each part from decimals, rounded once at the total.
    const superCents = orZero(v.superContrib);
    const principal = input.includeMortgagePrincipal
      ? orZero(v.principalPaid) - orZero(p.principalPaid)
      : 0;
    const purchaseNow = orZero(v.propertyPurchase);
    const purchaseBefore = orZero(p.propertyPurchase);
    const propertyDeposit =
      purchaseNow !== purchaseBefore
        ? purchaseNow - purchaseBefore + (orZero(v.mortgageBalance) - orZero(p.mortgageBalance))
        : 0;
    const addedDollars = sum([
      trades[i]!,
      dollarsOf(otherAssets[i]!),
      dollarsOf(superCents, 'super contribution'),
      dollarsOf(principal, 'mortgage principal'),
      dollarsOf(propertyDeposit, 'property deposit'),
    ]);

    // Step 4: the adjustment (D51) attaches to closed periods only (§2.3).
    const adjustmentCents = w.status === 'closed' ? (adjustments.get(w.periodMonth) ?? 0) : 0;

    // Step 5: income.
    const rawIncome = orZero(v.salary) + sideIncome[i]! + cashDividends[i]!;
    const adjustedIncome = rawIncome + otherDividends[i]!;

    // Steps 6–8.
    const rawSavings = gain === null ? null : dollarsOf(gain).plus(addedDollars);
    const adjustedSavings =
      rawSavings === null ? null : rawSavings.minus(dollarsOf(adjustmentCents));

    periods.push({
      ...base,
      cashGainCents: gain,
      cashGainRatio: gainRatio,
      addedInvestmentsCents: centsOf(addedDollars),
      added: {
        tradesCents: centsOf(trades[i]!),
        otherAssetsCents: otherAssets[i]!,
        superCents,
        mortgagePrincipalCents: principal,
        propertyDepositCents: propertyDeposit,
      },
      income: {
        salaryCents: v.salary,
        sideIncomeCents: sideIncome[i]!,
        cashDividendsCents: cashDividends[i]!,
        otherDividendsCents: otherDividends[i]!,
      },
      adjustmentCents,
      raw: figures(rawIncome, rawSavings),
      adjusted: figures(adjustedIncome, adjustedSavings),
    });
    prev = v;
  });
  return { periods };
}
