// Shared helpers for the Stage 4 server suites: hand-built engine results (so the DTO mapping is
// checked field by field before the engine lands) and a STRUCTURAL fake engine whose three assets
// functions return one row per input row with simple, predictable figures (the latest entry's
// balance or value, remaining × price in AUD), enough for the mutation and response mechanics.
// It is not the engine: every real figure is the engine's own suite's business. Generic values
// only.
import type {
  AmortisationResult,
  EngineApi,
  LoanResult,
  OtherAssetResult,
  OtherAssetsInput,
  OtherAssetsResult,
  PropertiesResult,
  PropertyInput,
  PropertyResultRow,
  SuperInput,
  SuperPeriod,
  SuperResult,
} from '@joinr/engine';
import {
  financialYearOfIso,
  isoMonthOf,
  JoinrDecimal,
  multiplyToCents,
  normaliseDecimal,
  type IsoDate,
} from '@joinr/schema';
import { latestEntryAt } from '../../src/assets/inputs';
import { fakeEngine, type FakeEngine } from '../investments/helpers';

export {
  AS_OF,
  call,
  errorOf,
  fakeMarket,
  hasAppDataOf,
  NOW,
  startApp,
  type TestApp,
} from '../cashflow/helpers';

// ─── Hand-built engine results ──────────────────────────────────────────────────────────────────

export function otherAssetResult(
  p: Partial<OtherAssetResult> & Pick<OtherAssetResult, 'id'>,
): OtherAssetResult {
  return {
    remainingUnits: '1',
    costCents: null,
    unitPriceAud: null,
    valueCents: null,
    gainCents: null,
    gainRatio: null,
    cagrRatio: null,
    effectiveDate: null,
    dateAssumed: false,
    heldDays: null,
    priceStatus: 'none',
    priceAsOf: null,
    sales: [],
    realisedCents: 0,
    flags: [],
    ...p,
  };
}

export function superPeriod(
  p: Partial<SuperPeriod> & Pick<SuperPeriod, 'periodMonth' | 'runDate'>,
): SuperPeriod {
  return {
    after: null,
    through: p.runDate,
    status: 'closed',
    valueCents: null,
    notUpdated: false,
    flows: null,
    gainFrom: null,
    changeCents: null,
    gainFlows: null,
    gainCents: null,
    gainRatio: null,
    returnRatio: null,
    ...p,
  };
}

export function amortisation(p: Partial<AmortisationResult> = {}): AmortisationResult {
  return {
    periodicRatio: '0.005',
    firstPaymentDate: '2026-10-15',
    firstPeriodInterestCents: 100000,
    payments: 240,
    payoffDate: '2046-09-15',
    totalInterestCents: 20000000,
    points: [],
    flag: null,
    ...p,
  };
}

// ─── The structural fake ────────────────────────────────────────────────────────────────────────

const cents = (units: string, price: string) => {
  try {
    return multiplyToCents(units, price);
  } catch {
    return null;
  }
};

