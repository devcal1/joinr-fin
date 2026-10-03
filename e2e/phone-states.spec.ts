// Fixture-only Settings → Phone states in a real browser (stage-9.md §8.2–§8.3), desktop (1707, 1440
// and 1024) and phone (375), read-only: `GET /api/phone` answers each `phoneSections` fixture (the
// rest of the API stays live) and every phone write is aborted and counted (none may be sent). The
// browser clock is fixed at the fixtures' own time, so the open code reads "Valid for 4:32". Per
// state: the section's words, no page-level horizontal scroll, no console errors, and a shot of the
// section. Then the open code in use: the QR (one path, crispEdges, module-unit viewBox, a whole
// number of pixels per module), the address warnings (a loopback prefill, a short name, a .ts.net
// name, an invalid address), and the Remove confirmation (opened and cancelled, focus back).
// Screenshots: artifacts/screenshots/stage9/web/<project>-phone-state-<name>-<width>.png.
import { expect, test } from '@playwright/test';
import { PHONE_FIXTURE_NOW, phoneSections } from '../packages/schema/src/fixtures/phone';
import {
  isPhoneProject,
  mockPhone,
  openSettings,
  reveal,
  stage9Shot,
  widthsFor,
} from './phone-support';
import { expectNoHorizontalScroll, trackConsoleErrors } from './support';

type StateName = keyof typeof phoneSections;

/** A sentence each state must show (§8.2). */
const STATE_TEXT: Record<StateName, string> = {
  none: 'No phone is paired.',
  pairingOpen: 'Valid for 4:32',
  justPaired: 'Paired: Android phone.',
  cancelledByFailures: 'The code was cancelled after 5 wrong attempts from another device.',
  onePhone: 'Android phone',
  twoPlusRemoved: 'Test phone 3',
  limit: '10 phones are paired already, the most allowed. Remove one to pair another.',
  storeSetAside:
    'The list of paired phones could not be read and was set aside. Pair your phone again.',
  storeUnwritable:
    'Removed phones are blocked now, but the removal is not saved yet: a restart of the app would bring them back.',
};

const WARNING =
  "This address can be answered by the home network when Tailscale is off, and the phone's key would then travel unencrypted over Wi-Fi.";

