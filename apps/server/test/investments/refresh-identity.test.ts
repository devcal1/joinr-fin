// The price refresh's identity check (stage-2.md §4.5 "Id reuse"): instrument ids have no
// AUTOINCREMENT, so deleting the highest id and creating another instrument reuses it. A refresh
// that chose its targets before such a delete + create must not write the old instrument's price
// (or its CoinGecko id) onto the new one.
import { prices, priceSources, instruments } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CoinIdResolver,
  PriceProviderClient,
  QuoteBatch,
  QuoteRequest,
} from '../../src/market/providers/types';
import { Cooldowns, runRefresh, type Providers } from '../../src/market/refresh';
import { noSleep, silentLogger } from '../market/helpers';
import { NOW } from './helpers';

let t: TestDb;
let ids: Record<string, number>;

beforeEach(() => {
  t = createTestDb();
  ids = seedGenericData(t.db, { now: NOW }).instrumentIds;
});
afterEach(() => t.close());

/** Replaces the instrument with the highest id by a new one that reuses the id. */
function deleteAndRecreateHighest(kind: 'crypto' | 'etf', symbol: string): number {
  const highest = t.sqlite.prepare('SELECT max(id) AS id FROM instruments').get() as { id: number };
  t.db.delete(instruments).where(eq(instruments.id, highest.id)).run();
  const created = t.db
    .insert(instruments)
    .values({ kind, symbol, code: symbol, sortOrder: 9, origin: 'app' })
    .returning({ id: instruments.id })
    .get();
  expect(created.id).toBe(highest.id);
  return created.id;
}

function provider(
  id: 'yahoo' | 'coingecko',
  onFetch: (reqs: QuoteRequest[]) => void,
): PriceProviderClient & CoinIdResolver {
  return {
    id,
    async fetchQuotes(reqs): Promise<QuoteBatch> {
      onFetch(reqs);
      return {
        quotes: reqs.map((r) => ({
          key: r.key,
          price: '123.45',
          currency: r.key === 'AUDUSD' || r.symbol.endsWith('=F') ? 'USD' : 'AUD',
          asOf: NOW.toISOString(),
        })),
        failures: [],
      };
    },
    async searchId(symbol) {
      return { ok: true, id: `${symbol.toLowerCase()}-coin` };
    },
  };
}

function ctx(providers: Providers) {
  return {
    db: t.db,
    providers,
    cooldowns: new Cooldowns(),
    now: () => NOW,
    sleep: noSleep,
    signal: new AbortController().signal,
    log: silentLogger(),
  };
}

describe('runRefresh identity check', () => {
  it('writes no price to an instrument that reused a refreshed id', async () => {
    const eth = ids.ETH!; // the highest seeded id
    let swapped = -1;
    const providers: Providers = {
      yahoo: provider('yahoo', () => undefined),
      coingecko: provider('coingecko', (reqs) => {
        if (swapped === -1 && reqs.some((r) => r.key === String(eth))) {
          swapped = deleteAndRecreateHighest('crypto', 'XYZCOIN');
        }
      }),
    };
    const outcome = await runRefresh(ctx(providers), { instrumentIds: [ids.BTC!, eth] });
    expect(swapped).toBe(eth);
    expect(outcome.byProvider.coingecko).toMatchObject({ requested: 2, ok: 1, skipped: 1 });
    expect(t.db.select().from(prices).where(eq(prices.instrumentId, eth)).get()).toBeUndefined();
    expect(t.db.select().from(prices).where(eq(prices.instrumentId, ids.BTC!)).get()).toMatchObject(
      {
        price: '123.45',
      },
    );
  });

  it('writes no resolved CoinGecko id onto an instrument that reused the id', async () => {
    const eth = ids.ETH!;
    t.db
      .update(priceSources)
      .set({ providerSymbol: null })
      .where(eq(priceSources.instrumentId, eth))
      .run();
    let swapped = -1;
    const providers: Providers = {
      yahoo: provider('yahoo', () => undefined),
      coingecko: {
        ...provider('coingecko', () => undefined),
        async searchId(symbol) {
          swapped = deleteAndRecreateHighest('crypto', 'XYZCOIN');
          return { ok: true, id: `${symbol.toLowerCase()}-coin` };
        },
      },
    };
    await runRefresh(ctx(providers), { instrumentIds: [eth] });
    expect(swapped).toBe(eth);
    expect(
      t.db.select().from(priceSources).where(eq(priceSources.instrumentId, eth)).get(),
    ).toBeUndefined();
    expect(t.db.select().from(prices).where(eq(prices.instrumentId, eth)).get()).toBeUndefined();
  });

  it('still writes when the instrument is unchanged', async () => {
    const providers: Providers = {
      yahoo: provider('yahoo', () => undefined),
      coingecko: provider('coingecko', () => undefined),
    };
    const outcome = await runRefresh(ctx(providers), { instrumentIds: [ids.ETH!] });
    expect(outcome).toMatchObject({ ok: 1, skipped: 0 });
    expect(t.db.select().from(prices).where(eq(prices.instrumentId, ids.ETH!)).get()).toMatchObject(
      { price: '123.45' },
    );
  });
});
