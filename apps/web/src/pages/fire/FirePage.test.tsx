// The FIRE page (stage-6.md §5, §6.1–6.4, §6.6, §6.9 A, B, G; §7.5 step 3) against the
// @joinr/schema fixtures: every state renders; the tiles with their lines, meters and "Saved:"
// lines; one teal figure; the callouts in order with the cap; the milestone nodes coloured by
// position; the chart views and their tables; the page's skeleton, first-load error, refetch error
// and format checks; "Use the workbook's figure" / "Use the derived figure"; the phone orders.
// The what-if panel has its own file (WhatIfPanel.test.tsx).
import type { FirePageResponse } from '@joinr/schema';
import { apiErrors, firePages, fireSettingsPatchResponse } from '@joinr/schema/fixtures';
import { CHART_PALETTE } from '@joinr/ui';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emulatePhone } from '../../../test/media';
import { mockApi, pending, type MockHandler } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const onTrack = firePages.onTrack;

function fireRoute(fixture: FirePageResponse | MockHandler): MockHandler {
  return typeof fixture === 'function' || 'status' in fixture ? fixture : { body: fixture };
}

function mockFire(fixture: FirePageResponse | MockHandler = onTrack, routes = {}) {
  return mockApi({ 'GET /api/fire': fireRoute(fixture), ...routes });
}

async function openPage(fixture: FirePageResponse = onTrack, routes = {}) {
  const api = mockFire(fixture, routes);
  const view = renderApp('/fire');
  if (fixture.isEmpty) await screen.findByText('Import the workbook or add accounts to plan FIRE');
  else await screen.findByRole('heading', { level: 2, name: 'Year by year' });
  return { ...view, api };
}