/** Remaining units, AUD value at the manual price or spot × oz; cost at the stored FX. */
export function structuralOtherAssets(input: OtherAssetsInput): OtherAssetsResult {
  const assets: OtherAssetResult[] = input.assets.map((a) => {
    let remaining = new JoinrDecimal(a.units).minus(a.legacySoldUnits);
    for (const s of a.sales) remaining = remaining.minus(s.units);
    const left = normaliseDecimal(JoinrDecimal.max(remaining, 0));
    const fx = a.currency === 'AUD' ? '1' : a.purchaseFxRate;
    const liveFx = a.currency === 'AUD' ? '1' : (input.fxRates[a.currency] ?? null);
    let unitPriceAud: string | null = null;
    let priceAsOf: IsoDate | null;
    if (a.pricing.source === 'manual') {
      if (a.pricing.unitPrice !== null && liveFx !== null) {
        unitPriceAud = normaliseDecimal(new JoinrDecimal(a.pricing.unitPrice).times(liveFx));
      }
      priceAsOf = a.pricing.priceAsOf;
    } else if (a.pricing.spot) {
      unitPriceAud = normaliseDecimal(
        new JoinrDecimal(a.pricing.spot.audPerOz).times(a.pricing.ozPerUnit),
      );
      priceAsOf = a.pricing.spot.asOf;
    } else {
      unitPriceAud = a.pricing.fallbackUnitPrice;
      priceAsOf = a.pricing.fallbackAsOf;
    }
    const costCents =
      a.unitCost === null || fx === null
        ? null
        : cents(left, normaliseDecimal(new JoinrDecimal(a.unitCost).times(fx)));
    const valueCents = unitPriceAud === null ? null : cents(left, unitPriceAud);
    const effectiveDate = a.purchaseDate ?? input.assumedDate;
    return otherAssetResult({
      id: a.id,
      remainingUnits: left,
      costCents,
      unitPriceAud,
      valueCents,
      gainCents: costCents === null || valueCents === null ? null : valueCents - costCents,
      effectiveDate,
      dateAssumed: a.purchaseDate === null && effectiveDate !== null,
      priceStatus: unitPriceAud === null ? 'none' : 'manual',
      priceAsOf,
      sales: a.sales.map((s) => ({
        id: s.id,
        saleDate: s.saleDate,
        units: s.units,
        proceedsCents: s.proceedsCents,
        costCents: null,
        realisedCents: null,
      })),
      flags: a.purchaseDate === null ? ['no_purchase_date'] : [],
    });
  });
  const valueCents = assets.reduce((s, a) => s + (a.valueCents ?? 0), 0);
  const both = assets.filter((a) => a.valueCents !== null && a.costCents !== null);
  return {
    assets,
    totals: {
      valueCents,
      costCents: both.reduce((s, a) => s + a.costCents!, 0),
      gainCents: both.reduce((s, a) => s + a.gainCents!, 0),
      gainRatio: null,
      realisedCents: 0,
      proceedsCents: input.assets.reduce(
        (s, a) => s + a.sales.reduce((t, x) => t + x.proceedsCents, 0),
        0,
      ),
      unpricedCount: assets.filter((a) => a.valueCents === null).length,
      staleCount: 0,
      assumedDateCount: assets.filter((a) => a.dateAssumed).length,
      fxMissingCount: 0,
      liveFxMissingCount: 0,
    },
    savingsFlows: [],
    chart: [],
    snapshot: { otherValueCents: valueCents, otherGainCents: 0 },
  };
}

/** Each fund at its latest entry; contributions at face value; the statements as SG months. */
export function structuralSuper(input: SuperInput): SuperResult {
  const sgFund = input.funds.find((f) => f.receivesSg)?.id ?? null;
  const funds = input.funds.map((f) => {
    const latest = latestEntryAt(f.balances, input.asOf);
    return {
      id: f.id,
      receivesSg: f.receivesSg,
      archived: f.archived,
      balanceCents: latest?.balanceCents ?? null,
      balanceAsOf: latest?.asOf ?? null,
      entries: [...f.balances]
        .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))
        .map((e) => ({
          id: e.id,
          asOf: e.asOf,
          balanceCents: e.balanceCents,
          transferInCents: e.transferInCents,
          flowsCents: null,
          gainCents: null,
        })),
    };
  });
  const runs = [...input.snapshots].sort((a, b) => (a.runDate < b.runDate ? -1 : 1));
  const periods: SuperPeriod[] = runs.map((s, i) =>
    superPeriod({
      periodMonth: s.periodMonth,
      runDate: s.runDate,
      after: i === 0 ? null : runs[i - 1]!.runDate,
      through: s.runDate,
      status: i === 0 ? 'first' : 'closed',
      valueCents: s.superValueCents,
    }),
  );
  const lastRun = runs.at(-1)?.runDate ?? null;
  const totalCents = funds
    .filter((f) => !f.archived)
    .reduce((s, f) => s + (f.balanceCents ?? 0), 0);
  if (lastRun !== null && input.asOf > lastRun) {
    periods.push(
      superPeriod({
        periodMonth: isoMonthOf(input.asOf),
        runDate: input.asOf,
        after: lastRun,
        through: input.asOf,
        status: 'provisional',
        valueCents: totalCents,
      }),
    );
  }
  const contributions = [...input.contributions]
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.id - a.id))
    .map((c) => ({
      id: c.id,
      fundId: c.fundId,
      date: c.date,
      kind: c.kind,
      amountCents: c.amountCents,
      estimate: c.kind === 'voluntary_contribution',
      preTaxCents: c.kind === 'after_tax' ? null : c.amountCents,
      fundReceivesCents: c.amountCents,
      netPayCostCents: c.amountCents,
      concessional: c.kind !== 'after_tax',
    }));
  return {
    totalCents,
    funds,
    contributions,
    sgMonths: input.sgOverrides.map((o) => ({
      month: o.periodMonth,
      source: 'statement',
      grossCents: o.grossCents,
      fundReceivesCents: o.grossCents,
      fundId: sgFund,
      capFinancialYear: financialYearOfIso(`${o.periodMonth}-01`),
    })),
    periods,
    annualised: { cumulativeRatio: null, returnRatio: null, from: null, through: null, days: null },
    capYears: [],
    chart: [],
    snapshot: {
      superValueCents: totalCents,
      superContribCents: contributions
        .filter((c) => (lastRun === null || c.date > lastRun) && c.date <= input.asOf)
        .reduce((s, c) => s + (c.netPayCostCents ?? 0), 0),
      superGainCents: null,
      superGainRatio: null,
    },
    flags: [],
  };
}

