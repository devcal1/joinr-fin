// Stage 10 `closes` job (stage-10.md §5.1, §5.5–§5.7, §5.10): a fake-mode run end to end (the
// seeded listings, coins, AUDUSD, the futures and the derived spot; no row dated today or on a
// weekend) and its restart as a top-up; backfill, top-up and skip; splits; the identity and source
// checks (a `setPriceSource` during the fetch); the 16:52 timer across both DST changes, the start-up
// run, follow-ups snapped to xx:07/22/37/52 (at most 6 a day); the pauses for `prices`, `intraday`
// (one that starts mid-run) and the coin-slot guard; `prices` awaiting an in-flight run without a
// deadlock; the deadline; CLOSES_REFRESH off; `stop()`. Manual timers, scripted providers, an
// in-memory database; the generic seed and made-up values.
process.env.TZ = 'Australia/Melbourne';

import {
  CLOSES_COIN_SLOT_GUARD_MS,
  CLOSES_RUN_AT,
  CLOSES_STARTUP_DELAY_MS,
  dateInZone,
  wallTimeInZone,
} from '@joinr/schema';
import {
  instrumentCloses,
  instruments,
  instrumentSplits,
  jobRuns,
  seriesCloses,
  seriesDayQuotes,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { and, asc, desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { addDaysIso } from '../../src/lib/dates';
import {
  followUpAtMs,
  nextCryptoSlotFireMs,
  nextDailyRunMs,
} from '../../src/market/closes/schedule';
import { isWeekday, weekdayOfIso } from '../../src/market/day';
import { createService } from '../../src/market/service';
import { createScheduler } from '../../src/scheduler/index';
import type { Clock } from '../../src/scheduler/types';
import {
  history,
  scriptedCoinHistory,
  scriptedYahooHistory,
  weekdayCloses,
  type ScriptedCoinHistory,
  type ScriptedYahooHistory,
} from './closesHelpers';
import { everyMinutes, scriptedProvider, type ScriptedProvider } from './dayHelpers';
import { silentLogger } from './helpers';

const MELBOURNE = 'Australia/Melbourne';
const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();
const local = (t: number) => {
  const w = wallTimeInZone(t, MELBOURNE)!;
  return `${w.date} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
};

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2030, 9, 7).toISOString()).toBe('2030-10-06T13:00:00.000Z');
});

// ─── The timer instants (pure) ──────────────────────────────────────────────────────────────────

describe('schedule', () => {
  it('16:52 server-local, across the October (06/10/2030) and April (06/04/2031) changes', () => {
    expect(local(nextDailyRunMs(ms('2030-10-05T02:00:00Z'), MELBOURNE)!)).toBe('2030-10-05 16:52');
    const oct6 = nextDailyRunMs(ms('2030-10-05T07:00:00Z'), MELBOURNE)!;
    expect(iso(oct6)).toBe('2030-10-06T05:52:00.000Z'); // AEDT
    expect(local(oct6)).toBe('2030-10-06 16:52');
    const apr6 = nextDailyRunMs(ms('2031-04-05T06:00:00Z'), MELBOURNE)!;
    expect(iso(apr6)).toBe('2031-04-06T06:52:00.000Z'); // AEST again (the 25-hour day)
    expect(local(apr6)).toBe('2031-04-06 16:52');
    // Exactly at 16:52 → tomorrow's.
    expect(local(nextDailyRunMs(ms('2030-10-06T05:52:00Z'), MELBOURNE)!)).toBe('2030-10-07 16:52');
  });

  it('follow-ups: at least 30 minutes later, snapped to xx:07, xx:22, xx:37 or xx:52', () => {
    expect(local(followUpAtMs(ms('2030-09-12T06:52:00Z'), MELBOURNE))).toBe('2030-09-12 17:22');
    expect(local(followUpAtMs(ms('2030-09-12T06:53:10Z'), MELBOURNE))).toBe('2030-09-12 17:37');
    expect(local(followUpAtMs(ms('2030-09-12T07:30:00Z'), MELBOURNE))).toBe('2030-09-12 18:07');
    expect(
      [7, 22, 37, 52].includes(
        wallTimeInZone(followUpAtMs(ms('2030-10-05T15:40:00Z'), MELBOURNE), MELBOURNE)!.minute,
      ),
    ).toBe(true);
  });

  it('a run at 16:52 is far from the intraday crypto slots (16:45:20 and 17:00:20)', () => {
    expect(CLOSES_RUN_AT.minute % 15).not.toBe(0);
    const at = ms('2030-09-12T06:52:00Z');
    const next = nextCryptoSlotFireMs(at, MELBOURNE);
    expect(local(next)).toBe('2030-09-12 17:00');
    expect(next - at).toBeGreaterThan(CLOSES_COIN_SLOT_GUARD_MS);
    expect(iso(nextCryptoSlotFireMs(ms('2030-09-12T06:59:40Z'), MELBOURNE))).toBe(
      '2030-09-12T07:00:20.000Z',
    );
  });
});

// ─── The service harness ────────────────────────────────────────────────────────────────────────

function testClock(startIso: string) {
  let now = ms(startIso);
  let timers: Array<{ id: number; fn: () => void; at: number; ms: number }> = [];
  let nextId = 1;
  const clock: Clock & {
    set(isoText: string): void;
    pending(): Array<{ ms: number; at: string }>;
    fireNext(): void;
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
    set(isoText) {
      now = ms(isoText);
    },
    pending: () =>
      timers
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((t) => ({ ms: t.ms, at: iso(t.at) })),
    fireNext() {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers.shift();
      if (!t) throw new Error('no timer');
      now = Math.max(now, t.at);
      t.fn();
    },
  };
  return clock;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushMany = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await flush();
};

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
  histY: ScriptedYahooHistory;
  histC: ScriptedCoinHistory;
  scheduler: ReturnType<typeof createScheduler>;
  market: ReturnType<typeof createService>;
  runs(): Array<typeof jobRuns.$inferSelect>;
  detail(): Record<string, unknown>;
  rows(instrument: string): Array<{ date: string; close: string; source: string }>;
  series(id: string): Array<{ date: string; value: string; source: string }>;
}

interface SetupOptions {
  start: string;
  closes?: boolean;
  intraday?: boolean;
  /** Use the mode's own (fake) history clients instead of the scripted ones. */
  fakeClients?: boolean;
  coinSpacingMs?: number;
  deadlineMs?: number;
  /** Reuse a database (a restart). */
  db?: TestDb;
}

function setup(o: SetupOptions): Harness {
  const t = o.db ?? createTestDb();
  if (!o.db) open.push(t);
  const clock = testClock(o.start);
  const ids: Record<string, number> = o.db
    ? Object.fromEntries(
        t.db
          .select({ symbol: instruments.symbol, id: instruments.id })
          .from(instruments)
          .all()
          .map((r) => [r.symbol, r.id]),
      )
    : seedGenericData(t.db, { now: clock.now() }).instrumentIds;
  const yahoo = scriptedProvider('yahoo');
  const coin = scriptedProvider('coingecko');
  const answer =
    (price: string, currency = 'AUD') =>
    () => ({ price, currency, asOf: clock.now().toISOString() });
  for (const s of ['ABC.AX', 'XYZ.AX', 'DEF.AX']) yahoo.answers.set(s, answer('20'));
  yahoo.answers.set('AUDUSD=X', answer('0.65', 'USD'));
  for (const s of ['SI=F', 'GC=F']) yahoo.answers.set(s, answer('30', 'USD'));
  coin.answers.set('bitcoin', answer('160000'));
  coin.answers.set('ethereum', answer('5000'));
  const chart = () => ({
    ok: true as const,
    prices: everyMinutes(
      iso(clock.now().getTime() - 86_400_000 + 300_000),
      clock.now().toISOString(),
    ).map((x): [number, number] => [ms(x), 100]),
  });
  coin.chartAnswers.set('bitcoin', chart);
  coin.chartAnswers.set('ethereum', chart);
  const yesterday = () => addDaysIso(dateInZone(clock.now().getTime(), MELBOURNE)!, -1);
  const histY = scriptedYahooHistory(
    () => clock.now(),
    (req) => weekdayCloses(req.from, yesterday()),
  );
  const histC = scriptedCoinHistory(
    () => clock.now(),
    (_id, days, daily) => {
      const now = clock.now().getTime();
      const step = daily ? 86_400_000 : 3_600_000;
      const out: Array<[number, number]> = [];
      const first = Math.ceil((now - days * 86_400_000) / step) * step;
      for (let x = first; x < now; x += step) out.push([x, 100]);
      out.push([now, 100]);
      return out;
    },
  );
  const log = silentLogger();
  const scheduler = createScheduler({ db: t.db, log, clock });
  schedulers.push(scheduler);
  const market = createService({
    db: t.db,
    config: {
      marketDataMode: 'fake',
      priceRefreshMinutes: 0,
      intradayRefresh: o.intraday ?? false,
      closesRefresh: o.closes ?? false,
    },
    log,
    scheduler,
    clock,
    timeZone: MELBOURNE,
    providers: { yahoo, coingecko: coin },
    coinChartSpacingMs: 0,
    intradayStartupDelayMs: 10 * 3_600_000,
    ...(o.fakeClients ? {} : { closesClients: { yahoo: histY, coins: histC } }),
    closesCoinSpacingMs: o.coinSpacingMs ?? 0,
    closesDeadlineMs: o.deadlineMs,
  });
  const byId = (symbol: string): number => {
    const known = ids[symbol];
    if (known !== undefined) return known;
    throw new Error(`no instrument ${symbol}`);
  };
  return {
    t,
    ids,
    clock,
    yahoo,
    coin,
    histY,
    histC,
    scheduler,
    market,
    runs: () =>
      t.db.select().from(jobRuns).where(eq(jobRuns.job, 'closes')).orderBy(desc(jobRuns.id)).all(),
    detail() {
      return JSON.parse(this.runs()[0]!.detailJson!) as Record<string, unknown>;
    },
    rows: (symbol) =>
      t.db
        .select({
          date: instrumentCloses.date,
          close: instrumentCloses.close,
          source: instrumentCloses.source,
        })
        .from(instrumentCloses)
        .where(eq(instrumentCloses.instrumentId, byId(symbol)))
        .orderBy(asc(instrumentCloses.date))
        .all(),
    series: (id) =>
      t.db
        .select({ date: seriesCloses.date, value: seriesCloses.value, source: seriesCloses.source })
        .from(seriesCloses)
        .where(eq(seriesCloses.seriesId, id))
        .orderBy(asc(seriesCloses.date))
        .all(),
  };
}

async function settle(h: Harness, job: 'closes' | 'prices' | 'intraday' = 'closes'): Promise<void> {
  for (let i = 0; i < 200 && h.scheduler.isRunning(job); i += 1) await flush();
  await flush();
}

// Thursday 12/09/2030 16:52 Melbourne (AEST).
const THU_1652 = '2030-09-12T06:52:00Z';

// ─── A fake-mode run end to end ─────────────────────────────────────────────────────────────────

describe('a fake-mode run (MARKET_DATA_MODE=fake)', () => {
  it('backfills the seeded listings, coins, AUDUSD, the futures and the derived spot; a restart tops up', async () => {
    const h = setup({ start: THU_1652, fakeClients: true });
    const { result } = await h.scheduler.run('closes');
    expect(result.status).toBe('succeeded');
    const detail = h.detail();
    expect(detail).toMatchObject({
      yahoo: { ok: 5, failed: 0, skipped: 0 },
      coingecko: { ok: 2, failed: 0, skipped: 0, beyondReach: 0 },
      backfills: 7,
      topUps: 0,
      splits: 0,
      midnight: 0,
      left: 0,
    });
    expect(detail.derived).toBeGreaterThan(100);
    for (const symbol of ['ASX:ABC', 'ASX:XYZ', 'ASX:DEF', 'BTC', 'ETH']) {
      expect(h.rows(symbol).length, symbol).toBeGreaterThan(200);
    }
    expect(h.rows('ASX:OLD')).toEqual([]);
    expect(h.rows('EXAMPLEFUND')).toEqual([]);
    // No Yahoo row dated today or on a weekend; the source is the fake's.
    for (const rows of [h.rows('ASX:ABC'), h.series('AUDUSD'), h.series('SI_USD_OZ')]) {
      expect(rows.every((r) => r.date < '2030-09-12' && isWeekday(weekdayOfIso(r.date)))).toBe(
        true,
      );
      expect(rows.every((r) => r.source === 'fake')).toBe(true);
    }
    expect(h.series('AUDUSD').at(-1)).toMatchObject({ date: '2030-09-11', value: '0.65' });
    expect(h.series('XAG_AUD_OZ').at(-1)).toMatchObject({ date: '2030-09-11', source: 'derived' });
    expect(h.series('XAU_AUD_OZ')).toEqual([]);
    // A coin's close of yesterday is the price at 00:00 today (the hourly answer wins).
    expect(h.rows('BTC').at(-1)!.date).toBe('2030-09-11');
    expect(h.rows('BTC')[0]!.date <= '2029-09-13').toBe(true);

    // The same process again: top-ups only.
    await h.scheduler.run('closes');
    expect(h.detail()).toMatchObject({ backfills: 0, topUps: 7 });

    // A restart (a new service on the same database): its run is a top-up too (§12 #8).
    const again = setup({ start: '2030-09-12T07:00:00Z', fakeClients: true, db: h.t });
    await again.scheduler.run('closes');
    expect(JSON.parse(again.runs()[0]!.detailJson!)).toMatchObject({ backfills: 0, topUps: 7 });
  });
});

// ─── Backfill, top-up, skip; splits; the checks ─────────────────────────────────────────────────

describe('backfill, top-up and skip through runs', () => {
  it('a top-up re-reads the last 10 days; a coin top-up asks for the gap + 3 days (hourly)', async () => {
    const h = setup({ start: THU_1652 });
    await h.scheduler.run('closes');
    expect(h.histY.requests.map((r) => [r.symbol, r.from])).toEqual([
      ['AUDUSD=X', '2024-01-12'],
      ['SI=F', '2024-01-12'],
      ['ABC.AX', '2025-01-05'],
      ['XYZ.AX', '2024-06-21'],
      ['DEF.AX', '2025-05-10'],
    ]);
    expect(h.histC.calls.map((c) => [c.id, c.days, c.daily])).toEqual([
      ['bitcoin', 365, true],
      ['bitcoin', 90, false],
      ['ethereum', 365, true],
      ['ethereum', 90, false],
    ]);
    h.clock.set('2030-09-13T06:52:00Z');
    h.histY.requests.length = 0;
    h.histC.calls.length = 0;
    await h.scheduler.run('closes');
    expect(h.histY.requests.map((r) => r.from)).toEqual(Array(5).fill('2030-09-01'));
    expect(h.histC.calls.map((c) => [c.id, c.days, c.daily])).toEqual([
      ['bitcoin', 5, false],
      ['ethereum', 5, false],
    ]);
    expect(h.detail()).toMatchObject({ backfills: 0, topUps: 7 });
  });

  it('a feed starting after the first trade: one backfill, then top-ups for the process', async () => {
    const h = setup({ start: THU_1652 });
    h.histY.answers.set('ABC.AX', () => ({
      ok: true,
      history: history(weekdayCloses('2026-01-05', '2030-09-11'), { firstTradeDate: '2026-01-05' }),
    }));
    await h.scheduler.run('closes');
    expect(h.rows('ASX:ABC')[0]!.date).toBe('2026-01-05');
    h.clock.set('2030-09-13T06:52:00Z');
    h.histY.requests.length = 0;
    await h.scheduler.run('closes');
    expect(h.histY.requests.find((r) => r.symbol === 'ABC.AX')!.from).toBe('2030-09-01');
    expect(h.detail()).toMatchObject({ backfills: 0 });
  });

  it('no rows and tried today → skip (no request); the next day it is tried again', async () => {
    const h = setup({ start: THU_1652 });
    h.histY.answers.set('DEF.AX', () => ({ ok: true, history: history([]) }));
    await h.scheduler.run('closes');
    h.histY.requests.length = 0;
    await h.scheduler.run('closes');
    expect(h.histY.requests.map((r) => r.symbol)).not.toContain('DEF.AX');
    expect(h.detail()).toMatchObject({ yahoo: { ok: 4, failed: 0, skipped: 1 } });
    expect(h.runs()[0]!.status).toBe('succeeded');
    h.clock.set('2030-09-13T06:52:00Z');
    await h.scheduler.run('closes');
    expect(h.histY.requests.filter((r) => r.symbol === 'DEF.AX')).toHaveLength(1);
  });

  it('a failed request is a failure (partial run); the closes of the others are kept', async () => {
    const h = setup({ start: THU_1652 });
    h.histY.answers.set('XYZ.AX', () => ({ ok: false, kind: 'failed', error: 'HTTP 500' }));
    await h.scheduler.run('closes');
    expect(h.runs()[0]!.status).toBe('partial');
    expect(h.detail()).toMatchObject({ yahoo: { ok: 4, failed: 1, skipped: 0 }, left: 0 });
    expect(h.rows('ASX:XYZ')).toEqual([]);
    expect(h.rows('ASX:ABC').length).toBeGreaterThan(0);
  });

  it('stores split events and the answer’s currency', async () => {
    const h = setup({ start: THU_1652 });
    h.histY.answers.set('XYZ.AX', () => ({
      ok: true,
      history: history(weekdayCloses('2030-09-02', '2030-09-11'), {
        splits: [{ date: '2030-09-10', numerator: '2', denominator: '1' }],
        currency: 'AUD',
      }),
    }));
    await h.scheduler.run('closes');
    expect(h.detail()).toMatchObject({ splits: 1 });
    expect(
      h.t.db
        .select({
          date: instrumentSplits.date,
          n: instrumentSplits.numerator,
          d: instrumentSplits.denominator,
        })
        .from(instrumentSplits)
        .where(eq(instrumentSplits.instrumentId, h.ids['ASX:XYZ']!))
        .all(),
    ).toEqual([{ date: '2030-09-10', n: '2', d: '1' }]);
    expect(
      h.t.db
        .select({ c: instrumentCloses.currency })
        .from(instrumentCloses)
        .where(eq(instrumentCloses.instrumentId, h.ids['ASX:XYZ']!))
        .get(),
    ).toEqual({ c: 'AUD' });
  });

  it('a CoinGecko 429 starts the cool-down (Retry-After) and leaves the coins for a follow-up', async () => {
    const h = setup({ start: THU_1652 });
    h.histC.answers.set('bitcoin', () => ({
      ok: false,
      kind: 'rate_limited',
      error: 'Rate limited',
      retryAfterMs: 60_000,
    }));
    await h.scheduler.run('closes');
    expect(h.histC.calls.map((c) => c.id)).toEqual(['bitcoin']);
    expect(h.detail()).toMatchObject({
      coingecko: { ok: 0, failed: 0, skipped: 2, beyondReach: 0 },
      left: 2,
    });
    expect(h.runs()[0]!.status).toBe('succeeded');
    // The intraday job's crypto shares the cool-down.
    expect(h.market.getPrices()).toBeDefined();
  });
});

describe('the identity and source checks (§5.6)', () => {
  it('a setPriceSource during the fetch: no closes for that instrument afterwards', async () => {
    const h = setup({ start: THU_1652 });
    let release!: () => void;
    h.histY.gates.set('ABC.AX', new Promise<void>((r) => (release = r)));
    const run = h.scheduler.run('closes');
    await flushMany();
    expect(h.histY.requests.at(-1)!.symbol).toBe('ABC.AX');
    h.market.setPriceSource(h.ids['ASX:ABC']!, { provider: 'yahoo', providerSymbol: 'ABD.AX' });
    release();
    await run;
    expect(h.rows('ASX:ABC')).toEqual([]);
    expect(h.detail()).toMatchObject({ yahoo: { ok: 4, skipped: 1 } });
    // The next run backfills the new symbol.
    h.histY.requests.length = 0;
    await h.scheduler.run('closes');
    expect(h.histY.requests.find((r) => r.symbol === 'ABD.AX')!.from).toBe('2025-01-05');
    expect(h.rows('ASX:ABC').length).toBeGreaterThan(0);
  });

  it('a real source change deletes the closes and splits; the same pair again keeps them', () => {
    const h = setup({ start: THU_1652 });
    const id = h.ids['ASX:ABC']!;
    const at = '2030-09-12T06:52:00.000Z';
    h.t.db
      .insert(instrumentCloses)
      .values({
        instrumentId: id,
        date: '2030-09-11',
        close: '20',
        currency: 'AUD',
        source: 'yahoo',
        fetchedAt: at,
      })
      .run();
    h.t.db
      .insert(instrumentSplits)
      .values({
        instrumentId: id,
        date: '2030-09-10',
        numerator: '2',
        denominator: '1',
        fetchedAt: at,
      })
      .run();
    h.market.setPriceSource(id, { provider: 'yahoo', providerSymbol: 'ABC.AX' });
    expect(h.rows('ASX:ABC')).toHaveLength(1);
    h.market.setPriceSource(id, { provider: 'yahoo', providerSymbol: 'ABD.AX' });
    expect(h.rows('ASX:ABC')).toEqual([]);
    expect(
      h.t.db.select().from(instrumentSplits).where(eq(instrumentSplits.instrumentId, id)).all(),
    ).toEqual([]);
  });
});

describe('the derived spot and the midnight capture in a run', () => {
  it('derives XAG_AUD_OZ on weekdays and captures the 00:00 base as yesterday’s close', async () => {
    const h = setup({ start: THU_1652 });
    h.histY.answers.set('SI=F', (req) => ({
      ok: true,
      history: history(weekdayCloses(req.from, '2030-09-11', '32.5'), { currency: 'USD' }),
    }));
    h.histY.answers.set('AUDUSD=X', (req) => ({
      ok: true,
      history: history(weekdayCloses(req.from, '2030-09-11', '0.65'), { currency: 'USD' }),
    }));
    h.t.db
      .insert(seriesDayQuotes)
      .values({
        seriesId: 'XAG_AUD_OZ',
        sessionDate: '2030-09-12',
        timeZone: MELBOURNE,
        granularity: '5m',
        nativeCurrency: 'AUD',
        previousClose: '50.25',
        points: '[]',
        source: 'yahoo',
        fetchedAt: '2030-09-12T06:00:00.000Z',
      })
      .run();
    await h.scheduler.run('closes');
    expect(h.detail()).toMatchObject({ midnight: 1 });
    const rows = h.series('XAG_AUD_OZ');
    expect(rows[0]).toEqual({ date: '2024-01-22', value: '50', source: 'derived' });
    expect(rows.at(-2)).toEqual({ date: '2030-09-10', value: '50', source: 'derived' });
    expect(rows.at(-1)).toEqual({ date: '2030-09-11', value: '50.25', source: 'midnight' });
    expect(rows.every((r) => isWeekday(weekdayOfIso(r.date)))).toBe(true);
    // The next run keeps the midnight row.
    await h.scheduler.run('closes');
    expect(h.series('XAG_AUD_OZ').at(-1)).toEqual({
      date: '2030-09-11',
      value: '50.25',
      source: 'midnight',
    });
    expect(h.detail()).toMatchObject({ derived: 0, midnight: 0 });
  });
});

// ─── Timers ─────────────────────────────────────────────────────────────────────────────────────

describe('the closes timers', () => {
  it('CLOSES_REFRESH off: registered (a manual run works), no timer armed', async () => {
    const h = setup({ start: THU_1652 });
    expect(h.clock.pending()).toEqual([]);
    const { result } = await h.scheduler.run('closes');
    expect(result.status).toBe('succeeded');
    expect(h.clock.pending()).toEqual([]);
  });

  it('on: a start-up run after 120 s and the daily 16:52; stop() clears them', () => {
    const h = setup({ start: '2030-09-12T02:00:00Z', closes: true }); // 12:00
    expect(h.clock.pending().map((p) => p.ms)).toEqual([CLOSES_STARTUP_DELAY_MS, 3_600_000]);
    h.market.stop();
    h.market.stop();
    expect(h.clock.pending()).toEqual([]);
  });

  async function runsUntil(h: Harness, count: number): Promise<string[]> {
    for (let i = 0; i < 100 && h.runs().length < count; i += 1) {
      h.clock.fireNext();
      await settle(h);
    }
    return h
      .runs()
      .map((r) => local(ms(r.startedAt)))
      .reverse();
  }

  it('fires at 16:52 across the October change (05/10 → 06/10/2030)', async () => {
    const h = setup({ start: '2030-10-05T02:00:00Z', closes: true }); // Saturday 12:00 AEST
    expect(await runsUntil(h, 4)).toEqual([
      '2030-10-05 12:02', // the start-up run
      '2030-10-05 16:52',
      '2030-10-06 16:52', // AEDT
      '2030-10-07 16:52',
    ]);
    expect(h.runs().map((r) => r.trigger)).toEqual(Array(4).fill('schedule'));
  });

  it('fires at 16:52 across the April change (05/04 → 06/04/2031)', async () => {
    const h = setup({ start: '2031-04-05T01:00:00Z', closes: true }); // Saturday 12:00 AEDT
    const runs = await runsUntil(h, 3);
    expect(runs).toEqual(['2031-04-05 12:02', '2031-04-05 16:52', '2031-04-06 16:52']);
    expect(h.runs()[0]!.startedAt).toBe('2031-04-06T06:52:00.000Z');
  });

  it('a run that left targets schedules one follow-up at xx:07/22/37/52, at most 6 a day', async () => {
    const h = setup({ start: THU_1652, closes: true });
    h.histY.answers.set('AUDUSD=X', () => ({
      ok: false,
      kind: 'rate_limited',
      error: 'Rate limited',
    }));
    await h.scheduler.run('closes');
    expect(h.detail()).toMatchObject({ left: 5 });
    expect(h.clock.pending().map((p) => local(ms(p.at)))).toContain('2030-09-12 17:22');
    // Keep firing until only the next day's timers are left.
    for (let i = 0; i < 60; i += 1) {
      const next = h.clock.pending()[0];
      if (!next || next.at >= '2030-09-13') break;
      h.clock.fireNext();
      await settle(h);
    }
    const starts = h
      .runs()
      .map((r) => local(ms(r.startedAt)))
      .reverse();
    // The manual run, the start-up run (cooling: nothing fetched), then six follow-ups.
    expect(starts).toHaveLength(8);
    expect(starts.slice(2).every((s) => [7, 22, 37, 52].includes(Number(s.slice(-2))))).toBe(true);
    expect(h.clock.pending().every((p) => p.at >= '2030-09-13')).toBe(true);
  });
});

// ─── Pauses, the guard, `prices` awaiting closes, the deadline ──────────────────────────────────

describe('sharing the providers with the other jobs', () => {
  it('pauses before a request while `prices` runs', async () => {
    const h = setup({ start: THU_1652 });
    let release!: () => void;
    h.yahoo.gate = new Promise<void>((r) => (release = r));
    const prices = h.market.refresh();
    await flushMany();
    expect(h.scheduler.isRunning('prices')).toBe(true);
    const run = h.scheduler.run('closes');
    await flushMany();
    expect(h.histY.requests).toEqual([]);
    h.yahoo.gate = null;
    release();
    await prices;
    await run;
    expect(h.histY.requests).toHaveLength(5);
  });

  it('pauses for an intraday run that starts mid-run', async () => {
    const h = setup({ start: THU_1652 });
    let releaseSi!: () => void;
    h.histY.gates.set('SI=F', new Promise<void>((r) => (releaseSi = r)));
    const run = h.scheduler.run('closes');
    await flushMany();
    expect(h.histY.requests.map((r) => r.symbol)).toEqual(['AUDUSD=X', 'SI=F']);
    let releaseCoin!: () => void;
    h.coin.gate = new Promise<void>((r) => (releaseCoin = r));
    const intraday = h.scheduler.run('intraday');
    await flushMany();
    expect(h.scheduler.isRunning('intraday')).toBe(true);
    releaseSi();
    await flushMany();
    expect(h.histY.requests.map((r) => r.symbol)).toEqual(['AUDUSD=X', 'SI=F']);
    h.coin.gate = null;
    releaseCoin();
    await intraday;
    await run;
    expect(h.histY.requests).toHaveLength(5);
  });

  it('`prices` awaits an in-flight closes run, which no longer pauses for it (no deadlock)', async () => {
    const h = setup({ start: THU_1652 });
    let release!: () => void;
    h.histY.gates.set('AUDUSD=X', new Promise<void>((r) => (release = r)));
    const run = h.scheduler.run('closes');
    await flushMany();
    const prices = h.market.refresh();
    await flushMany();
    expect(h.scheduler.isRunning('prices')).toBe(true);
    expect(h.yahoo.requests).toEqual([]);
    release();
    await run;
    expect(h.detail()).toMatchObject({ yahoo: { ok: 5 } });
    const summary = await prices;
    expect(summary.requested).toBeGreaterThan(0);
    // Every closes request came before the price job's first one.
    expect(h.yahoo.requests.length).toBeGreaterThan(0);
  });

  it('a coin call due within 45 s of an intraday crypto slot waits for its run, then 15 s', async () => {
    const h = setup({ start: '2030-09-12T06:59:40Z', intraday: true, coinSpacingMs: 15_000 }); // 16:59:40
    let releaseCoin!: () => void;
    h.coin.gate = new Promise<void>((r) => (releaseCoin = r));
    const run = h.scheduler.run('closes');
    await flushMany();
    expect(h.histY.requests).toHaveLength(5);
    expect(h.histC.calls).toEqual([]);
    // The 17:00:20 slot fires first and starts the intraday crypto run (held by the gate).
    expect(h.clock.pending()[0]!.at).toBe('2030-09-12T07:00:20.000Z');
    h.clock.fireNext();
    await flushMany();
    expect(h.scheduler.isRunning('intraday')).toBe(true);
    // The guard's wait ends at 17:00:21; the closes run then waits for the intraday run.
    h.clock.fireNext();
    await flushMany();
    expect(h.histC.calls).toEqual([]);
    h.coin.gate = null;
    releaseCoin();
    await settle(h, 'intraday');
    const finished = h.clock.now().getTime();
    // Then 15 s of spacing before the first coin call.
    for (let i = 0; i < 10 && h.histC.calls.length === 0; i += 1) {
      h.clock.fireNext();
      await flushMany();
    }
    expect(iso(h.histC.calls[0]!.at)).toBe('2030-09-12T07:00:36.000Z');
    expect(h.histC.calls[0]!.at).toBeGreaterThanOrEqual(finished + 15_000);
    for (let i = 0; i < 20 && h.scheduler.isRunning('closes'); i += 1) {
      h.clock.fireNext();
      await flushMany();
    }
    await run;
    expect(h.histC.calls).toHaveLength(4);
    // Coin calls 15 s apart.
    const at = h.histC.calls.map((c) => c.at);
    for (let i = 1; i < at.length; i += 1)
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(15_000);
  });

  it('a deadline keeps the targets finished before it', async () => {
    const h = setup({ start: THU_1652, deadlineMs: 1_000 });
    h.histY.gates.set('ABC.AX', new Promise<void>(() => undefined));
    const run = h.scheduler.run('closes');
    await flushMany();
    expect(h.clock.pending()[0]!.ms).toBe(1_000);
    h.clock.fireNext();
    const { result } = await run;
    expect(result).toMatchObject({ status: 'partial', error: 'Run deadline reached' });
    expect(h.detail()).toMatchObject({ yahoo: { ok: 2, failed: 0, skipped: 3 }, left: 5 });
    expect(h.series('AUDUSD').length).toBeGreaterThan(0);
    expect(h.series('SI_USD_OZ').length).toBeGreaterThan(0);
    expect(h.rows('ASX:ABC')).toEqual([]);
  });
});

it('job_runs rows are written for the closes job', async () => {
  const h = setup({ start: THU_1652 });
  await h.scheduler.run('closes');
  expect(
    h.t.db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'closes'), eq(jobRuns.status, 'succeeded')))
      .all(),
  ).toHaveLength(1);
});
