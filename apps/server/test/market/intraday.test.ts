// Stage 9 `intraday` job (stage-9.md §5.6, §5.7; the slots and scopes are FROZEN): slot times
// across both DST changes, the scopes of a slot (never the wall clock at start), the bullion
// window, a late slot, the start-up run, `stop()`, INTRADAY_REFRESH off, the ASX scope skipped
// while `prices` runs, `prices` waiting for an in-flight run, crypto's day charts and their
// cool-down. Manual timers, scripted providers, an in-memory database; made-up values.
process.env.TZ = 'Australia/Melbourne';

import { INTRADAY_STARTUP_DELAY_MS, wallTimeInZone } from '@joinr/schema';
import { dayQuotes, jobRuns, otherAssets, prices } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inBullionWindow,
  isSlotLate,
  nextSlot,
  scopesForSlot,
  startupScopes,
} from '../../src/market/intraday/schedule';
import {
  bullionSeriesFor,
  heldBullionMetals,
  intradayTargets,
} from '../../src/market/intraday/service';
import { createService } from '../../src/market/service';
import { createScheduler } from '../../src/scheduler/index';
import type { Clock } from '../../src/scheduler/types';
import { everyMinutes, scriptedProvider, sec, type ScriptedProvider } from './dayHelpers';
import { silentLogger } from './helpers';

