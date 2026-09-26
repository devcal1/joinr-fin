// The snapshot recorder with a fake clock and in-memory databases (stage-5.md §4.6, §7.5 item 2).
// A fake writeRecordedMonths (helpers.ts) stands in for server-api's writer, so these cover the
// recorder's timing, the switch, the mutex, the import lock, the price wait and stop().
process.env.TZ = 'Australia/Sydney';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem } from '../../src/cashflow/mutations/budget';
import {
  SNAPSHOT_LOCK_WAIT_MS,
  SNAPSHOT_PRICE_WAIT_MS,
  SNAPSHOT_RETRY_MS,
  SNAPSHOT_STARTUP_DELAY_MS,
} from '../../src/history/recorder';
import { importLock } from '../../src/routes/import';
import { systemClock } from '../../src/scheduler/index';
import {
  auditRows,
  containing,
  fakeMarket,
  local,
  makeHarness,
  readSinceMeta,
  setAutoRecordSetting,
  snapshotJobRuns,
  snapshotRows,
  type Harness,
} from './helpers';

let h: Harness | null = null;

afterEach(async () => {
  if (h) await h.close();
  h = null;
  importLock.release();
  vi.useRealTimers();
});

/** Advances the fake clock to a local time. */
async function advanceTo(at: Date): Promise<void> {
  const ms = at.getTime() - Date.now();
  if (ms < 0) throw new Error(`advanceTo: ${at.toString()} is in the past`);
  await vi.advanceTimersByTimeAsync(ms);
}

function start(at: Date, o: Parameters<typeof makeHarness>[0] = {}): Harness {
  vi.useFakeTimers({ now: at });
  h = makeHarness(o);
  h.recorder.start();
  return h;
}

const AUG = { periodMonth: '2026-08', runDate: '2026-08-31' } as const;
const JUL = { periodMonth: '2026-07', runDate: '2026-07-31' } as const;

describe('the switch and since (§4.6 items 1–2)', () => {
  it('is off by default: no timer, no job, the status says so', async () => {
    const t = start(local(2026, 9, 30, 22), { months: [AUG] });
    await advanceTo(local(2026, 10, 1, 6));
    expect(snapshotJobRuns(t.testDb)).toEqual([]);
    expect(snapshotRows(t.testDb)).toHaveLength(1);
    expect(t.recorder.status()).toEqual({
      autoRecord: { enabled: false, source: 'setting' },
      since: null,
      recordHour: 23,
      nextRunAt: null,
      running: false,
      lastRun: null,
      blocked: null,
    });
  });

  it('follows the setting; AUTO_RECORD overrides it and locks it', () => {
    vi.useFakeTimers({ now: local(2026, 9, 20, 10) });
    h = makeHarness({ setting: true });
    expect(h.recorder.status().autoRecord).toEqual({ enabled: true, source: 'setting' });
    void h.close();

    h = makeHarness({ setting: false, autoRecord: true });
    expect(h.recorder.status().autoRecord).toEqual({ enabled: true, source: 'env' });
    void h.close();

    h = makeHarness({ setting: true, autoRecord: false });
    expect(h.recorder.status().autoRecord).toEqual({ enabled: false, source: 'env' });
    expect(h.recorder.status().nextRunAt).toBeNull();
  });

  it('AUTO_RECORD=false keeps the month end unrecorded although the setting is on', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      autoRecord: false,
    });
    await advanceTo(local(2026, 10, 1, 1));
    expect(snapshotJobRuns(t.testDb)).toEqual([]);
    expect(readSinceMeta(t.testDb)).toBeNull(); // the effective switch is off: `since` cleared
  });

  it('stamps since at start-up with AUTO_RECORD on and no stored date; keeps a stored one', () => {
    let t = start(local(2026, 9, 20, 10), { autoRecord: true });
    expect(readSinceMeta(t.testDb)).toBe('2026-09-20');
    expect(t.recorder.status().since).toBe('2026-09-20');
    void t.close();
    h = null;
    vi.useRealTimers();

    t = start(local(2026, 9, 20, 10), { autoRecord: true, since: '2026-06-02' });
    expect(readSinceMeta(t.testDb)).toBe('2026-06-02');
  });

  it('settingsChanged stamps since on and clears it off', () => {
    const t = start(local(2026, 9, 20, 10));
    expect(readSinceMeta(t.testDb)).toBeNull();
    setAutoRecordSetting(t.testDb, true);
    t.recorder.settingsChanged();
    expect(readSinceMeta(t.testDb)).toBe('2026-09-20');
    expect(t.recorder.status()).toMatchObject({
      autoRecord: { enabled: true, source: 'setting' },
      since: '2026-09-20',
      nextRunAt: '2026-09-30T23:00:00+10:00',
    });
    setAutoRecordSetting(t.testDb, false);
    t.recorder.settingsChanged();
    expect(readSinceMeta(t.testDb)).toBeNull();
    expect(t.recorder.status().nextRunAt).toBeNull();
  });

  it('switching on at 23:30 on the last day records the month at once', async () => {
    const t = start(local(2026, 9, 30, 23, 30), {
      months: [AUG],
      market: fakeMarket({ mode: 'off' }),
    });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS);
    expect(snapshotJobRuns(t.testDb)).toEqual([]);
    setAutoRecordSetting(t.testDb, true);
    t.recorder.settingsChanged();
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotRows(t.testDb).at(-1)).toEqual({
      periodMonth: '2026-09',
      runDate: '2026-09-30',
      source: 'recorded',
    });
  });
});

