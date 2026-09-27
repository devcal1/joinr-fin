// `POST /api/fire/use-workbook-contribution` (stage-6.md §3.3, §4.2, §4.5, §7.4 step 2; owner
// question 1, D105): an import-origin `fire.superContributionPerYearCents` row becomes origin 'app'
// with its value unchanged, so the FIRE page uses it as your setting; idempotent (a second POST and
// no row write nothing); `hasAppData` stays false (D103); refused while an upload import runs.
// FAKE engine; generic values only.
import type { FirePageResponse, SettingsPatchResponse } from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { importLock } from '../../src/routes/import';
import {
  call,
  errorOf,
  fireFakeEngine,
  hasAppDataOf,
  NOW,
  startApp,
  type TestApp,
} from './helpers';

const KEY = 'fire.superContributionPerYearCents';
const IMPORTED_AT = '2026-09-01T00:00:00.000Z';

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const post = (t: TestApp) =>
  call<SettingsPatchResponse>(t.app, {
    method: 'POST',
    url: '/api/fire/use-workbook-contribution',
  });
const getFire = (t: TestApp) => call<FirePageResponse>(t.app, { method: 'GET', url: '/api/fire' });
const row = (t: TestApp) =>
  t.database.db.select().from(settings).where(eq(settings.key, KEY)).get();

function putContribution(t: TestApp, cents: number, origin: 'import' | 'app'): void {
  t.database.db
    .insert(settings)
    .values({ key: KEY, valueJson: JSON.stringify(cents), updatedAt: IMPORTED_AT, origin })
    .run();
}

describe('POST /api/fire/use-workbook-contribution', () => {
  it('adopts the workbook’s figure: origin app, value unchanged, used as your setting', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    putContribution(ctx, 150000, 'import');
    const before = await getFire(ctx);
    expect(before.body.inputs.superContribution).toEqual({
      cents: 1300000,
      source: 'derived',
      savedCents: null,
      derivedCents: 1300000,
      workbookCents: 150000,
    });

    const res = await post(ctx);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      settings: { values: { [KEY]: 150000 }, origins: { [KEY]: 'app' } },
      hasAppData: false,
    });
    expect(row(ctx)).toMatchObject({
      valueJson: '150000',
      origin: 'app',
      updatedAt: NOW.toISOString(),
    });

    const after = await getFire(ctx);
    expect(after.body.inputs.superContribution).toEqual({
      cents: 150000,
      source: 'setting',
      savedCents: 150000,
      derivedCents: 1300000,
      workbookCents: null,
    });
    expect(after.body.hasAppData).toBe(false);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('is idempotent: a second POST writes nothing', async () => {
    ctx = await startApp({ engine: fireFakeEngine(), now: () => NOW });
    putContribution(ctx, 150000, 'import');
    await post(ctx);
    const first = row(ctx);
    const again = await post(ctx);
    expect(again.status).toBe(200);
    expect(again.body.settings.origins[KEY]).toBe('app');
    expect(row(ctx)).toEqual(first);
  });

  it('no row: 200 and nothing written; an app row is left as it is', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    const res = await post(ctx);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: { values: { [KEY]: null }, origins: { [KEY]: null } },
      hasAppData: false,
    });
    expect(row(ctx)).toBeUndefined();

    putContribution(ctx, 2000000, 'app');
    await post(ctx);
    expect(row(ctx)).toMatchObject({ valueJson: '2000000', origin: 'app', updatedAt: IMPORTED_AT });
  });

  it('409 while an upload import runs (nothing written)', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    putContribution(ctx, 150000, 'import');
    expect(importLock.tryAcquire()).toBe(true);
    try {
      const res = await post(ctx);
      expect(res.status).toBe(409);
      expect(errorOf(res.body).code).toBe('IMPORT_IN_PROGRESS');
      expect(row(ctx)?.origin).toBe('import');
    } finally {
      importLock.release();
    }
  });

  it('ignores a body (the route takes none)', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    putContribution(ctx, 150000, 'import');
    const res = await call<SettingsPatchResponse>(ctx.app, {
      method: 'POST',
      url: '/api/fire/use-workbook-contribution',
      payload: {},
    });
    expect(res.status).toBe(200);
    expect(row(ctx)?.origin).toBe('app');
  });
});