const MELBOURNE = 'Australia/Melbourne';
const ms = (iso: string) => Date.parse(iso);
const local = (iso: string) => {
  const w = wallTimeInZone(ms(iso), MELBOURNE)!;
  return `${w.date} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
};

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
});

// ─── Slots and scopes (pure) ────────────────────────────────────────────────────────────────────

describe('slots', () => {
  it('are the 5-minute marks + 20 s, strictly after now', () => {
    expect(nextSlot(ms('2030-09-12T00:00:00Z'))).toEqual({
      slotMs: ms('2030-09-12T00:00:00Z'),
      fireAtMs: ms('2030-09-12T00:00:20Z'),
    });
    expect(nextSlot(ms('2030-09-12T00:00:20Z')).slotMs).toBe(ms('2030-09-12T00:05:00Z'));
    expect(nextSlot(ms('2030-09-12T00:03:00Z')).slotMs).toBe(ms('2030-09-12T00:05:00Z'));
  });

  it('are local 5-minute marks across the October change (04/10/2026: 02:00 → 03:00)', () => {
    let t = ms('2026-10-03T15:52:00Z');
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { slotMs, fireAtMs } = nextSlot(t);
      seen.push(local(new Date(slotMs).toISOString()));
      t = fireAtMs;
    }
    expect(seen).toEqual([
      '2026-10-04 01:55',
      '2026-10-04 03:00',
      '2026-10-04 03:05',
      '2026-10-04 03:10',
    ]);
  });

  it('run the repeated hour of 04/04/2027 twice (harmless)', () => {
    // 02:00 AEDT = 15:00Z; 02:00 AEST = 16:00Z on 03/04.
    const first = scopesForSlot(ms('2027-04-03T15:00:00Z'), MELBOURNE, false);
    const second = scopesForSlot(ms('2027-04-03T16:00:00Z'), MELBOURNE, false);
    expect(local('2027-04-03T15:00:00Z')).toBe('2027-04-04 02:00');
    expect(local('2027-04-03T16:00:00Z')).toBe('2027-04-04 02:00');
    expect(first).toEqual(second);
    expect(first.crypto).toBe(true);
  });
});

describe('scopes (by the targeted slot)', () => {
  // Thursday 12/09/2030, AEST (UTC+10).
  const thu = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return Date.UTC(2030, 8, 12, h - 10, m);
  };
  it.each([
    ['09:55', false, false],
    ['10:00', true, true],
    ['10:05', true, false],
    ['16:25', true, false],
    ['16:30', false, true],
  ])('Thursday %s: ASX %s, crypto %s', (hhmm, asx, crypto) => {
    expect(scopesForSlot(thu(hhmm), MELBOURNE, false)).toEqual({ asx, crypto, bullion: false });
  });

  it('no ASX scope on a Saturday; crypto on minute-15 slots any day', () => {
    const saturday = ms('2030-09-14T01:15:00Z'); // 11:15, after the bullion window
    expect(scopesForSlot(saturday, MELBOURNE, true)).toEqual({
      asx: false,
      crypto: true,
      bullion: false,
    });
    expect(scopesForSlot(ms('2030-09-14T01:20:00Z'), MELBOURNE, true).crypto).toBe(false);
  });

  it('bullion: Monday 06:00 to Saturday 10:00, 15-minute slots, only while held', () => {
    const at = (iso: string, held = true) => scopesForSlot(ms(iso), MELBOURNE, held).bullion;
    expect(at('2030-09-15T19:45:00Z')).toBe(false); // Monday 05:45
    expect(at('2030-09-15T20:00:00Z')).toBe(true); // Monday 06:00
    expect(at('2030-09-15T20:05:00Z')).toBe(false); // not a 15-minute slot
    expect(at('2030-09-21T00:00:00Z')).toBe(true); // Saturday 10:00
    expect(at('2030-09-21T00:15:00Z')).toBe(false); // Saturday 10:15
    expect(at('2030-09-22T00:00:00Z')).toBe(false); // Sunday
    expect(at('2030-09-15T20:00:00Z', false)).toBe(false);
    expect(inBullionWindow(wallTimeInZone(ms('2030-09-18T02:00:00Z'), MELBOURNE)!)).toBe(true);
  });

  it('a slot fired 70 s late still runs its scopes; more than a step late is dropped', () => {
    const slot = ms('2030-09-12T14:15:00Z'); // 00:15 Friday: crypto
    expect(isSlotLate(slot, ms('2030-09-12T14:16:10Z'))).toBe(false);
    expect(scopesForSlot(slot, MELBOURNE, false).crypto).toBe(true);
    expect(isSlotLate(slot, ms('2030-09-12T14:20:21Z'))).toBe(true);
  });

  it('the start-up run: crypto, plus ASX inside its window', () => {
    expect(startupScopes(ms('2030-09-12T01:02:00Z'), MELBOURNE)).toEqual({
      asx: true,
      crypto: true,
      bullion: false,
    });
    expect(startupScopes(ms('2030-09-12T08:02:00Z'), MELBOURNE).asx).toBe(false);
  });
});

// ─── The service ────────────────────────────────────────────────────────────────────────────────

/** A clock with a settable now and timers that fire only when the test says so. */
function testClock(startIso: string) {
  let now = ms(startIso);
  let timers: Array<{ id: number; fn: () => void; at: number; ms: number }> = [];
  let nextId = 1;
  const clock: Clock & {
    set(iso: string): void;
    pending(): Array<{ ms: number; at: string }>;
    /** Fires the earliest timer at its time (or `atIso`), moving now there. */
    fireNext(atIso?: string): void;
  } = {
    now: () => new Date(now),
    setTimeout: (fn, delay) => {
      const id = nextId++;
      timers.push({ id, fn, at: now + delay, ms: delay });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
    set(iso) {
      now = ms(iso);
    },
    pending: () => timers.map((t) => ({ ms: t.ms, at: new Date(t.at).toISOString() })),
    fireNext(atIso) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift();
      if (!t) throw new Error('no timer');
      now = atIso ? ms(atIso) : Math.max(now, t.at);
      t.fn();
    },
  };
  return clock;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const open: TestDb[] = [];
const schedulers: Array<ReturnType<typeof createScheduler>> = [];
afterEach(async () => {
  for (const s of schedulers.splice(0)) await s.stop();
  for (const t of open.splice(0)) t.close();
});

interface Harness {
  t: TestDb;
  ids: Record<string, number>;
  clock: ReturnType<typeof testClock>;
  yahoo: ScriptedProvider;
  coin: ScriptedProvider;
  scheduler: ReturnType<typeof createScheduler>;
  market: ReturnType<typeof createService>;
  runs(): Array<typeof jobRuns.$inferSelect>;
}

function setup(o: { start: string; intraday?: boolean }): Harness {
  const t = createTestDb();
  open.push(t);
  const clock = testClock(o.start);
  const { instrumentIds: ids } = seedGenericData(t.db, { now: clock.now() });
  const yahoo = scriptedProvider('yahoo');
  const coin = scriptedProvider('coingecko');
  const answer =
    (price: string, currency = 'AUD') =>
    () => ({
      price,
      currency,
      asOf: clock.now().toISOString(),
    });
  for (const s of ['ABC.AX', 'XYZ.AX', 'DEF.AX']) yahoo.answers.set(s, answer('20'));
  for (const s of ['AUDUSD=X']) yahoo.answers.set(s, answer('0.65', 'USD'));
  for (const s of ['SI=F', 'GC=F']) yahoo.answers.set(s, answer('30', 'USD'));
  coin.answers.set('bitcoin', answer('160000'));
  coin.answers.set('ethereum', answer('5000'));
  const chart = () => ({
    ok: true as const,
    prices: everyMinutes(
      new Date(clock.now().getTime() - 86_400_000 + 300_000).toISOString(),
      clock.now().toISOString(),
    ).map((iso): [number, number] => [ms(iso), 100]),
  });
  coin.chartAnswers.set('bitcoin', chart);
  coin.chartAnswers.set('ethereum', chart);
  const log = silentLogger();
  const scheduler = createScheduler({ db: t.db, log, clock });
  schedulers.push(scheduler);
  const market = createService({
    db: t.db,
    config: { marketDataMode: 'fake', priceRefreshMinutes: 0, intradayRefresh: o.intraday ?? true },
    log,
    scheduler,
    clock,
    timeZone: MELBOURNE,
    providers: { yahoo, coingecko: coin },
    coinChartSpacingMs: 0,
  });
  return {
    t,
    ids,
    clock,
    yahoo,
    coin,
    scheduler,
    market,
    runs: () =>
      t.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.job, 'intraday'))
        .orderBy(desc(jobRuns.id))
        .all(),
  };
}

async function settle(h: Harness): Promise<void> {
  for (let i = 0; i < 50 && h.scheduler.isRunning('intraday'); i += 1) await flush();
  await flush();
}

const detailOf = (h: Harness) => JSON.parse(h.runs()[0]!.detailJson!) as Record<string, unknown>;

describe('targets', () => {
  it('ASX: held, fetched .AX listings (not funds); crypto: held CoinGecko ids', () => {
    const h = setup({ start: '2030-09-12T01:00:00Z', intraday: false });
    const targets = intradayTargets(h.t.db);
    expect(targets.asx.map((x) => x.providerSymbol).sort()).toEqual(['ABC.AX', 'DEF.AX', 'XYZ.AX']);
    expect(targets.crypto.map((x) => x.providerSymbol).sort()).toEqual(['bitcoin', 'ethereum']);
    expect(heldBullionMetals(h.t.db)).toEqual(['silver']);
    expect(bullionSeriesFor(['silver'])).toEqual(['AUDUSD', 'SI_USD_OZ']);
    h.t.db
      .update(otherAssets)
      .set({ soldUnits: '10' })
      .where(eq(otherAssets.priceSource, 'bullion'))
      .run();
    expect(heldBullionMetals(h.t.db)).toEqual([]);
  });
});

describe('the intraday timer', () => {
  it('a start-up run after 30 s (crypto, plus ASX in its window), then the slots', async () => {
    // Thursday 12/09/2030 11:02 Melbourne.
    const h = setup({ start: '2030-09-12T01:02:00Z' });
    expect(
      h.clock
        .pending()
        .map((p) => p.ms)
        .sort((a, b) => a - b),
    ).toEqual([INTRADAY_STARTUP_DELAY_MS, 3 * 60_000 + 20_000]);
    h.clock.fireNext(); // the start-up run at 11:02:30
    await settle(h);
    expect(h.runs()).toHaveLength(1);
    expect(h.runs()[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    const detail = detailOf(h);
    expect(detail.asx).toEqual({ requested: 3, ok: 3, failed: 0, skipped: 0 });
    expect(detail.crypto).toEqual({ requested: 2, ok: 2, failed: 0, skipped: 0 });
    expect(detail.bullion).toBeNull();
    expect(detail.charts).toEqual({ ok: 2, failed: 0, skipped: 0 });
    expect(h.coin.charts).toEqual(['bitcoin', 'ethereum']);
    // Crypto's day rows (D142: since 00:00 Melbourne, midnight-based).
    const btc = h.t.db
      .select()
      .from(dayQuotes)
      .where(eq(dayQuotes.instrumentId, h.ids.BTC!))
      .get()!;
    expect(btc).toMatchObject({
      sessionDate: '2030-09-12',
      timeZone: MELBOURNE,
      source: 'coingecko',
    });
    expect((JSON.parse(btc.points) as Array<[number, string]>)[0]).toEqual([
      sec('2030-09-11T14:00:00Z'),
      '100',
    ]);
    // The 11:05 slot: ASX only (minute 5).
    h.clock.fireNext();
    await settle(h);
    expect(h.runs()).toHaveLength(2);
    expect(detailOf(h)).toMatchObject({ crypto: null, bullion: null });
    expect(detailOf(h).asx).toMatchObject({ requested: 3 });
  });

  it('the bullion scope on a 15-minute slot in its window while a row is held', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z' });
    h.clock.fireNext(); // the start-up run at 11:12:30 (no bullion)
    await settle(h);
    expect(detailOf(h).bullion).toBeNull();
    h.clock.fireNext(); // the 11:15 slot
    await settle(h);
    const detail = detailOf(h);
    expect(detail.bullion).toEqual({ requested: 3, ok: 3, failed: 0, skipped: 0 });
    expect(h.yahoo.requests.map((r) => r.symbol)).toContain('SI=F');
    expect(h.yahoo.requests.map((r) => r.symbol)).not.toContain('GC=F');
  });

  it('runs a slot fired 70 s late with its own scopes; drops one more than a step late', async () => {
    const g = setup({ start: '2030-09-12T14:13:00Z' }); // Friday 00:13, outside ASX hours
    const pending = g.clock
      .pending()
      .map((p) => p.at)
      .sort();
    expect(pending).toContain('2030-09-12T14:15:20.000Z');
    // Fire the 00:15 slot at 00:16:10 (70 s late) — the start-up timer (00:13:30) goes first.
    g.clock.fireNext();
    await settle(g);
    const before = g.runs().length;
    g.clock.fireNext('2030-09-12T14:16:10.000Z');
    await settle(g);
    expect(g.runs()).toHaveLength(before + 1);
    expect(detailOf(g).crypto).toMatchObject({ requested: 2 });
    // The next slot (00:20) fired at 00:25:30 is dropped: no run.
    const count = g.runs().length;
    g.clock.fireNext('2030-09-12T14:25:30.000Z');
    await settle(g);
    expect(g.runs()).toHaveLength(count);
    expect(g.clock.pending().length).toBeGreaterThan(0); // the next slot is armed
  });

  it('skips the ASX and bullion scopes while `prices` runs (both use Yahoo)', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    let release!: () => void;
    h.yahoo.gate = new Promise<void>((r) => {
      release = r;
    });
    const pricesRun = h.market.refresh();
    await flush();
    expect(h.scheduler.isRunning('prices')).toBe(true);
    h.yahoo.gate = null;
    await h.scheduler.run('intraday');
    const detail = detailOf(h);
    expect(detail.asx).toEqual({ requested: 3, ok: 0, failed: 0, skipped: 3 });
    expect(detail.bullion).toEqual({ requested: 2, ok: 0, failed: 0, skipped: 2 });
    expect(detail.crypto).toMatchObject({ ok: 2 });
    release();
    await pricesRun;
  });

  it('`prices` waits for an in-flight intraday run before it selects its targets', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    let release!: () => void;
    h.yahoo.gate = new Promise<void>((r) => {
      release = r;
    });
    const intraday = h.scheduler.run('intraday');
    await flush();
    const seenBefore = h.yahoo.requests.length;
    const pricesRun = h.market.refresh();
    for (let i = 0; i < 10; i += 1) await flush();
    // Nothing from `prices` yet: only the intraday run's ASX requests were made.
    expect(h.yahoo.requests.length).toBe(seenBefore);
    h.yahoo.gate = null;
    release();
    await intraday;
    const summary = await pricesRun;
    expect(summary.requested).toBeGreaterThan(0);
    expect(h.yahoo.requests.length).toBeGreaterThan(seenBefore);
  });

  it('a CoinGecko 429 on a chart starts the cool-down and skips the rest', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    h.coin.chartAnswers.set('bitcoin', () => ({
      ok: false,
      error: 'Rate limited',
      rateLimited: true,
    }));
    await h.scheduler.run('intraday');
    expect(detailOf(h).charts).toEqual({ ok: 0, failed: 0, skipped: 2 });
    expect(h.coin.charts).toEqual(['bitcoin']);
    expect(
      h.t.db.select().from(dayQuotes).where(eq(dayQuotes.instrumentId, h.ids.BTC!)).get(),
    ).toBeUndefined();
  });

  it('a lite failure leaves the stored price and its backoff untouched', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    const before = h.t.db
      .select()
      .from(prices)
      .where(eq(prices.instrumentId, h.ids['ASX:ABC']!))
      .get();
    h.yahoo.answers.set('ABC.AX', () => ({ error: 'HTTP 500', retryable: true }));
    await h.scheduler.run('intraday');
    expect(detailOf(h).asx).toMatchObject({ failed: 1 });
    expect(h.runs()[0]!.status).toBe('partial');
    expect(
      h.t.db.select().from(prices).where(eq(prices.instrumentId, h.ids['ASX:ABC']!)).get(),
    ).toEqual(before);
  });

  it('stop() clears the timers; INTRADAY_REFRESH off arms none (a manual run still works)', async () => {
    const h = setup({ start: '2030-09-12T01:02:00Z' });
    expect(h.clock.pending()).toHaveLength(2);
    h.market.stop();
    h.market.stop(); // idempotent
    expect(h.clock.pending()).toEqual([]);
    const off = setup({ start: '2030-09-12T01:02:00Z', intraday: false });
    expect(off.clock.pending()).toEqual([]);
    const { result } = await off.scheduler.run('intraday');
    expect(result.status).toBe('succeeded');
  });

  it('a slot that finds a run in flight is skipped', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z' });
    let release!: () => void;
    h.yahoo.gate = new Promise<void>((r) => {
      release = r;
    });
    h.clock.fireNext(); // the start-up run (11:12:30), held in flight by the gate
    await flush();
    expect(h.scheduler.isRunning('intraday')).toBe(true);
    h.clock.fireNext(); // the 11:15 slot finds it in flight
    await flush();
    h.yahoo.gate = null;
    release();
    await settle(h);
    expect(h.runs()).toHaveLength(1);
    expect(h.clock.pending().some((p) => p.at === '2030-09-12T01:20:20.000Z')).toBe(true);
  });

  it('a slot with nothing due starts no run', async () => {
    const h = setup({ start: '2030-09-12T08:02:00Z' }); // 18:02: no ASX
    // Nothing held in crypto → the minute-15 slot has nothing to do.
    h.t.db.delete(jobRuns).run();
    h.t.db.update(otherAssets).set({ soldUnits: '10' }).run();
    const { trades } = await import('@joinr/schema/db');
    h.t.db.delete(trades).where(eq(trades.instrumentId, h.ids.BTC!)).run();
    h.t.db.delete(trades).where(eq(trades.instrumentId, h.ids.ETH!)).run();
    h.clock.fireNext(); // start-up: crypto only, nothing held
    await settle(h);
    expect(h.runs()).toEqual([]);
  });
});

// ─── A source change (Fixer SPEC-1): the old source's as-of and day row go ─────────────────────

describe('setPriceSource: a real change resets the as-of and the day row', () => {
  const abcDay = (h: Harness) =>
    h.t.db.select().from(dayQuotes).where(eq(dayQuotes.instrumentId, h.ids['ASX:ABC']!)).get();
  const abcPrice = (h: Harness) =>
    h.t.db.select().from(prices).where(eq(prices.instrumentId, h.ids['ASX:ABC']!)).get();
  const session = (prev: string, points: Array<[string, string]>) => ({
    sessionDate: '2030-09-12',
    timeZone: 'Australia/Sydney',
    granularity: '5m' as const,
    nativeCurrency: 'AUD',
    previousClose: prev,
    regularStart: '2030-09-12T00:00:00.000Z',
    regularEnd: '2030-09-12T06:10:00.000Z',
    points: points.map(([iso, p]): [number, string] => [sec(iso), p]),
  });

  it('a later stored as-of, a new symbol, an older fetch: the new price and only its points', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '20',
      currency: 'AUD',
      asOf: '2030-09-12T01:10:00.000Z',
      day: session('19', [
        ['2030-09-12T00:00:00Z', '19.5'],
        ['2030-09-12T01:10:00Z', '20'],
      ]),
    }));
    await h.market.refresh();
    expect(abcPrice(h)).toMatchObject({ price: '20', asOf: '2030-09-12T01:10:00.000Z' });
    h.market.setPriceSource(h.ids['ASX:ABC']!, { provider: 'yahoo', providerSymbol: 'ABD.AX' });
    // The price is kept, its as-of cleared (stale until the next fetch); the day row is gone.
    expect(abcPrice(h)).toMatchObject({ price: '20', asOf: null });
    expect(abcDay(h)).toBeUndefined();
    expect(
      h.market.getPrices().items.find((i) => i.instrumentId === h.ids['ASX:ABC']),
    ).toMatchObject({ status: 'stale' });
    // The new listing answers with an as-of older than the old one's.
    h.yahoo.answers.set('ABD.AX', () => ({
      price: '3',
      currency: 'AUD',
      asOf: '2030-09-12T01:05:00.000Z',
      day: session('2.9', [
        ['2030-09-12T00:05:00Z', '2.95'],
        ['2030-09-12T01:05:00Z', '3'],
      ]),
    }));
    await h.market.refresh();
    expect(abcPrice(h)).toMatchObject({ price: '3', asOf: '2030-09-12T01:05:00.000Z' });
    expect(abcDay(h)).toMatchObject({
      previousClose: '2.9',
      points: JSON.stringify([
        [sec('2030-09-12T00:05:00Z'), '2.95'],
        [sec('2030-09-12T01:05:00Z'), '3'],
      ]),
    });
  });

  it('a same-day crypto id change takes the new coin’s 00:00 base', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    await h.scheduler.run('intraday');
    const btcDay = () =>
      h.t.db.select().from(dayQuotes).where(eq(dayQuotes.instrumentId, h.ids.BTC!)).get()!;
    expect(btcDay().previousClose).toBe('100');
    h.coin.answers.set('bitcoin-two', () => ({
      price: '200',
      currency: 'AUD',
      asOf: h.clock.now().toISOString(),
    }));
    h.coin.chartAnswers.set('bitcoin-two', () => ({
      ok: true as const,
      prices: everyMinutes(
        new Date(h.clock.now().getTime() - 86_400_000 + 300_000).toISOString(),
        h.clock.now().toISOString(),
      ).map((iso): [number, number] => [ms(iso), 200]),
    }));
    h.market.setPriceSource(h.ids.BTC!, { provider: 'coingecko', providerSymbol: 'bitcoin-two' });
    h.clock.set('2030-09-12T01:15:00Z');
    await h.scheduler.run('intraday');
    const row = btcDay();
    expect(row.previousClose).toBe('200');
    const points = JSON.parse(row.points) as Array<[number, string]>;
    expect(points[0]).toEqual([sec('2030-09-11T14:00:00Z'), '200']);
    expect(points.every(([, p]) => p === '200')).toBe(true);
  });

  it('the same pair again is a no-op: the as-of and the day row stay', async () => {
    const h = setup({ start: '2030-09-12T01:12:00Z', intraday: false });
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '20',
      currency: 'AUD',
      asOf: '2030-09-12T01:10:00.000Z',
      day: session('19', [['2030-09-12T01:10:00Z', '20']]),
    }));
    await h.market.refresh();
    const before = abcDay(h);
    expect(before).toBeDefined();
    h.market.setPriceSource(h.ids['ASX:ABC']!, { provider: 'yahoo', providerSymbol: 'ABC.AX' });
    expect(abcPrice(h)).toMatchObject({ price: '20', asOf: '2030-09-12T01:10:00.000Z' });
    expect(abcDay(h)).toEqual(before);
  });
});