function tile(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

/** '#07AE8B' → 'rgb(7, 174, 139)' (jsdom reports inline colours as rgb()). */
function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function legendOf(root: HTMLElement): { name: string; color: string; key: string }[] {
  return [...root.querySelectorAll<HTMLElement>('.jf-chart__legend-item')].map((item) => {
    const key = item.querySelector<HTMLElement>('.jf-chart__legend-key');
    return {
      name: item.textContent?.trim() ?? '',
      color: key?.style.backgroundColor ?? '',
      key: key?.className.replace(/.*jf-chart__legend-key--/, '') ?? '',
    };
  });
}

function pathCard(): HTMLElement {
  return screen.getByRole('region', { name: 'Your path by year' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FIRE: every state renders', () => {
  it.each(Object.entries(firePages))('renders the %s fixture', async (name, fixture) => {
    mockFire(fixture);
    renderApp('/fire');
    expect(await screen.findByRole('heading', { level: 1, name: 'FIRE' })).toBeVisible();
    if (fixture.isEmpty) {
      expect(
        await screen.findByText('Import the workbook or add accounts to plan FIRE'),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Import the workbook' })).toHaveAttribute(
        'href',
        '/import',
      );
      return;
    }
    for (const title of ['Your path', 'What if', 'How it’s worked out', 'Year by year']) {
      expect(await screen.findByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    const main = screen.getByRole('main');
    // stage-6.md §6.8: no page shows "Stage 6"; the standing note is at the foot.
    expect(main).not.toHaveTextContent('Stage 6');
    expect(
      within(main).getByText(
        'A projection in today’s dollars from your settings and recent months, not financial advice.',
      ),
    ).toBeVisible();
    // One teal key figure: the first tile.
    const keys = main.querySelectorAll('.jf-stat-tile--key');
    expect(keys, name).toHaveLength(1);
    expect(keys[0]).toHaveTextContent(/^Years to FIRE/);
  });
});

describe('FIRE: loading and errors (§6.9 A, B)', () => {
  it('shows the page skeleton with its status label on the first load', async () => {
    mockFire(pending);
    renderApp('/fire');
    const label = await screen.findByText('Loading FIRE…');
    expect(label.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Your path' })).toBeNull();
  });

  it('shows the error with Try again on a failed first load', async () => {
    const api = mockFire({ status: 500, body: apiErrors.internal });
    renderApp('/fire');
    const error = await screen.findByRole('note', { name: 'Could not load FIRE' });
    const retry = within(error).getByRole('button', { name: 'Try again' });
    expect(api.calls('GET /api/fire')).toHaveLength(1);
    retry.click();
    await waitFor(() => expect(api.calls('GET /api/fire')).toHaveLength(2));
  });

  it('keeps the figures under a callout when a refetch fails', async () => {
    let fail = false;
    const { queryClient } = await openPage(onTrack, {
      'GET /api/fire': () => (fail ? { status: 500, body: apiErrors.internal } : { body: onTrack }),
    });
    fail = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['fire'] });
    });
    // The app's shared refresh callout (stage-6.md §6.9 B).
    const callout = await screen.findByRole('note', { name: "Couldn't refresh" });
    expect(callout).toHaveTextContent(
      /^Couldn't refresh\s*Internal server error\. Showing the figures from \d{2}:\d{2}\./,
    );
    expect(within(callout).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(tile('Years to FIRE')).toHaveTextContent('1 year');
  });
});

describe('FIRE: the tiles (§6.3 item 3)', () => {
  it('on track: years to FIRE, pre-super with its meter, super with the projection, the spend', async () => {
    await openPage();
    expect(tile('Years to FIRE')).toHaveTextContent('Years to FIRE1 yearFIRE in 2031 · age 56');
    const pre = tile('Pre-super needed at FIRE start');
    expect(pre).toHaveTextContent('$185,039');
    expect(pre).toHaveTextContent('You have $150,000');
    expect(within(pre).getByRole('meter', { name: 'Pre-super progress' })).toBeInTheDocument();
    const sup = tile('Super needed at access');
    expect(sup).toHaveTextContent('$800,000');
    expect(sup).toHaveTextContent('You have $600,000');
    const meter = within(sup).getByRole('meter', { name: 'Super progress' });
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      '$600,000 of $800,000. Projected at 60 $800,000',
    );
    expect(within(sup).getByTestId('meter-marker')).toBeInTheDocument();
    expect(tile('Yearly spend')).toHaveTextContent('$40,000From your last 12 months');
    expect(screen.queryByText('What-if (not saved)')).toBeNull();
  });

  it('FIRE now: the sheet’s words with a FIRE badge', async () => {
    await openPage(firePages.fireNow);
    const first = tile('Years to FIRE');
    expect(first).toHaveTextContent('You’re FIRE');
    expect(within(first).getByText('FIRE').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'go',
    );
  });

  it('not reachable, spend needed and needs input', async () => {
    const { unmount } = await openPage(firePages.notReachable);
    expect(tile('Years to FIRE')).toHaveTextContent('Not by 100At these settings');
    expect(tile('Pre-super needed at FIRE start')).toHaveTextContent(
      '—No FIRE year at these settings',
    );
    unmount();
    const second = await openPage(firePages.spendNeeded);
    expect(tile('Years to FIRE')).toHaveTextContent('—Set a yearly spend');
    expect(tile('Yearly spend')).toHaveTextContent('—');
    second.unmount();
    await openPage(firePages.needsInput);
    expect(tile('Years to FIRE')).toHaveTextContent('—Missing: birth year, withdrawal rate');
    expect(tile('Super needed at access')).toHaveTextContent('—');
  });

  it('a negative pre-super net worth shows in the stop tint with its U+2212', async () => {
    await openPage(firePages.negativePreSuper);
    const line = tile('Pre-super needed at FIRE start').querySelector('.jf-app-fire-tile-line');
    expect(line).toHaveTextContent(/^You have −\$/);
    expect(line?.querySelector('.jf-app-negative')).toHaveTextContent(/^−\$/);
    // The meter's value too (triage STYLE-5).
    const value = tile('Pre-super needed at FIRE start').querySelector('.jf-meter__value');
    expect(value).toHaveTextContent(/^−\$/);
    expect(value).toHaveClass('jf-meter__value--negative');
  });

  it('a what-if adds the badge and a muted "Saved:" line to every tile', async () => {
    await openPage(firePages.whatIf);
    expect(screen.getByText('What-if (not saved)')).toBeVisible();
    const baseline = firePages.whatIf.baseline;
    expect(baseline).not.toBeNull();
    expect(tile('Years to FIRE')).toHaveTextContent(
      `Saved: FIRE in ${baseline?.fireYear} · age ${baseline?.fireAge}`,
    );
    for (const name of [
      'Pre-super needed at FIRE start',
      'Super needed at access',
      'Yearly spend',
    ]) {
      expect(within(tile(name)).getByText(/^Saved: /)).toHaveClass('jf-app-fire-saved');
    }
    expect(tile('Yearly spend')).toHaveTextContent('Saved: $40,000');
  });

  it('a short window says how few months were recorded', async () => {
    await openPage(firePages.shortWindow);
    expect(tile('Yearly spend')).toHaveTextContent(
      'From your last 3 months (only 3 months recorded)',
    );
  });
});

describe('FIRE: callouts (§6.3 item 2)', () => {
  it('needs input: each missing input links to its what-if field or to Settings', async () => {
    await openPage(firePages.needsInput);
    const callout = screen.getByRole('note', { name: 'Inputs needed' });
    expect(callout).toHaveTextContent(
      'Set these to see your FIRE date: birth year, withdrawal rate.',
    );
    expect(within(callout).getByRole('link', { name: 'birth year' })).toHaveAttribute(
      'href',
      '/settings#fire',
    );
    const withdrawal = within(callout).getByRole('link', { name: 'withdrawal rate' });
    withdrawal.click();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Withdrawal rate' }));
  });

  it('the rates link to the Investing settings', async () => {
    await openPage(firePages.needsInputRates);
    const callout = screen.getByRole('note', { name: 'Inputs needed' });
    expect(within(callout).getByRole('link', { name: 'market return' })).toHaveAttribute(
      'href',
      '/settings#investing',
    );
    expect(within(callout).getByRole('link', { name: 'cash interest rate' })).toHaveAttribute(
      'href',
      '/settings#investing',
    );
  });

  it('spend needed uses the sheet’s words first', async () => {
    await openPage(firePages.spendNeeded);
    expect(screen.getByRole('note', { name: 'Yearly spend needed' })).toHaveTextContent(
      /^.*Yearly spend needed\. Your recorded months show no spending to base it on;/,
    );
  });

  it('the notes: the D98 access age, a stale window, the workbook contribution', async () => {
    const first = await openPage(firePages.upgradedAge);
    expect(screen.getByRole('note', { name: 'Access age' })).toHaveTextContent(
      /Access age changed from 65 \(the workbook\) to 60 on \d{1,2} March 2030: 60 is the preservation age/,
    );
    first.unmount();
    const second = await openPage(firePages.staleWindow);
    const stale = screen.getByRole('note', { name: 'Savings figures' });
    expect(stale).toHaveTextContent(/Your savings figures run to \d{1,2} [A-Z][a-z]+ \d{4};/);
    expect(within(stale).getByRole('link')).toHaveAttribute('href', '/history');
    second.unmount();
    await openPage(firePages.workbookContribution);
    expect(screen.getByRole('note', { name: 'Super contribution' })).toHaveTextContent(
      'The workbook’s super contribution a year was $15,000. This page uses $20,000 from your super contributions in the last 12 months.',
    );
  });

  it('shows at most two callouts under the header and moves the rest down', async () => {
    const crowded: FirePageResponse = {
      ...firePages.needsInput,
      inputs: {
        ...firePages.needsInput.inputs,
        accessAge: firePages.upgradedAge.inputs.accessAge,
        superContribution: firePages.workbookContribution.inputs.superContribution,
      },
      derived: firePages.staleWindow.derived,
    };
    await openPage(crowded);
    const main = screen.getByRole('main');
    const worked = screen
      .getByRole('heading', { level: 2, name: 'How it’s worked out' })
      .closest('section') as HTMLElement;
    const titles = (root: HTMLElement): string[] =>
      within(root)
        .queryAllByRole('note')
        .map((n) => n.querySelector('.jf-callout__title')?.textContent ?? '');
    expect(titles(worked)).toEqual(['Savings figures', 'Super contribution']);
    const above = titles(main).filter((t) => !titles(worked).includes(t));
    expect(above.slice(0, 2)).toEqual(['Inputs needed', 'Access age']);
  });

  it('page switched off: the Stage 5 wording with a link to Settings', async () => {
    await openPage(firePages.featureOff);
    const note = screen.getByRole('note', { name: 'Page switched off' });
    expect(note).toHaveTextContent('This page is switched off in Settings (Pages).');
    expect(within(note).getByRole('link')).toHaveAttribute('href', '/settings#features');
  });
});

describe('FIRE: the milestone line (§6.3 item 4, D101)', () => {
  function nodes(): { tone: string; text: string }[] {
    const line = screen.getByRole('group', { name: 'Your FIRE milestones' });
    return [...line.querySelectorAll<HTMLElement>('.jf-milestone-line__node')].map((n) => ({
      tone: n.dataset.tone ?? '',
      text: n.textContent ?? '',
    }));
  }

  it('onTrack: teal → violet → fuchsia → orange with every milestone', async () => {
    await openPage();
    expect(nodes()).toEqual([
      { tone: 'teal', text: 'Today2030 · 55' },
      { tone: 'violet', text: 'FIRE2031 · 56' },
      { tone: 'fuchsia', text: 'Top-ups end2034 · 59' },
      { tone: 'orange', text: 'Access2035 · 60' },
    ]);
    const list = screen.getByRole('group', { name: 'Your FIRE milestones' }).querySelector('ol');
    expect(list?.children).toHaveLength(4);
  });

  it('afterAccess: colour by position (access is second)', async () => {
    await openPage(firePages.afterAccess);
    expect(nodes().map((n) => n.tone)).toEqual(['teal', 'violet', 'fuchsia']);
    expect(nodes()[1]?.text).toMatch(/^Access/);
    expect(nodes()[2]?.text).toMatch(/^FIRE/);
  });

  it('fireAtAccess: FIRE and access share one node', async () => {
    await openPage(firePages.fireAtAccess);
    const merged = nodes().find((n) => n.text.startsWith('FIRE · Access'));
    expect(merged).toBeDefined();
    expect(nodes().map((n) => n.tone)).toEqual(
      ['teal', 'violet', 'fuchsia', 'orange'].slice(0, nodes().length),
    );
  });

  it('FIRE now: no FIRE node; today says so', async () => {
    await openPage(firePages.fireNow);
    expect(nodes()[0]?.text).toBe('Today' + 'You’re FIRE');
    expect(nodes().some((n) => n.text.startsWith('FIRE'))).toBe(false);
  });

  it('access reached: no access node', async () => {
    await openPage(firePages.accessReached);
    expect(nodes().some((n) => n.text.startsWith('Access'))).toBe(false);
  });

  it('is vertical on a phone', async () => {
    emulatePhone();
    await openPage();
    expect(screen.getByRole('group', { name: 'Your FIRE milestones' })).toHaveClass(
      'jf-milestone-line--vertical',
    );
  });
});

describe('FIRE: "Your path by year" (§5)', () => {
  it('Balances: pre-super slot 1 and super slot 6, with a one-line summary', async () => {
    await openPage();
    const card = pathCard();
    expect(within(card).getByText('Balances', { selector: '.jf-card__subtitle' })).toBeVisible();
    expect(
      within(card).getByRole('img', {
        name: 'Pre-super and super balances from 2030 to 2036; FIRE in 2031.',
      }),
    ).toBeInTheDocument();
    expect(legendOf(card)).toEqual([
      { name: 'Pre-super', color: rgbOf(CHART_PALETTE[0] ?? ''), key: 'line' },
      { name: 'Super', color: rgbOf(CHART_PALETTE[5] ?? ''), key: 'line' },
    ]);
    expect(card).toHaveTextContent(
      'In today’s dollars, at each anniversary of today; the year’s saving and spending are counted at its end.',
    );
  });

  it('Needed vs projected: the needed line is dashed in slot 3', async () => {
    const { user } = await openPage();
    const card = pathCard();
    const switcher = within(card).getByRole('group', { name: 'Your path by year: view' });
    await user.click(within(switcher).getByRole('button', { name: 'Needed vs projected' }));
    expect(within(switcher).getByRole('button', { name: 'Needed vs projected' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      within(card).getByRole('img', {
        name: 'Needed and projected pre-super by year; projected first covers needed in 2031.',
      }),
    ).toBeInTheDocument();
    expect(legendOf(card)).toEqual([
      { name: 'Projected pre-super', color: rgbOf(CHART_PALETTE[0] ?? ''), key: 'line' },
      {
        name: 'Needed to stop that year',
        color: rgbOf(CHART_PALETTE[2] ?? ''),
        key: 'dashed-line',
      },
    ]);
  });

  it('the tables: milestones as pills; short by in the stop tint, ahead by in body text', async () => {
    const { user } = await openPage();
    const card = pathCard();
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const balances = within(card).getByRole('table', {
      name: 'Balances by year, in today’s dollars, at each anniversary of today',
    });
    const headers = within(balances)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Year', 'Age', 'Phase', 'Milestone', 'Pre-super', 'Super']);
    const fireRow = within(balances).getByRole('row', { name: /^2031/ });
    expect(within(fireRow).getByText('FIRE')).toHaveClass('jf-pill');
    expect(fireRow).toHaveTextContent('$186,000.00');

    await user.click(within(card).getByRole('button', { name: 'Needed vs projected' }));
    const needed = within(card).getByRole('table', {
      name: 'Needed vs projected by year, in today’s dollars, at each anniversary of today',
    });
    const short = within(needed).getByText('Short by $85,614.58');
    expect(short).toHaveClass('jf-app-negative');
    const ahead = within(needed).getByText('Ahead by $960.84');
    expect(ahead).not.toHaveClass('jf-app-negative');
  });
});

describe('FIRE: how it’s worked out (§6.3 item 6)', () => {
  function section(): HTMLElement {
    return screen
      .getByRole('heading', { level: 2, name: 'How it’s worked out' })
      .closest('section') as HTMLElement;
  }

  it('every money figure in its tables has two decimals (triage STYLE-6)', async () => {
    await openPage();
    const tables = [...section().querySelectorAll('.jf-kv__table')];
    expect(tables.length).toBeGreaterThan(0);
    const figures = tables.flatMap((t) => (t.textContent ?? '').match(/\$[\d,]+(?:\.\d+)?/g) ?? []);
    expect(figures.length).toBeGreaterThan(0);
    // Each whole figure (the match above takes every digit, so a partial match cannot pass).
    expect(figures.filter((f) => !/^\$\d{1,3}(,\d{3})*\.\d{2}$/.test(f))).toEqual([]);
  });

  it('you now, each year and the rates (one decimal; the exact real rate compared)', async () => {
    await openPage();
    const s = section();
    const now = within(s).getByRole('table', { name: 'You now' });
    expect(now).toHaveTextContent('Pre-super net worth$150,000.00');
    const year = within(s).getByRole('table', { name: 'Each year' });
    expect(year).toHaveTextContent(
      'Average over 12 months recorded (to 28 February 2030) × 12; 1 month capped at income; voluntary super contributions ($2,400.00 a year) count in super, not here.',
    );
    expect(year).toHaveTextContent(
      'SG $10,200.00 + your contributions $9,800.00, Mar 2029 – Feb 2030',
    );
    expect(year).toHaveTextContent(
      'Average over 12 months × 12; 1 month with no net spending counted as $0.00.',
    );
    expect(year).toHaveTextContent(
      '$683,843.35 at FIRE start grows to the $800,000.00 needed at 60',
    );
    expect(year).toHaveTextContent('Needed to stop today$235,614.58');
    const rates = within(s).getByRole('table', { name: 'Rates' });
    expect(rates).toHaveTextContent(
      'Cash $30,000.00 at 5.1%, everything else $720,000.00 at 6.1% → 6.1% a year',
    );
    expect(rates).toHaveTextContent('6.1% and 2.0% inflation → 4.0% after inflation (not 4.1%)');
    expect(within(rates).getByText(/after inflation/)).toHaveAttribute('title', '0.04');
    expect(within(rates).getByRole('link', { name: '(from Investing settings)' })).toHaveAttribute(
      'href',
      '/settings#investing',
    );
  });

  it('names a FIRE market return and the debts held in dollars', async () => {
    const first = await openPage(firePages.marketReturnFire);
    expect(within(section()).getByRole('link', { name: '(your FIRE return)' })).toHaveAttribute(
      'href',
      '/settings#fire',
    );
    first.unmount();
    await openPage(firePages.negativePreSuper);
    expect(within(section()).getByRole('table', { name: 'You now' })).toHaveTextContent(
      /Includes your debts \(−\$200,000\.00.*held fixed in dollars/,
    );
  });

  it('lists the months used, a floored month counted as $0 and capped', async () => {
    const { user } = await openPage();
    const s = section();
    await user.click(within(s).getByText('The months used (12 months)'));
    const table = within(s).getByRole('table', { name: 'The months used' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Month', 'Income', 'Spend', 'Counted spend', 'Counted savings']);
    const nov = within(table).getByRole('row', { name: /^Nov 2029/ });
    expect(nov).toHaveTextContent('Counted as $0.00');
    expect(within(nov).getByText('Capped')).toBeInTheDocument();
  });

  it('Use the workbook’s figure: POSTs, then focus moves to the value', async () => {
    const { api, user } = await openPage(firePages.workbookContribution, {
      'POST /api/fire/use-workbook-contribution': { body: fireSettingsPatchResponse },
    });
    await user.click(within(section()).getByRole('button', { name: 'Use the workbook’s figure' }));
    await waitFor(() =>
      expect(api.calls('POST /api/fire/use-workbook-contribution')).toHaveLength(1),
    );
    expect(api.calls('POST /api/fire/use-workbook-contribution')[0]?.body).toBeUndefined();
    await waitFor(() => expect(document.activeElement?.id).toBe('fire-value-superContribution'));
  });

  it('Use the derived figure: PATCHes the override to null, then focus moves to the value', async () => {
    const { api, user } = await openPage(firePages.spendOverride, {
      'PATCH /api/settings': { body: fireSettingsPatchResponse },
    });
    await user.click(within(section()).getByRole('button', { name: 'Use the derived figure' }));
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'fire.yearlySpendOverrideCents': null },
    });
    await waitFor(() => expect(document.activeElement?.id).toBe('fire-value-yearlySpend'));
  });

  it('an app-set super contribution can go back to the derived figure', async () => {
    const { api, user } = await openPage(firePages.superContributionOverride, {
      'PATCH /api/settings': { body: fireSettingsPatchResponse },
    });
    await user.click(within(section()).getByRole('button', { name: 'Use the derived figure' }));
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'fire.superContributionPerYearCents': null },
    });
  });
});

