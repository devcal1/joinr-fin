// The pages' in-context settings (stage-5.md §6.5 items 10–11, D86): each links to the Settings
// groups of the keys it shows (never one fixed group), every key has one label (the registry's) on
// its page and on the Settings page, and the Super page shows the tax suggestion beside the
// marginal rate.
import { isEditableSettingKey, settingDef, type SettingKey } from '@joinr/schema';
import { settingsPages } from '@joinr/schema/fixtures';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockAssets } from '../../../test/assets';
import { mockCashflow } from '../../../test/cashflow';
import { mockOverview } from '../../../test/history';
import { renderApp } from '../../../test/renderApp';
import { settingsGroupsOf, settingsGroupsText } from './groupLinks';

afterEach(() => {
  vi.restoreAllMocks();
});

const LABELS: ReadonlyMap<string, SettingKey> = new Map(
  settingsPages.populated.settings.map((s) => [settingDef(s.key).label, s.key]),
);

describe('settingsGroupsOf', () => {
  it('derives the groups from the keys, in page order; non-setting inputs are skipped', () => {
    expect(settingsGroupsText(['budget.includeSideIncome', 'pay.frequency'])).toBe(
      'Pay and tax · Budget',
    );
    expect(settingsGroupsOf(['budget.items', 'snapshots'])).toEqual([]);
    expect(settingsGroupsOf(['super.sgRate', 'tax.marginalRate']).map((g) => g.id)).toEqual([
      'pay',
      'super',
    ]);
  });
});

describe.each([
  ['/budget', 'cashflow', 'Pay and tax · Budget', ['pay', 'budget']],
  ['/cash', 'cashflow', 'Cash and savings', ['cash']],
  ['/super', 'assets', 'Pay and tax · Super', ['pay', 'super']],
  ['/property', 'assets', 'Cash and savings', ['cash']],
  ['/other-assets', 'assets', 'Other assets', ['assets']],
] as const)('the %s settings section', (path, mocks, text, ids) => {
  async function open() {
    if (mocks === 'cashflow') {
      mockCashflow({ routes: { 'GET /api/settings': { body: settingsPages.populated } } });
    } else {
      mockAssets({ routes: { 'GET /api/settings': { body: settingsPages.populated } } });
    }
    renderApp(path);
    return screen.findByTestId('settings-links');
  }

  it(`links to its groups: "In Settings: ${text}"`, async () => {
    const line = await open();
    expect(line).toHaveTextContent(`In Settings: ${text}`);
    const links = within(line).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(ids.map((id) => `/settings#${id}`));
  });

  it('names every key by its registry label (one label per key)', async () => {
    const line = await open();
    const section = line.closest('section') as HTMLElement;
    const labels = within(section)
      .getAllByRole('rowheader')
      .map((th) => th.textContent?.trim() ?? '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const key = LABELS.get(label);
      expect(key, `"${label}" is a registry label`).toBeDefined();
      if (key) expect(isEditableSettingKey(key)).toBe(true);
    }
  });
});

describe('the Settings page uses the same labels', () => {
  it('every editable key is labelled with its registry label', async () => {
    mockOverview();
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Pay and tax' });
    // Every field's visible label (a <label> for inputs and switches), read once.
    const shown = new Set(
      [...document.querySelectorAll('main label')].map((l) => l.textContent?.trim() ?? ''),
    );
    for (const dto of settingsPages.populated.settings) {
      if (!dto.editable || dto.lockedBy !== null) continue;
      // The auto-record switch spells out its record hour (D89).
      if (dto.key === 'history.autoRecord') continue;
      const label = settingDef(dto.key).label;
      expect(shown.has(label), label).toBe(true);
    }
  }, 20_000);
});

describe('the Super page tax suggestion line (§6.5 item 10)', () => {
  it('"Suggested 32% for your salary (see Settings: Pay and tax)"', async () => {
    mockAssets({ routes: { 'GET /api/settings': { body: settingsPages.populated } } });
    renderApp('/super');
    const line = await screen.findByTestId('tax-suggestion-line');
    expect(line).toHaveTextContent('Suggested 32% for your salary (see Settings: Pay and tax)');
    expect(within(line).getByRole('link', { name: 'Settings: Pay and tax' })).toHaveAttribute(
      'href',
      '/settings#pay',
    );
  });

  it('hidden without a suggestion', async () => {
    mockAssets({ routes: { 'GET /api/settings': { body: settingsPages.noSalary } } });
    renderApp('/super');
    await screen.findByTestId('settings-links');
    expect(screen.queryByTestId('tax-suggestion-line')).toBeNull();
  });
});
