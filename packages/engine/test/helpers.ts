// Builders for the engine unit tests. Generic values only (repo is public): made-up symbols such
// as ASX:ABC, ASX:DEF, ASX:XYZ, EXAMPLEFUND, BTC and ETH, and round numbers.
import {
  JoinrDecimal,
  type InstrumentKind,
  type PriceStatus,
  type SavingsPeriodStatus,
} from '@joinr/schema';
import { computeInvestments } from '../src/index';
import type {
  EngineDividend,
  EngineInstrument,
  EnginePrice,
  EngineTrade,
  InvestmentsInput,
  InvestmentsResult,
  SavingsFigures,
  SavingsPeriod,
} from '../src/index';

export function instrument(
  id: number,
  symbol: string,
  over: Partial<EngineInstrument> = {},
): EngineInstrument {
  return {
    id,
    kind: 'stock',
    symbol,
    name: null,
    watched: true,
    sortOrder: id,
    targetRatio: null,
    sector: null,
    regions: { us: null, asia: null, aus: null, other: null },
    mgmtFeeRatio: null,
    dividendFreqMonths: null,
    ...over,
  };
}

export function trade(
  id: number,
  instrumentId: number,
  tradeDate: string,
  units: string,
  price: string,
  over: Partial<EngineTrade> = {},
): EngineTrade {
  return {
    id,
    instrumentId,
    tradeDate,
    units,
    price,
    feeCents: 0,
    feeRate: null,
    seq: id,
    ...over,
  };
}

export function dividend(
  id: number,
  instrumentId: number | null,
  paymentDate: string,
  netAmountCents: number,
  over: Partial<EngineDividend> = {},
): EngineDividend {
  return {
    id,
    instrumentId,
    holdingKind: 'stock',
    paymentDate,
    exDate: null,
    reinvested: null,
    netAmountCents,
    priceAtEx: null,
    ...over,
  };
}

export function prices(
  entries: readonly (readonly [number, string | null, PriceStatus?])[],
): Map<number, EnginePrice> {
  return new Map(entries.map(([id, price, status]) => [id, { price, status: status ?? 'fresh' }]));
}

export function run(
  input: Partial<InvestmentsInput> & { instruments: readonly EngineInstrument[] },
): InvestmentsResult {
  const kind: InstrumentKind = input.kind ?? input.instruments[0]?.kind ?? 'stock';
  return computeInvestments({
    kind,
    asOf: '2026-09-24',
    trades: [],
    dividends: [],
    prices: new Map(),
    ...input,
  });
}

/** A 12-significant-digit ratio string of a decimal expression, for expectations. */
export function ratio(expr: InstanceType<typeof JoinrDecimal>): string {
  const d = expr.toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP);
  return d.isZero() ? '0' : d.toFixed();
}

export type Decimal = InstanceType<typeof JoinrDecimal>;

export const D = (v: string | number): Decimal => new JoinrDecimal(v);

/** Dollars → integer cents, half away from zero (an expectation helper). */
export function cents(dollars: Decimal): number {
  return dollars.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
}

// ─── Savings periods built directly with the stage-3.md §2.5 rules (KPI and chart tests) ───────

/** §2.5 steps 6–8 from income and savings cents. */
export function savingsFigures(incomeCents: number, savingsCents: number | null): SavingsFigures {
  const defined = savingsCents !== null && incomeCents > 0;
  return {
    incomeCents,
    savingsCents,
    savingsRatio: defined ? ratio(D(savingsCents).div(incomeCents)) : null,
    spendCents: defined ? incomeCents - savingsCents : null,
  };
}

/**
 * A closed (or provisional) period: raw savings = gain + added; the adjustment comes off the
 * adjusted savings; reinvested dividends (`otherDividends`) are adjusted income only.
 */
export function savingsPeriod(
  runDate: string,
  o: {
    gain: number | null;
    added?: number;
    income?: number;
    adjustment?: number;
    otherDividends?: number;
    cash?: number | null;
    status?: SavingsPeriodStatus;
  },
): SavingsPeriod {
  const added = o.added ?? 0;
  const income = o.income ?? 500_000;
  const other = o.otherDividends ?? 0;
  const adjustment = o.adjustment ?? 0;
  const raw = o.gain === null ? null : o.gain + added;
  return {
    periodMonth: runDate.slice(0, 7),
    runDate,
    after: null,
    through: runDate,
    status: o.status ?? 'closed',
    cashCents: o.cash === undefined ? 1_000_000 : o.cash,
    cashGainCents: o.gain,
    cashGainRatio: null,
    addedInvestmentsCents: added,
    added: null,
    income: null,
    adjustmentCents: adjustment,
    raw: savingsFigures(income - other, raw),
    adjusted: savingsFigures(income, raw === null ? null : raw - adjustment),
  };
}

/** The baseline period: cash only. */
export function firstPeriod(runDate: string, cash = 1_000_000): SavingsPeriod {
  const none = { incomeCents: null, savingsCents: null, savingsRatio: null, spendCents: null };
  return {
    ...savingsPeriod(runDate, { gain: null, cash }),
    status: 'first',
    addedInvestmentsCents: null,
    raw: none,
    adjusted: none,
  };
}