test.describe('Phone states (fixtures)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(PHONE_FIXTURE_NOW));
  });

  for (const name of Object.keys(phoneSections) as StateName[]) {
    test(`phone: ${name}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors = trackConsoleErrors(page);
      const phone = isPhoneProject(testInfo);
      const mock = await mockPhone(page, phoneSections[name]);

      for (const width of widthsFor(testInfo)) {
        const section = await openSettings(page, phone ? null : width);
        await expect(section).toContainText(STATE_TEXT[name]);
        await expect(section.locator('h2#phone')).toHaveText('Phone');
        if (name === 'twoPlusRemoved') {
          await section.getByText('Removed (2)').click();
          await expect(section.getByTestId('phone-removed')).toContainText('Test phone 4');
        }
        if (name === 'limit' || name === 'storeUnwritable') {
          await expect(section.getByRole('button', { name: 'Pair a phone' })).toBeDisabled();
        }
        await expect(section).not.toContainText('jfk_');
        // The paired list fits its box (D136: never sideways), each Remove button inside it.
        const paired = section.getByTestId('phone-paired');
        if ((await paired.locator('table').count()) > 0) {
          const fit = await paired
            .locator('.jf-table__scroll')
            .first()
            .evaluate((el) => ({
              scroll: el.scrollWidth,
              client: el.clientWidth,
              right: el.getBoundingClientRect().right,
              buttons: [...el.querySelectorAll('button[aria-label^="Remove "]')].map(
                (b) => b.getBoundingClientRect().right,
              ),
            }));
          expect(fit.scroll, `${name} at ${width}`).toBeLessThanOrEqual(fit.client);
          for (const right of fit.buttons) expect(right).toBeLessThanOrEqual(fit.right + 0.5);
        }
        await expectNoHorizontalScroll(page);
        await reveal(section);
        await stage9Shot(section, testInfo, `phone-state-${name}-${width}`);
      }
      // The in-page index lists Phone before About.
      // (On a phone the index sits in a closed "Jump to" disclosure, so it is read hidden.)
      const index = page.locator('ul[aria-label="Settings groups"] a');
      // allTextContents does not wait: wait until the index has rendered its Phone entry.
      await expect(index.filter({ hasText: /^s*Phones*$/ })).toHaveCount(1);
      const labels = (await index.allTextContents()).map((t) => t.trim());
      const phoneAt = labels.indexOf('Phone');
      expect(phoneAt, labels.join(' · ')).toBeGreaterThan(-1);
      expect(phoneAt).toBe(labels.indexOf('About') - 1);
      expect(mock.writes()).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('phone: the open code (QR, address notes)', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page);
    const phone = isPhoneProject(testInfo);
    const mock = await mockPhone(page, phoneSections.pairingOpen);
    const width = widthsFor(testInfo).at(-1) ?? 375;
    const section = await openSettings(page, phone ? null : width);
    const block = section.getByTestId('phone-pairing');
    await expect(block).toBeVisible();
    await expect(block.getByTestId('phone-code')).toHaveText('ABCDE-12345');

    // The QR: one path, crispEdges, a module-unit viewBox, a whole number of px per module.
    const qr = block.getByRole('img', { name: 'QR code for pairing a phone' });
    await expect(qr).toBeVisible();
    await expect(qr.locator('path')).toHaveCount(1);
    await expect(qr).toHaveAttribute('shape-rendering', 'crispEdges');
    const viewBox = (await qr.getAttribute('viewBox')) ?? '';
    const modules = Number(viewBox.split(' ')[2]);
    expect(Number.isInteger(modules) && modules >= 29, viewBox).toBe(true);
    const box = await qr.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(modules * (phone ? 3 : 4));
    expect(box!.height).toBe(box!.width);

    // The prefill is this page's own (loopback) origin: the important warning.
    const address = block.getByRole('textbox', { name: 'Address the phone will use' });
    await expect(address).toHaveValue(/^http:\/\/localhost:\d+$/);
    await expect(block).toContainText(WARNING);
    await reveal(section);
    await stage9Shot(section, testInfo, `phone-open-loopback-${width}`);

    // A short name: still the warning; the QR redraws.
    const before = await qr.locator('path').getAttribute('d');
    await address.fill('http://umbrel:4932');
    await expect(block).toContainText(WARNING);
    await expect(qr.locator('path')).not.toHaveAttribute('d', before ?? '');

    // The full Tailscale name: the plain note, no warning.
    await address.fill('http://umbrel.example-tailnet.ts.net:4932');
    await expect(block.getByTestId('phone-address-note')).toHaveText(
      'The phone reaches this over Tailscale.',
    );
    await expect(block).not.toContainText(WARNING);
    await expectNoHorizontalScroll(page);
    await stage9Shot(section, testInfo, `phone-open-tailscale-${width}`);

    // An address with a path: a field error and no QR.
    await address.fill('http://umbrel:4932/settings');
    await expect(block.getByTestId('phone-qr-missing')).toBeVisible();
    await expect(qr).toHaveCount(0);
    await stage9Shot(section, testInfo, `phone-open-invalid-${width}`);

    expect(mock.writes()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('phone: Remove asks first; Cancel sends nothing and returns the focus', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    const phone = isPhoneProject(testInfo);
    const mock = await mockPhone(page, phoneSections.onePhone);
    const width = widthsFor(testInfo).at(-1) ?? 375;
    const section = await openSettings(page, phone ? null : width);
    const remove = section.getByRole('button', { name: 'Remove Android phone' });
    await remove.click();
    await expect(section).toContainText(
      'Remove Android phone? Its app and widgets stop at their next refresh. You can pair it again later.',
    );
    await expectNoHorizontalScroll(page);
    await reveal(section);
    await stage9Shot(section, testInfo, `phone-remove-confirm-${width}`);
    await section.getByRole('button', { name: 'Cancel: keep the phone Android phone' }).click();
    await expect(remove).toBeFocused();
    expect(mock.writes()).toBe(0);
    expect(errors).toEqual([]);
  });
});