describe('scheduled records (§4.6 items 3–5)', () => {
  it('records the month at 23:00 on its last day: one job run, one recorded month', async () => {
    const t = start(local(2026, 9, 30, 22), { months: [AUG], setting: true, since: '2026-09-01' });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS);
    expect(snapshotJobRuns(t.testDb)).toEqual([]); // nothing due → no job_runs row
    await advanceTo(local(2026, 9, 30, 22, 59, 59));
    expect(snapshotJobRuns(t.testDb)).toEqual([]);
    await advanceTo(local(2026, 9, 30, 23, 0, 1)); // the price refresh takes 1 s
    expect(snapshotRows(t.testDb)).toEqual([
      { periodMonth: '2026-08', runDate: '2026-08-31', source: 'migrated' },
      { periodMonth: '2026-09', runDate: '2026-09-30', source: 'recorded' },
    ]);
    const runs = snapshotJobRuns(t.testDb);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'schedule',
      status: 'succeeded',
      detail: {
        due: ['2026-09'],
        recorded: ['2026-09'],
        skipped: [],
        pricesRefreshed: true,
        pricesAsOf: local(2026, 9, 30, 23, 0, 1).toISOString(),
      },
    });
    const call = t.writer.calls[0]!;
    expect(call).toMatchObject({
      periodMonths: ['2026-09'],
      source: 'recorded',
      trigger: 'schedule',
      note: null,
      now: local(2026, 9, 30, 23, 0, 1),
      detail: { marketMode: 'fake', pricesRefreshed: true, pricesAgeMs: 0 },
    });
    expect(call.detail.jobRunId).toEqual(expect.any(Number));
    expect(auditRows(t.testDb).map((a) => [a.periodMonth, a.action, a.trigger])).toEqual([
      ['2026-09', 'record', 'schedule'],
    ]);
    expect(t.recorder.status()).toMatchObject({
      running: false,
      nextRunAt: '2026-10-31T23:00:00+11:00',
      lastRun: { job: 'snapshot', trigger: 'schedule', status: 'succeeded' },
      blocked: null,
    });
    // Nothing more until the next month end.
    await advanceTo(local(2026, 10, 31, 22, 59));
    expect(snapshotJobRuns(t.testDb)).toHaveLength(1);
  });

  it('records at 23:00 local across the October DST change', async () => {
    const t = start(local(2026, 10, 3, 22), {
      months: [{ periodMonth: '2026-09', runDate: '2026-09-30' }],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ mode: 'off' }),
    });
    await advanceTo(local(2026, 10, 31, 23));
    expect(t.writer.calls.map((c) => c.now)).toEqual([local(2026, 10, 31, 23)]);
    expect(snapshotRows(t.testDb).at(-1)).toEqual({
      periodMonth: '2026-10',
      runDate: '2026-10-31',
      source: 'recorded',
    });
  });

  it('catches up at start-up after an outage across two month ends (late, one run date)', async () => {
    const t = start(local(2026, 10, 2, 9), { months: [JUL], setting: true, since: '2026-07-15' });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS - 1);
    expect(snapshotJobRuns(t.testDb)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    expect(snapshotRows(t.testDb).slice(1)).toEqual([
      { periodMonth: '2026-08', runDate: '2026-10-02', source: 'late' },
      { periodMonth: '2026-09', runDate: '2026-10-02', source: 'late' },
    ]);
    expect(snapshotJobRuns(t.testDb)).toEqual([
      expect.objectContaining({
        trigger: 'startup',
        status: 'succeeded',
        detail: containing({ due: ['2026-08', '2026-09'], recorded: ['2026-08', '2026-09'] }),
      }),
    ]);
    expect(t.writer.calls).toHaveLength(1);
    expect(t.writer.calls[0]).toMatchObject({ source: 'late', trigger: 'startup' });
    expect(auditRows(t.testDb).map((a) => a.trigger)).toEqual(['startup', 'startup']);
  });

  it('never catches up a month that ended before since; a blocked month is reported once (D94)', async () => {
    const t = start(local(2026, 9, 20, 10), { months: [JUL], setting: true, since: '2026-09-05' });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS);
    expect(snapshotJobRuns(t.testDb)).toEqual([]); // Aug is missing but nothing would be due
    expect(t.recorder.status().blocked).toBeNull();

    await advanceTo(local(2026, 9, 30, 23));
    const runs = snapshotJobRuns(t.testDb);
    expect(runs).toEqual([
      expect.objectContaining({
        trigger: 'schedule',
        status: 'partial',
        detail: containing({
          due: [],
          recorded: [],
          skipped: [{ month: '2026-09', reason: 'earlier_month_missing' }],
        }),
      }),
    ]);
    expect(t.recorder.status().blocked).toEqual({ periodMonth: '2026-09', missing: ['2026-08'] });
    expect(snapshotRows(t.testDb)).toHaveLength(1);
    expect(t.market.refreshCalls).not.toHaveBeenCalled();

    // Later wake-ups do not repeat it.
    await advanceTo(local(2026, 10, 1, 18));
    expect(snapshotJobRuns(t.testDb)).toHaveLength(1);

    // The owner records August by hand; September (ended, after since) is then caught up late.
    const manual = t.recorder.record({ periodMonths: ['2026-08'], note: null });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(manual).resolves.toHaveLength(1);
    expect(snapshotRows(t.testDb).map((r) => [r.periodMonth, r.source, r.runDate])).toEqual([
      ['2026-07', 'migrated', '2026-07-31'],
      ['2026-08', 'lookback', '2026-10-01'],
      ['2026-09', 'late', '2026-10-01'],
    ]);
    expect(t.recorder.status().blocked).toBeNull();
  });

  it('retries a failure after 15 minutes', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ mode: 'off' }),
    });
    t.writer.failNext = 1;
    await advanceTo(local(2026, 9, 30, 23));
    expect(snapshotJobRuns(t.testDb)).toEqual([
      expect.objectContaining({ status: 'failed', error: 'write failed (test)' }),
    ]);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS - 1);
    expect(snapshotJobRuns(t.testDb)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotJobRuns(t.testDb).map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(t.writer.calls.map((c) => c.now)).toEqual([
      local(2026, 9, 30, 23),
      local(2026, 9, 30, 23, 15),
    ]);
    expect(snapshotRows(t.testDb).at(-1)?.source).toBe('recorded');
  });

  it('after failures at 23:00, 23:15, 23:30 and 23:45 the first wake-up after midnight records late', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ mode: 'off' }),
    });
    t.writer.failNext = 4;
    await advanceTo(local(2026, 10, 1, 0, 0));
    expect(t.writer.calls.map((c) => c.now)).toEqual([
      local(2026, 9, 30, 23),
      local(2026, 9, 30, 23, 15),
      local(2026, 9, 30, 23, 30),
      local(2026, 9, 30, 23, 45),
      local(2026, 10, 1, 0, 0),
    ]);
    expect(t.writer.calls.map((c) => c.source)).toEqual([
      'recorded',
      'recorded',
      'recorded',
      'recorded',
      'late',
    ]);
    expect(snapshotJobRuns(t.testDb).map((r) => r.status)).toEqual([
      'failed',
      'failed',
      'failed',
      'failed',
      'succeeded',
    ]);
    expect(snapshotRows(t.testDb).at(-1)).toEqual({
      periodMonth: '2026-09',
      runDate: '2026-10-01',
      source: 'late',
    });
  });

  it('re-derives the months after a price wait that crosses midnight (June stays in its FY)', async () => {
    const t = start(local(2026, 6, 30, 23, 58), {
      months: [{ periodMonth: '2026-05', runDate: '2026-05-31' }],
      setting: true,
      since: '2026-06-01',
      market: fakeMarket({ behaviour: 90_000 }),
    });
    await advanceTo(local(2026, 6, 30, 23, 59)); // the start-up check: June is due
    expect(t.market.refreshCalls).toHaveBeenCalledTimes(1);
    expect(snapshotRows(t.testDb)).toHaveLength(1);
    await advanceTo(local(2026, 7, 1, 0, 0, 30));
    expect(snapshotRows(t.testDb).at(-1)).toEqual({
      periodMonth: '2026-06',
      runDate: '2026-07-01',
      source: 'late',
    });
    expect(t.writer.calls[0]).toMatchObject({
      periodMonths: ['2026-06'],
      source: 'late',
      trigger: 'startup',
    });
    expect(snapshotJobRuns(t.testDb)[0]).toMatchObject({
      status: 'succeeded',
      detail: { due: ['2026-06'], recorded: ['2026-06'] },
    });
  });
});

