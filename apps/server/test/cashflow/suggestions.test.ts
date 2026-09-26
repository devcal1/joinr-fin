// The Yahoo suggestion routes with a FAKE DividendEventsService (the frozen stage-3.md §4.6
// interface; §7.4 step 6): refresh (503 in mode off, the summary and the status mapping), dismiss
// and restore (`dismissed_at` set and cleared, 404 for an unknown event), and the page's `events`
// status from `job_runs` and `dividend_events` (≤ 200 characters, no URLs).
import type {
  ApiErrorBody,
  DividendEventsRefreshResponse,
  DividendsPageResponse,
} from '@joinr/schema';
import { dividendEvents, jobRuns } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  call,
  errorOf,
  fakeDividendEvents,
  hasAppDataOf,
  NOW,
  refreshSummary,
  startApp,
  type TestApp,
} from './helpers';

let ctx: TestApp | undefined;

afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

function insertEvents(t: TestApp): void {
  const xyz = t.ids['ASX:XYZ']!;
  const def = t.ids['ASX:DEF']!;
  const row = (instrumentId: number, exDate: string) => ({
    instrumentId,
    exDate,
    amountPerUnit: '0.5',
    currency: 'AUD',
    closeBeforeEx: '100',
    closeDate: null,
    source: 'fake' as const,
    fetchedAt: NOW.toISOString(),
  });
  t.database.db
    .insert(dividendEvents)
    .values([row(xyz, '2026-04-01'), row(xyz, '2026-07-01'), row(def, '2026-07-01')])
    .run();
}

function dismissedAt(t: TestApp, exDate: string): string | null | undefined {
  return t.database.db
    .select({ at: dividendEvents.dismissedAt })
    .from(dividendEvents)
    .where(
      and(eq(dividendEvents.instrumentId, t.ids['ASX:XYZ']!), eq(dividendEvents.exDate, exDate)),
    )
    .get()?.at;
}

describe('POST /api/dividends/suggestions/refresh', () => {
  it('answers 503 MARKET_DATA_DISABLED in mode off', async () => {
    ctx = await startApp();
    const res = await call<ApiErrorBody>(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/refresh',
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MARKET_DATA_DISABLED');
  });

  it('awaits the run and answers the summary with the status from the tables', async () => {
    const service = fakeDividendEvents({
      mode: 'live',
      summary: refreshSummary({ jobRunId: 3, requested: 2, ok: 2, failed: 0, events: 3 }),
      lastRefreshAt: '2026-09-24T01:00:00.000Z',
      nextRefreshAt: '2026-09-25T01:00:00.000Z',
    });
    ctx = await startApp({ dividendEvents: service });
    insertEvents(ctx);
    const res = await call<DividendEventsRefreshResponse>(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/refresh',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(service.refreshMock).toHaveBeenCalledWith({ trigger: 'manual' });
    expect(res.body).toEqual({
      summary: {
        jobRunId: 3,
        requested: 2,
        ok: 2,
        failed: 0,
        skipped: 0,
        events: 3,
        durationMs: 120,
      },
      events: {
        mode: 'live',
        running: false,
        lastRefreshAt: '2026-09-24T01:00:00.000Z',
        nextRefreshAt: '2026-09-25T01:00:00.000Z',
        eventCount: 3,
        instrumentsCovered: 2,
        lastError: null,
      },
    });
  });
});

describe('dismiss and restore', () => {
  it('sets and clears dismissed_at (an overlay: no app data); 404 for an unknown event', async () => {
    ctx = await startApp({ dividendEvents: fakeDividendEvents() });
    insertEvents(ctx);
    const key = { instrumentId: ctx.ids['ASX:XYZ']!, exDate: '2026-07-01' };
    const res = await call(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/dismiss',
      payload: key,
    });
    expect(res).toMatchObject({ status: 200, body: key });
    expect(dismissedAt(ctx, '2026-07-01')).toBe(NOW.toISOString());
    expect(dismissedAt(ctx, '2026-04-01')).toBeNull();
    expect(await hasAppDataOf(ctx.app)).toBe(false);

    const restored = await call(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/restore',
      payload: key,
    });
    expect(restored).toMatchObject({ status: 200, body: key });
    expect(dismissedAt(ctx, '2026-07-01')).toBeNull();

    const unknown = await call(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/dismiss',
      payload: { ...key, exDate: '2026-01-01' },
    });
    expect(unknown.status).toBe(404);
    const bad = await call(ctx.app, {
      method: 'POST',
      url: '/api/dividends/suggestions/restore',
      payload: { instrumentId: 0, exDate: 'soon' },
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body).code).toBe('VALIDATION_ERROR');
  });
});

describe('the page events status', () => {
  it('counts the cached events and shows the last run error without URLs, ≤ 200 characters', async () => {
    ctx = await startApp({ dividendEvents: fakeDividendEvents({ mode: 'fake', running: true }) });
    insertEvents(ctx);
    const run = (startedAt: string, error: string | null) => ({
      job: 'dividends',
      trigger: 'manual' as const,
      startedAt,
      finishedAt: startedAt,
      status: error === null ? ('succeeded' as const) : ('partial' as const),
      error,
    });
    ctx.database.db
      .insert(jobRuns)
      .values([
        run('2026-09-23T01:00:00.000Z', null),
        run('2026-09-24T01:00:00.000Z', `Stopped at https://example.com/x?y=1 ${'z'.repeat(400)}`),
      ])
      .run();
    const page = await call<DividendsPageResponse>(ctx.app, {
      method: 'GET',
      url: '/api/dividends',
    });
    const events = page.body.events;
    expect(events).toMatchObject({
      mode: 'fake',
      running: true,
      eventCount: 3,
      instrumentsCovered: 2,
    });
    expect(events.lastError).not.toContain('https://');
    expect(events.lastError!.startsWith('Stopped at z')).toBe(true);
    expect(events.lastError!.length).toBeLessThanOrEqual(200);
  });

  it('has no error after a clean run', async () => {
    ctx = await startApp({ dividendEvents: fakeDividendEvents() });
    ctx.database.db
      .insert(jobRuns)
      .values({
        job: 'dividends',
        trigger: 'schedule',
        startedAt: NOW.toISOString(),
        status: 'succeeded',
        error: null,
      })
      .run();
    const page = await call<DividendsPageResponse>(ctx.app, {
      method: 'GET',
      url: '/api/dividends',
    });
    expect(page.body.events).toMatchObject({
      lastError: null,
      eventCount: 0,
      instrumentsCovered: 0,
    });
  });
});
