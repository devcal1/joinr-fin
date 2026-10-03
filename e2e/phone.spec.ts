// Settings → Phone against the real server (stage-9.md §8.3): open a code on the page, read the code
// text, pair through Playwright's `request` as the app would (no Origin, no fetch metadata), see
// "Paired:", read `GET /api/mobile/today` with the key (200), Remove the phone on the page, and the
// same call answers 401 `DEVICE_KEY_REVOKED`. Also: no key → 401 `DEVICE_KEY_MISSING`, a write to
// the mobile path → 405 `MOBILE_READ_ONLY`, and no key on the page. Runs only in the
// `phone-mutations` projects (desktop at 1440, then the phone viewport; retries 0; the read-only
// desktop and phone projects ignore it): pairing writes the device store and an open code is
// replaced by the next, so it never runs beside another pairing. The key is a runtime test value:
// it is checked with a boolean (never echoed into a failure message) and never logged.
// Screenshots: artifacts/screenshots/stage9/web/<project>-phone-flow-<step>.png.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { MobilePairResponse, MobileTodayResponse } from '../packages/schema/src/dto/mobile';
import type { PhoneSectionResponse } from '../packages/schema/src/dto/phone';
import { MOBILE_KEY_RE } from '../packages/schema/src/mobile';
import {
  PAIR_API,
  PHONE_API,
  TODAY_API,
  errorCode,
  isPhoneProject,
  keyHeaders,
  openSettings,
  reveal,
  stage9Shot,
} from './phone-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial', retries: 0 });

const PROJECTS = ['phone-mutations', 'phone-mutations-375'];

/**
 * The page and the section at the project's width; on desktop also at 1024 (shots) and 1707 (the
 * owner's browser: no sideways scroll), then back to 1440.
 */
async function flowShots(
  page: Page,
  section: Locator,
  testInfo: TestInfo,
  step: string,
): Promise<void> {
  const widths = isPhoneProject(testInfo) ? [null] : [1440, 1024, 1707];
  for (const width of widths) {
    if (width !== null) await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
    const suffix = width === null || width === 1440 ? '' : `-${width}`;
    if (width === 1707) continue;
    await reveal(section);
    await stage9Shot(page, testInfo, `phone-flow-${step}${suffix}`);
    await stage9Shot(section, testInfo, `phone-flow-${step}-section${suffix}`);
  }
  if (widths.length > 1) await page.setViewportSize({ width: 1440, height: 900 });
}