describe('the import lock (§4.6 item 6)', () => {
  it('skips while an import holds the lock and retries after 15 minutes', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ mode: 'off' }),
    });
    await advanceTo(local(2026, 9, 30, 22, 59));
    expect(importLock.tryAcquire()).toBe(true);
    await advanceTo(local(2026, 9, 30, 23));
    expect(snapshotJobRuns(t.testDb)).toEqual([
      expect.objectContaining({
        status: 'partial',
        detail: containing({
          recorded: [],
          skipped: [{ month: '2026-09', reason: 'import_in_progress' }],
        }),
      }),
    ]);
    expect(snapshotRows(t.testDb)).toHaveLength(1);
    importLock.release();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS);
    expect(snapshotJobRuns(t.testDb).map((r) => r.status)).toEqual(['partial', 'succeeded']);
    expect(snapshotRows(t.testDb)).toHaveLength(2);
  });

  it('is never held by the recorder: a Stage 3 save succeeds during the price wait', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: 10_000 }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 2));
    expect(t.recorder.status().running).toBe(true);
    expect(importLock.held).toBe(false);
    const id = createItem(
      { database: { sqlite: t.testDb.sqlite, db: t.testDb.db }, now: () => new Date() },
      { name: 'Example item', monthlyCents: 1_000, category: null, accountId: null },
    );
    expect(id).toEqual(expect.any(Number));
    await advanceTo(local(2026, 9, 30, 23, 0, 10));
    expect(snapshotRows(t.testDb)).toHaveLength(2);
  });

  it('an upload that starts during the price wait makes an automatic record skip', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: 10_000 }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 2));
    expect(importLock.tryAcquire()).toBe(true);
    await advanceTo(local(2026, 9, 30, 23, 0, 10));
    expect(t.writer.calls).toEqual([]);
    expect(snapshotJobRuns(t.testDb)[0]).toMatchObject({
      status: 'partial',
      detail: { skipped: [{ month: '2026-09', reason: 'import_in_progress' }] },
    });
  });

  it('a manual record answers 409 IMPORT_IN_PROGRESS before and after the price wait', async () => {
    const t = start(local(2026, 9, 20, 10), {
      months: [AUG],
      market: fakeMarket({ behaviour: 10_000 }),
    });
    expect(importLock.tryAcquire()).toBe(true);
    await expect(
      t.recorder.record({ periodMonths: ['2026-09'], note: null }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IMPORT_IN_PROGRESS',
    });
    expect(t.market.refreshCalls).not.toHaveBeenCalled();
    importLock.release();

    const pending = t.recorder.record({ periodMonths: ['2026-09'], note: null });
    const settled = expect(pending).rejects.toMatchObject({ code: 'IMPORT_IN_PROGRESS' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(importLock.tryAcquire()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
    expect(t.writer.calls).toEqual([]);
  });
});

describe('prices first (§4.6 item 6.2)', () => {
  const onAt23 = { months: [AUG], setting: true, since: '2026-09-01' } as const;

  it('awaits market.refresh before the write', async () => {
    const t = start(local(2026, 9, 30, 22), {
      ...onAt23,
      market: fakeMarket({ behaviour: 5_000 }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 4));
    expect(t.writer.calls).toEqual([]);
    await advanceTo(local(2026, 9, 30, 23, 0, 5));
    expect(t.market.refreshCalls).toHaveBeenCalledWith({ trigger: 'schedule' });
    expect(t.writer.calls[0]).toMatchObject({
      now: local(2026, 9, 30, 23, 0, 5),
      detail: {
        pricesAsOf: local(2026, 9, 30, 23, 0, 5).toISOString(),
        pricesRefreshed: true,
        pricesAgeMs: 0,
      },
    });
  });

  it('records with the cached prices when the refresh times out (pricesRefreshed false)', async () => {
    const cached = local(2026, 9, 30, 20).toISOString();
    const t = start(local(2026, 9, 30, 22), {
      ...onAt23,
      market: fakeMarket({ behaviour: null, lastRefreshAt: cached }),
    });
    await advanceTo(new Date(local(2026, 9, 30, 23).getTime() + SNAPSHOT_PRICE_WAIT_MS - 1));
    expect(t.writer.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.writer.calls[0]!.detail).toEqual({
      pricesAsOf: cached,
      marketMode: 'fake',
      pricesRefreshed: false,
      pricesAgeMs: 3 * 3_600_000 + SNAPSHOT_PRICE_WAIT_MS,
      jobRunId: expect.any(Number) as number,
    });
    expect(JSON.parse(auditRows(t.testDb)[0]!.detailJson!)).toMatchObject({
      pricesRefreshed: false,
    });
    expect(snapshotJobRuns(t.testDb)[0]).toMatchObject({
      status: 'succeeded',
      detail: { pricesRefreshed: false, pricesAsOf: cached },
    });
  });

  it('records with the cached prices when the refresh fails', async () => {
    const t = start(local(2026, 9, 30, 22), {
      ...onAt23,
      market: fakeMarket({ behaviour: 'fail' }),
    });
    await advanceTo(local(2026, 9, 30, 23));
    expect(t.writer.calls[0]!.detail).toMatchObject({ pricesRefreshed: false, pricesAsOf: null });
  });

  it('reuses prices refreshed within 5 minutes', async () => {
    const recent = local(2026, 9, 30, 22, 57).toISOString();
    const t = start(local(2026, 9, 30, 22), {
      ...onAt23,
      market: fakeMarket({ lastRefreshAt: recent }),
    });
    await advanceTo(local(2026, 9, 30, 23));
    expect(t.market.refreshCalls).not.toHaveBeenCalled();
    expect(t.writer.calls[0]!.detail).toMatchObject({
      pricesAsOf: recent,
      pricesRefreshed: true,
      pricesAgeMs: 180_000,
    });
  });

  it('market off: no refresh (MarketDataDisabledError)', async () => {
    const t = start(local(2026, 9, 30, 22), { ...onAt23, market: fakeMarket({ mode: 'off' }) });
    await advanceTo(local(2026, 9, 30, 23));
    expect(t.market.refreshCalls).toHaveBeenCalledTimes(1);
    expect(t.market.runs).toBe(0);
    expect(t.writer.calls[0]!.detail).toMatchObject({ marketMode: 'off', pricesRefreshed: false });
  });

  it('joins the hourly price job running at 23:00 (one refresh)', async () => {
    const t = start(local(2026, 9, 30, 22), {
      ...onAt23,
      market: fakeMarket({ behaviour: 60_000 }),
    });
    await advanceTo(local(2026, 9, 30, 22, 59, 30));
    void t.market.startPriceJob();
    await advanceTo(local(2026, 9, 30, 23, 0, 30));
    expect(t.market.runs).toBe(1);
    expect(t.market.refreshCalls).toHaveBeenCalledTimes(1);
    expect(t.writer.calls[0]).toMatchObject({
      now: local(2026, 9, 30, 23, 0, 30),
      detail: { pricesRefreshed: true },
    });
  });
});

describe('one record at a time (§4.6 item 6)', () => {
  it('a manual record waits for a scheduled one, then gets SNAPSHOT_EXISTS', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: 10_000 }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 2));
    const manual = t.recorder.record({ periodMonths: ['2026-09'], note: 'Example note' });
    const settled = expect(manual).rejects.toMatchObject({
      statusCode: 409,
      code: 'SNAPSHOT_EXISTS',
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 10));
    await settled;
    expect(t.writer.calls.map((c) => c.trigger)).toEqual(['schedule', 'manual']);
    expect(snapshotRows(t.testDb)).toHaveLength(2);
  });

  it('a manual record waits for a scheduled catch-up, then records its own month', async () => {
    const t = start(local(2026, 9, 30, 10), {
      months: [JUL],
      setting: true,
      since: '2026-08-01',
      market: fakeMarket({ behaviour: 10_000 }),
    });
    await advanceTo(local(2026, 9, 30, 10, 1, 2)); // the start-up catch-up waits for prices
    const manual = t.recorder.record({ periodMonths: ['2026-09'], note: null });
    await advanceTo(local(2026, 9, 30, 10, 1, 10));
    await expect(manual).resolves.toEqual([expect.objectContaining({ periodMonth: '2026-09' })]);
    expect(snapshotRows(t.testDb).slice(1)).toEqual([
      { periodMonth: '2026-08', runDate: '2026-09-30', source: 'late' },
      { periodMonth: '2026-09', runDate: '2026-09-30', source: 'recorded' },
    ]);
    expect(t.writer.calls.map((c) => [c.trigger, c.source])).toEqual([
      ['startup', 'late'],
      ['manual', 'recorded'],
    ]);
    // The manual record reused the prices the catch-up had just refreshed.
    expect(t.market.refreshCalls).toHaveBeenCalledTimes(1);
  });

  it('answers RECORD_IN_PROGRESS after waiting 30 s', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: null }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 1));
    const manual = t.recorder.record({ periodMonths: ['2026-09'], note: null });
    let outcome: unknown = 'pending';
    manual.catch((err: unknown) => {
      outcome = err;
    });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_LOCK_WAIT_MS - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ statusCode: 409, code: 'RECORD_IN_PROGRESS' });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_PRICE_WAIT_MS);
    expect(t.writer.calls.map((c) => c.trigger)).toEqual(['schedule']);
  });

  it('withLock serialises a correction behind a record', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: 5_000 }),
    });
    await expect(t.recorder.withLock(() => 'idle')).resolves.toBe('idle');
    await advanceTo(local(2026, 9, 30, 23, 0, 1));
    const seen: number[] = [];
    const correction = t.recorder.withLock(() => {
      seen.push(t.writer.calls.length);
      return 42;
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(correction).resolves.toBe(42);
    expect(seen).toEqual([1]);
  });

  it('a manual record of an ended month is lookback; the current month is recorded', async () => {
    const t = start(local(2026, 10, 5, 10), { months: [AUG], market: fakeMarket({ mode: 'off' }) });
    await expect(
      t.recorder.record({ periodMonths: ['2026-09', '2026-10'], note: 'Example note' }),
    ).resolves.toHaveLength(2);
    expect(t.writer.calls[0]).toMatchObject({
      source: 'lookback',
      trigger: 'manual',
      note: 'Example note',
      detail: { jobRunId: null, marketMode: 'off' },
    });
    expect(
      snapshotRows(t.testDb)
        .slice(1)
        .map((r) => r.source),
    ).toEqual(['lookback', 'recorded']);
    expect(snapshotJobRuns(t.testDb)).toEqual([]); // manual records write no job_runs row
  });
});