/** Each property at its latest valuation; each loan at its latest entry with its offsets. */
export function structuralProperty(input: PropertyInput): PropertiesResult {
  const fake = fakeEngine().computeProperty(input);
  const loans: LoanResult[] = input.loans.map((l) => {
    const latest = latestEntryAt(l.entries, input.asOf)!;
    const first = [...l.entries].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))[0]!;
    const offsetCents = l.offsets.reduce((s, o) => s + o.balanceCents, 0);
    const startBalanceCents = l.startBalanceCents ?? first.balanceCents;
    return {
      id: l.id,
      propertyId: l.propertyId,
      balanceCents: latest.balanceCents,
      balanceAsOf: latest.asOf,
      startBalanceCents,
      paymentAnchorDate: l.startDate ?? first.asOf,
      offsetCents,
      netBalanceCents: Math.max(0, latest.balanceCents - offsetCents),
      excessOffsetCents: Math.max(0, offsetCents - latest.balanceCents),
      entries: [...l.entries]
        .sort((a, b) => (a.asOf < b.asOf ? -1 : 1))
        .map((e) => ({
          id: e.id,
          start: false,
          asOf: e.asOf,
          balanceCents: e.balanceCents,
          paymentsCounted: null,
          repaymentsCents: e.repaymentsCents,
          repaymentsTyped: e.repaymentsCents !== null,
          principalCents: null,
          interestFeesCents: null,
          cumulativePrincipalCents: startBalanceCents - e.balanceCents,
          cumulativeInterestFeesCents: 0,
          flags: [],
        })),
      repaymentsCents: 0,
      principalPaidCents: startBalanceCents - latest.balanceCents,
      interestFeesCents: 0,
      nextPeriodInterestCents: null,
      schedule: null,
      scheduleWithoutOffset: null,
      interestSavedCents: null,
      monthsSaved: null,
      flags: l.propertyId === null ? ['no_property'] : [],
    };
  });
  const properties: PropertyResultRow[] = input.properties.map((p) => {
    const latest = latestEntryAt(p.valuations, input.asOf)!;
    const mine = loans.filter((l) => l.propertyId === p.id);
    const debt = mine.reduce((s, l) => s + l.netBalanceCents, 0);
    return {
      id: p.id,
      isPrimaryResidence: p.isPrimaryResidence,
      valueCents: latest.valueCents,
      valuationDate: latest.asOf,
      purchaseValueCents: p.purchaseValueCents,
      netRentCents: p.netRentToDateCents,
      gainCents: latest.valueCents + p.netRentToDateCents - p.purchaseValueCents,
      gainRatio: null,
      cagrRatio: null,
      heldDays: null,
      loanIds: mine.map((l) => l.id),
      debtCents: debt,
      equityCents: latest.valueCents - debt,
      lvrRatio: null,
    };
  });
  const mortgages = loans.filter((l) => l.propertyId !== null);
  return {
    ...fake,
    properties,
    loans,
    savingsLive: {
      propertyPurchaseCents:
        properties.length === 0 ? null : properties.reduce((s, p) => s + p.purchaseValueCents, 0),
      mortgageBalanceCents:
        mortgages.length === 0 ? null : -mortgages.reduce((s, l) => s + l.balanceCents, 0),
      mortgagePrincipalPaidCents:
        mortgages.length === 0 ? null : mortgages.reduce((s, l) => s + l.principalPaidCents, 0),
    },
  };
}

/** The neutral fake with the three structural assets functions (overrides win). */
export function assetsFakeEngine(overrides: Partial<EngineApi> = {}): FakeEngine {
  return fakeEngine({
    computeOtherAssets: structuralOtherAssets,
    computeSuper: structuralSuper,
    computeProperty: structuralProperty,
    ...overrides,
  });
}