describe('FIRE: year by year (§6.3 item 7, §6.6)', () => {
  function table(): HTMLElement {
    return screen.getByRole('table', { name: /^Year by year, in today’s dollars\./ });
  }

  it('shows every row with outflows carrying U+2212 and the milestone rows marked', async () => {
    await openPage();
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Year',
      'Age',
      'Phase',
      'Pre-super (start)',
      'Saved',
      'Spent',
      'Top-up',
      'Pre-super growth',
      'Pre-super (end)',
      'Super (start)',
      'Contributions + top-ups',
      'Super growth',
      'Withdrawn',
      'Super (end)',
    ]);
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(onTrack.projection.rows.length);
    const r2033 = within(table()).getByRole('row', { name: /^2033/ });
    expect(r2033).toHaveTextContent('Drawing down, topping up super');
    expect(r2033).toHaveTextContent('−$40,000.00');
    expect(r2033).toHaveTextContent('−$2,386.35');
    const r2035 = within(table()).getByRole('row', { name: /^2035/ });
    expect(within(r2035).getByText('Access')).toHaveClass('jf-pill');
    expect(r2035.querySelector('[data-highlight]')).not.toBeNull();
    expect(
      within(table()).getByRole('row', { name: /^2031/ }).querySelector('[data-highlight]'),
    ).not.toBeNull();
    expect(
      within(table()).getByRole('row', { name: /^2032/ }).querySelector('[data-highlight]'),
    ).toBeNull();
  });

  it('runs status first on a phone, as the months used', async () => {
    emulatePhone();
    const { user } = await openPage();
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
        .slice(0, 5),
    ).toEqual(['Year', 'Phase', 'Pre-super (end)', 'Super (end)', 'Age']);
    await user.click(screen.getByText('The months used (12 months)'));
    expect(
      within(screen.getByRole('table', { name: 'The months used' }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Month', 'Counted spend', 'Spend', 'Income', 'Counted savings']);
  });
});