describe('stop() (§4.6 item 8)', () => {
  it('resolves within one tick during the price wait and writes nothing (failed, stopped)', async () => {
    const t = start(local(2026, 9, 30, 22), {
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ behaviour: null }),
    });
    await advanceTo(local(2026, 9, 30, 23, 0, 5));
    let done = false;
    void t.recorder.stop().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(t.writer.calls).toEqual([]);
    expect(snapshotRows(t.testDb)).toHaveLength(1);
    expect(snapshotJobRuns(t.testDb)).toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'stopped',
        detail: containing({ skipped: [{ month: '2026-09', reason: 'stopped' }] }),
      }),
    ]);

    // Caught up at the next start (D82).
    // (The fake market's hung refresh is joined again, so this one records after the price wait.)
    t.recorder.start();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS + SNAPSHOT_PRICE_WAIT_MS);
    expect(snapshotRows(t.testDb).at(-1)).toMatchObject({ periodMonth: '2026-09' });
    expect(snapshotJobRuns(t.testDb).map((r) => [r.trigger, r.status])).toEqual([
      ['schedule', 'failed'],
      ['startup', 'succeeded'],
    ]);
  });

  it('a manual record stopped during its price wait rejects with 503', async () => {
    const t = start(local(2026, 9, 20, 10), {
      months: [AUG],
      market: fakeMarket({ behaviour: null }),
    });
    const manual = t.recorder.record({ periodMonths: ['2026-09'], note: null });
    const settled = expect(manual).rejects.toMatchObject({
      statusCode: 503,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The server is stopping; nothing was recorded',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await t.recorder.stop();
    await settled;
    expect(t.writer.calls).toEqual([]);
    await expect(
      t.recorder.record({ periodMonths: ['2026-09'], note: null }),
    ).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

describe('time sources (§4.6 item 4)', () => {
  it('reads dates from `now` and runs timers on `clock`', async () => {
    vi.useFakeTimers({ now: local(2026, 1, 10, 10) });
    const skew = local(2026, 9, 30, 23, 10).getTime() - Date.now();
    const now = (): Date => new Date(Date.now() + skew);
    h = makeHarness({
      months: [AUG],
      setting: true,
      since: '2026-09-01',
      market: fakeMarket({ mode: 'off' }),
      now,
      clock: systemClock,
    });
    h.recorder.start();
    expect(h.recorder.status().nextRunAt).toBe('2026-10-31T23:00:00+11:00');
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS - 1);
    expect(h.writer.calls).toEqual([]); // due by `now`, but the clock's start-up delay has not passed
    await vi.advanceTimersByTimeAsync(1);
    expect(h.writer.calls[0]).toMatchObject({
      now: local(2026, 9, 30, 23, 11),
      source: 'recorded',
    });
    expect(snapshotRows(h.testDb).at(-1)).toEqual({
      periodMonth: '2026-09',
      runDate: '2026-09-30',
      source: 'recorded',
    });
    // The scheduler's own row keeps the clock's time.
    expect(h.scheduler.lastRun('snapshot')?.startedAt).toBe(
      local(2026, 1, 10, 10, 1).toISOString(),
    );
  });
});
