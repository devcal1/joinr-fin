// A manual record interrupted by the recorder's stop() answers 503 with the recorder's own message
// (stage-5.md §4.6 item 8; Fixer round 1, CODE-3): the error handler passes an exposed 5xx
// `HttpError` through instead of the generic "Internal server error", and nothing is written.
// A temp database with the generic seed, a fake engine and a market whose refresh never settles.
import type { ApiErrorBody } from '@joinr/schema';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { offServices } from '../../src/app';
import { fakeMarket as recorderMarket } from '../recorder/helpers';
import { historyFakeEngine, startApp, type TestApp } from './helpers';

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('POST /api/history/record during stop() (§4.6 item 8)', () => {
  it('answers 503 with the stopping message and records nothing', async () => {
    const market = recorderMarket({ behaviour: null });
    ctx = await startApp({
      engine: historyFakeEngine(),
      services: (deps) => ({ ...offServices(deps), market }),
    });
    const app = ctx.app;
    const pending = app.inject({
      method: 'POST',
      url: '/api/history/record',
      payload: { periodMonths: ['2026-09'], note: null },
    });
    // Let the request reach the recorder's price wait.
    for (let i = 0; i < 50 && market.refreshCalls.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(market.refreshCalls).toHaveBeenCalled();
    await app.recorder.stop();
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(res.json<ApiErrorBody>()).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The server is stopping; nothing was recorded',
      },
    });
    const db = ctx.database.db;
    expect(
      db.select().from(snapshots).where(eq(snapshots.periodMonth, '2026-09')).get(),
    ).toBeUndefined();
    expect(db.select().from(snapshotAudit).all()).toHaveLength(0);
  });
});