test.describe('phone pairing (real server)', () => {
  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(!PROJECTS.includes(testInfo.project.name), 'runs in the phone-mutations projects');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
  });

  test('the mobile path without a key: 401 MISSING; a write: 405 READ_ONLY', async ({
    request,
  }) => {
    const missing = await request.get(TODAY_API);
    expect(missing.status()).toBe(401);
    expect(await errorCode(missing)).toBe('DEVICE_KEY_MISSING');
    expect(missing.headers()['cache-control']).toContain('no-store');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const write = await request.fetch(TODAY_API, { method });
      expect(write.status(), method).toBe(405);
      expect(await errorCode(write)).toBe('MOBILE_READ_ONLY');
    }
  });

  test('pair by the code on the page, read today, Remove → 401 REVOKED', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page);
    const phone = isPhoneProject(testInfo);
    const label = phone ? 'E2E phone (phone view)' : 'E2E phone (desktop view)';

    // 1. Open a code on the page.
    const section = await openSettings(page, phone ? null : 1440);
    await reveal(section);
    await stage9Shot(page, testInfo, 'phone-flow-1-start');
    const opened = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === `${PHONE_API}/pairing` && res.request().method() === 'POST',
    );
    await section.getByRole('button', { name: 'Pair a phone', exact: true }).click();
    expect((await opened).status()).toBe(201);
    const block = section.getByTestId('phone-pairing');
    await expect(block).toBeVisible();
    await expect(block.getByRole('img', { name: 'QR code for pairing a phone' })).toBeVisible();
    await expect(block.getByTestId('phone-countdown')).toHaveText(/^Valid for [0-5]:\d{2}$/);
    const shown = (await block.getByTestId('phone-code').innerText()).trim();
    expect(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(shown)).toBe(true);
    await flowShots(page, section, testInfo, '2-code');

    // 2. Pair as the app does: no Origin, no fetch metadata, the code typed by hand (with the dash).
    const pair = await request.post(PAIR_API, {
      data: { code: shown, deviceName: label, appVersion: '1.0.0' },
    });
    expect(pair.status()).toBe(201);
    expect(pair.headers()['cache-control']).toContain('no-store');
    const paired = (await pair.json()) as MobilePairResponse;
    expect(paired.apiVersion).toBe(1);
    expect(paired.label).toBe(label);
    const key = paired.key;
    expect(MOBILE_KEY_RE.test(key), 'the key matches MOBILE_KEY_RE').toBe(true);

    // The code is used: a second pair with it is refused.
    const reuse = await request.post(PAIR_API, { data: { code: shown, deviceName: 'Reuse' } });
    expect(reuse.status()).toBe(401);
    expect(await errorCode(reuse)).toBe('PAIRING_CODE_INVALID');

    // 3. The page's poll sees the pairing: the block closes, "Paired:" shows, the row is listed.
    await expect(section.getByText(`Paired: ${label}.`, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(block).toHaveCount(0);
    const table = section.getByTestId('phone-paired');
    await expect(table.getByRole('row').filter({ hasText: label })).toContainText('1.0.0');

    // 4. Today with the key.
    const today = await request.get(TODAY_API, { headers: keyHeaders(key) });
    expect(today.status()).toBe(200);
    const body = (await today.json()) as MobileTodayResponse;
    expect(body.apiVersion).toBe(1);
    expect(Array.isArray(body.holdings)).toBe(true);
    expect(body.holdings.length).toBeGreaterThan(0);
    expect(body.totals.holdings).toBe(body.holdings.length);
    expect(JSON.stringify(body)).not.toContain('jfk_');

    // The device call answers too, and the list now has a "Last used" time.
    const device = await request.get('/api/mobile/device', { headers: keyHeaders(key) });
    expect(device.status()).toBe(200);
    expect(((await device.json()) as { deviceId: string }).deviceId).toBe(paired.deviceId);
    const listed = (await (await request.get(PHONE_API)).json()) as PhoneSectionResponse;
    const row = listed.devices.find((d) => d.id === paired.deviceId);
    expect(row?.lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed)).not.toContain('jfk_');

    await page.reload();
    await expect(
      section.getByTestId('phone-paired').getByRole('row').filter({ hasText: label }),
    ).not.toContainText('Not yet');
    // The page never shows the key.
    expect(await page.content()).not.toContain(key);
    await expect(section).not.toContainText('jfk_');
    await flowShots(page, section, testInfo, '3-paired');

    // 5. Remove, on the page (asks first).
    await section.getByRole('button', { name: `Remove ${label}`, exact: true }).click();
    await expect(section).toContainText(`Remove ${label}? Its app and widgets stop`);
    const revoked = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === `${PHONE_API}/devices/${paired.deviceId}/revoke` &&
        res.request().method() === 'POST',
    );
    await section.getByRole('button', { name: `Remove the phone ${label}`, exact: true }).click();
    expect((await revoked).status()).toBe(200);
    await expect(section.getByTestId('phone-done')).toHaveText(`Removed ${label}.`);
    await expect(section.getByRole('heading', { level: 3, name: 'Paired phones' })).toBeFocused();
    await expect(section.getByRole('button', { name: `Remove ${label}`, exact: true })).toHaveCount(
      0,
    );
    await section.getByTestId('phone-removed').locator('summary').click();
    await expect(section.getByTestId('phone-removed')).toContainText(label);
    await flowShots(page, section, testInfo, '4-removed');

    // 6. The same key now: 401 REVOKED (today and device).
    const after = await request.get(TODAY_API, { headers: keyHeaders(key) });
    expect(after.status()).toBe(401);
    expect(await errorCode(after)).toBe('DEVICE_KEY_REVOKED');
    const afterDevice = await request.get('/api/mobile/device', { headers: keyHeaders(key) });
    expect(afterDevice.status()).toBe(401);
    expect(await errorCode(afterDevice)).toBe('DEVICE_KEY_REVOKED');

    expect(errors).toEqual([]);
  });

  test('Cancel closes an open code; the cancelled code cannot pair', async ({
    page,
    request,
  }, testInfo) => {
    const phone = isPhoneProject(testInfo);
    const errors = trackConsoleErrors(page);
    const section = await openSettings(page, phone ? null : 1440);
    await section.getByRole('button', { name: 'Pair a phone', exact: true }).click();
    const block = section.getByTestId('phone-pairing');
    await expect(block).toBeVisible();
    const shown = (await block.getByTestId('phone-code').innerText()).trim();
    await block.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(block).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Pair a phone', exact: true })).toBeFocused();
    expect(
      ((await (await request.get(PHONE_API)).json()) as PhoneSectionResponse).pairing,
    ).toBeNull();
    const pair = await request.post(PAIR_API, { data: { code: shown, deviceName: 'Cancelled' } });
    expect(pair.status()).toBe(401);
    expect(await errorCode(pair)).toBe('PAIRING_CODE_INVALID');
    expect(errors).toEqual([]);
  });
});
