import { appStatusEmpty, appStatusPopulated } from '@joinr/schema/fixtures';
import { formatDate, formatTime } from '@joinr/ui';
import { describe, expect, it } from 'vitest';
import { EMPTY_FOOTER, EMPTY_FRESHNESS, freshnessOf } from './freshness';

const refreshedAt = new Date(appStatusPopulated.prices.lastRefreshAt);

describe('freshnessOf', () => {
  it('reads "No prices yet · No snapshots yet" while loading or on error', () => {
    expect(freshnessOf(undefined, new Date())).toEqual({
      header: 'No prices yet · No snapshots yet',
      footer: 'Last snapshot — · Prices —',
    });
    expect(EMPTY_FRESHNESS).toBe('No prices yet · No snapshots yet');
    expect(EMPTY_FOOTER).toBe('Last snapshot — · Prices —');
  });

  it('reads the same on an empty database', () => {
    expect(freshnessOf(appStatusEmpty, new Date())).toEqual({
      header: EMPTY_FRESHNESS,
      footer: EMPTY_FOOTER,
    });
  });

  it('shows the price time when it is today, and the snapshot month', () => {
    const now = new Date(refreshedAt.getTime() + 60_000);
    const time = formatTime(refreshedAt);
    expect(freshnessOf(appStatusPopulated, now)).toEqual({
      header: `Prices ${time} · Snapshot Aug 2026`,
      footer: `Last snapshot Aug 2026 · Prices ${time}`,
    });
  });

  it('shows the price date when it is older than today', () => {
    const now = new Date(refreshedAt.getTime() + 3 * 24 * 3600 * 1000);
    const date = formatDate(refreshedAt);
    expect(freshnessOf(appStatusPopulated, now).header).toBe(`Prices ${date} · Snapshot Aug 2026`);
  });

  it('handles prices without snapshots and snapshots without prices', () => {
    const now = new Date(refreshedAt.getTime() + 60_000);
    expect(
      freshnessOf({ ...appStatusPopulated, snapshots: { count: 0, latestPeriod: null } }, now)
        .header,
    ).toBe(`Prices ${formatTime(refreshedAt)} · No snapshots yet`);
    const noPrices = {
      ...appStatusPopulated,
      prices: { ...appStatusPopulated.prices, lastRefreshAt: null },
    };
    expect(freshnessOf(noPrices, now)).toEqual({
      header: 'No prices yet · Snapshot Aug 2026',
      footer: 'Last snapshot Aug 2026 · Prices —',
    });
  });
});
