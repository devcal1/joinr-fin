// The header height token (triage STYLE-2): below 768 px the header has two rows (56 px + the
// freshness line), so --shell-header-h is 88px there and 64px from 768 px. Sticky offsets (the
// FIRE result strip) and the phone scroll padding read the token; the e2e checks the geometry.
import { afterEach, describe, expect, it } from 'vitest';
import { installUiCss, readUiCss } from './testing/cssHarness';

let removeCss: (() => void) | undefined;
afterEach(() => {
  removeCss?.();
  removeCss = undefined;
});

const headerHeight = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--shell-header-h').trim();

describe('--shell-header-h', () => {
  it('is 88px on a phone and 64px from 768 px', () => {
    removeCss = installUiCss(['tokens'], { viewportWidth: 375 });
    expect(headerHeight()).toBe('88px');
    removeCss();
    removeCss = installUiCss(['tokens'], { viewportWidth: 1024 });
    expect(headerHeight()).toBe('64px');
  });

  it('the phone scroll padding comes from the token, not a hard-coded figure', () => {
    removeCss = installUiCss(['tokens', 'base'], { viewportWidth: 375 });
    expect(getComputedStyle(document.documentElement).scrollPaddingTop).toBe(
      'calc(var(--spectrum-h) + var(--shell-header-h) + var(--space-2))',
    );
    expect(readUiCss('base')).not.toMatch(/\+\s*96px/);
  });
});
