// Lots (stage-2.md §2.4, D36) and realised gains with the ATO holding-period split (§2.5).
// One queue per instrument. Processing order: trade date ascending, buys before sells on the same
// date, then seq, then id. A sell consumes open lots through the matching strategy's selector
// (only FIFO exists; the seam is `selectLots`). Units beyond every open lot are oversold: no gain
// is booked for them and the holding is flagged. Nothing here throws for data problems.
import {
  addMonthsIso,
  financialYearOfIso,
  tradeFeeDollars,
  type CapitalGainTerm,
  type IsoDate,
} from '@joinr/schema';
import { dec, minDec, ZERO, type Dec } from './num';
import type { EngineTrade, MatchingStrategy } from './types';

/** A buy's parcel while the ledger is processed. */
export interface OpenLot {
  trade: EngineTrade;
  units: Dec;
  price: Dec;
  /** The whole buy fee (fee authority, dollars, unrounded). */
  fee: Dec;
  remaining: Dec;
}

/** One part of a sell matched to one lot. */
export interface LotMatch {
  lot: OpenLot;
  units: Dec;
}

/** Chooses which open lots a sell consumes (the D36 seam). */
export type LotSelector = (
  openLots: readonly OpenLot[],
  sell: { trade: EngineTrade; units: Dec },
) => { matches: LotMatch[]; oversold: Dec };

/** FIFO: the oldest open lots first (the queue is already in processing order). */
const selectFifo: LotSelector = (openLots, sell) => {
  const matches: LotMatch[] = [];
  let left = sell.units;
  for (const lot of openLots) {
    if (!left.greaterThan(0)) break;
    if (!lot.remaining.greaterThan(0)) continue;
    const q = minDec(lot.remaining, left);
    matches.push({ lot, units: q });
    left = left.minus(q);
  }
  return { matches, oversold: left.greaterThan(0) ? left : ZERO };
};

const SELECTORS: Readonly<Record<MatchingStrategy, LotSelector>> = { fifo: selectFifo };

export function selectLots(strategy: MatchingStrategy): LotSelector {
  return SELECTORS[strategy];
}

/** A realised match with unrounded figures. */
export interface Disposal {
  sell: EngineTrade;
  lot: OpenLot;
  units: Dec;
  proceeds: Dec;
  cost: Dec;
  gain: Dec;
  term: CapitalGainTerm;
  financialYear: number;
}

export interface SellOutcome {
  trade: EngineTrade;
  units: Dec;
  fee: Dec;
  disposals: Disposal[];
  oversold: Dec;
}

export interface LedgerResult {
  /** Every trade in processing order (zero-unit rows included, but they touch no lot). */
  order: EngineTrade[];
  /** Buy lots by trade id, with their final remaining units. */
  lots: Map<number, OpenLot>;
  /** Sells by trade id. */
  sells: Map<number, SellOutcome>;
  /** Every match in processing order. */
  disposals: Disposal[];
  /** Parsed units per trade id. */
  units: Map<number, Dec>;
  /** Parsed prices per trade id. */
  prices: Map<number, Dec>;
  /** Authority fee (dollars, unrounded) per trade id. */
  fees: Map<number, Dec>;
}

/** `long` when the disposal is later than the acquisition anniversary (EDATE clamping), §2.5. */
export function capitalGainTerm(acquired: IsoDate, disposed: IsoDate): CapitalGainTerm {
  return disposed > addMonthsIso(acquired, 12) ? 'long' : 'short';
}

/** 0 for buys and zero-unit rows, 1 for sells: buys come first on the same date. */
function sideRank(units: Dec): number {
  return units.lessThan(0) ? 1 : 0;
}

/** The §2.4 processing order (a sorted copy). */
export function processingOrder(
  trades: readonly EngineTrade[],
  units: ReadonlyMap<number, Dec>,
): EngineTrade[] {
  return [...trades].sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
    const side = sideRank(units.get(a.id)!) - sideRank(units.get(b.id)!);
    if (side !== 0) return side;
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.id - b.id;
  });
}

/** Runs every trade through its instrument's queue (§2.4, §2.5). */
export function processLedger(
  trades: readonly EngineTrade[],
  strategy: MatchingStrategy = 'fifo',
): LedgerResult {
  const units = new Map<number, Dec>();
  const prices = new Map<number, Dec>();
  const fees = new Map<number, Dec>();
  for (const t of trades) {
    units.set(t.id, dec(t.units, `trade ${t.id} units`));
    prices.set(t.id, dec(t.price, `trade ${t.id} price`));
    fees.set(t.id, dec(tradeFeeDollars(t), `trade ${t.id} fee`));
  }
  const order = processingOrder(trades, units);
  const select = selectLots(strategy);
  const queues = new Map<number, OpenLot[]>();
  const lots = new Map<number, OpenLot>();
  const sells = new Map<number, SellOutcome>();
  const disposals: Disposal[] = [];

  for (const t of order) {
    const u = units.get(t.id)!;
    if (u.isZero()) continue; // ignored (the importer flags zero-unit rows)
    let queue = queues.get(t.instrumentId);
    if (!queue) {
      queue = [];
      queues.set(t.instrumentId, queue);
    }
    if (u.greaterThan(0)) {
      const lot: OpenLot = {
        trade: t,
        units: u,
        price: prices.get(t.id)!,
        fee: fees.get(t.id)!,
        remaining: u,
      };
      queue.push(lot);
      lots.set(t.id, lot);
      continue;
    }
    const sellUnits = u.abs();
    const sellPrice = prices.get(t.id)!;
    const sellFee = fees.get(t.id)!;
    const { matches, oversold } = select(queue, { trade: t, units: sellUnits });
    const outcome: SellOutcome = {
      trade: t,
      units: sellUnits,
      fee: sellFee,
      disposals: [],
      oversold,
    };
    for (const m of matches) {
      const q = m.units;
      const cost = q.times(m.lot.price).plus(m.lot.fee.times(q).div(m.lot.units));
      const proceeds = q.times(sellPrice).minus(sellFee.times(q).div(sellUnits));
      const d: Disposal = {
        sell: t,
        lot: m.lot,
        units: q,
        proceeds,
        cost,
        gain: proceeds.minus(cost),
        term: capitalGainTerm(m.lot.trade.tradeDate, t.tradeDate),
        financialYear: financialYearOfIso(t.tradeDate),
      };
      m.lot.remaining = m.lot.remaining.minus(q);
      outcome.disposals.push(d);
      disposals.push(d);
    }
    sells.set(t.id, outcome);
  }
  return { order, lots, sells, disposals, units, prices, fees };
}