describe('FIRE: number formats (§6.9 G, STYLE_GUIDE §8)', () => {
  const PATTERNS: [string, RegExp][] = [
    ['ASCII minus before a figure', /(^|[\s(])-\$?\d/],
    ['ISO date', /\b\d{4}-\d{2}-\d{2}\b/],
    ['NaN / undefined / Infinity', /NaN|undefined|Infinity|\[object/],
    ['money with one decimal', /\$\d[\d,]*\.\d(?!\d)/],
    ['$-', /\$-/],
  ];

  it.each(Object.entries(firePages))('%s: no format slips', async (_name, fixture) => {
    const { user } = await openPage(fixture);
    const main = screen.getByRole('main');
    const check = (): void => {
      const text = main.textContent ?? '';
      for (const [label, re] of PATTERNS) expect(text, label).not.toMatch(re);
      // Percentages: one decimal, except the real-rate comparison's two (§6.3).
      const percents = text.match(/\d+\.\d{2,}%/g) ?? [];
      const allowed =
        text.match(/\d+\.\d{2}% after inflation \(not \d+\.\d{2}%\)/g)?.join(' ') ?? '';
      for (const p of percents) expect(allowed, p).toContain(p);
    };
    check();
    if (!fixture.isEmpty) {
      await user.click(within(pathCard()).getByRole('button', { name: 'Table' }));
      check();
    }
  });
});
