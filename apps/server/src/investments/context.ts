// One request's view of the investments data (stage-2.md §4.5 steps 1–3): the prices, the rows (one
// read transaction), the as-of date and the engine results, memoised per kind within the request.
import type { EngineApi, EnginePrice, InvestmentsResult } from '@joinr/engine';
import type { InstrumentKind, IsoDate, PriceItem } from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDatabase } from '../db/database';
import type { MarketDataService, MarketDataStatus } from '../market/types';
import { localIsoDate } from './format';
import {
  loadInvestmentData,
  rowsOfKind,
  toEngineDividend,
  toEngineInstrument,
  toEngineTrade,
  type InstrumentRow,
  type InvestmentData,
  type KindRows,
} from './load';

/** What the investments routes and builders depend on (injected by the route plugin). */
export interface InvestmentsDeps {
  database: AppDatabase;
  market: MarketDataService;
  engine: EngineApi;
  /** The clock: `asOf` is its server-local calendar date. */
  now: () => Date;
}

export interface InvestmentsContext {
  engine: EngineApi;
  now: Date;
  asOf: IsoDate;
  data: InvestmentData;
  market: MarketDataStatus;
  /** Price items by instrument id (manual wins; from the price service). */
  priceItems: ReadonlyMap<number, PriceItem>;
  instrumentById: ReadonlyMap<number, InstrumentRow>;
  rows(kind: InstrumentKind): KindRows;
  /** `computeInvestments` for a kind, computed once per request. */
  compute(kind: InstrumentKind): InvestmentsResult;
}

/** The effective prices of the given instruments, as the engine takes them (§2.13). */
export function enginePrices(
  instrumentIds: Iterable<number>,
  priceItems: ReadonlyMap<number, PriceItem>,
): Map<number, EnginePrice> {
  const out = new Map<number, EnginePrice>();
  for (const id of instrumentIds) {
    const item = priceItems.get(id);
    if (item) out.set(id, { price: item.price, status: item.status });
  }
  return out;
}

export function createInvestmentsContext(
  deps: InvestmentsDeps,
  log?: FastifyBaseLogger,
): InvestmentsContext {
  const now = deps.now();
  const asOf = localIsoDate(now);
  // 1. Prices (the price service reads its own tables), then 2. the rows in one read transaction.
  const prices = deps.market.getPrices();
  const priceItems = new Map(prices.items.map((i) => [i.instrumentId, i]));
  const data = loadInvestmentData(deps.database.db, log);
  const instrumentById = new Map(data.instruments.map((i) => [i.id, i]));
  const rowsMemo = new Map<InstrumentKind, KindRows>();
  const resultMemo = new Map<InstrumentKind, InvestmentsResult>();

  const rows = (kind: InstrumentKind): KindRows => {
    let r = rowsMemo.get(kind);
    if (!r) {
      r = rowsOfKind(data, kind);
      rowsMemo.set(kind, r);
    }
    return r;
  };

  return {
    engine: deps.engine,
    now,
    asOf,
    data,
    market: deps.market.status(),
    priceItems,
    instrumentById,
    rows,
    compute(kind) {
      let result = resultMemo.get(kind);
      if (!result) {
        const r = rows(kind);
        result = deps.engine.computeInvestments({
          kind,
          asOf,
          instruments: r.instruments.map(toEngineInstrument),
          trades: r.trades.map(toEngineTrade),
          dividends: r.dividends.map(toEngineDividend),
          prices: enginePrices(
            r.instruments.map((i) => i.id),
            priceItems,
          ),
        });
        resultMemo.set(kind, result);
      }
      return result;
    },
  };
}
