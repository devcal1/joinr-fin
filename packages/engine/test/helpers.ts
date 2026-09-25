// Builders for the engine unit tests. Generic values only (repo is public): made-up symbols such
// as ASX:ABC, ASX:DEF, ASX:XYZ, EXAMPLEFUND, BTC and ETH, and round numbers.
import { JoinrDecimal, type InstrumentKind, type PriceStatus } from '@joinr/schema';
import { computeInvestments } from '../src/index';
import type {
  EngineDividend,
  EngineInstrument,
  EnginePrice,
  EngineTrade,
  InvestmentsInput,
  InvestmentsResult,
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

export const D = (v: string | number) => new JoinrDecimal(v);
