// The running header's freshness line and the footer's right-hand text (stage-1.md §6.6).
import type { AppStatus } from '@joinr/schema';
import { formatMonth } from '@joinr/ui';
import { formatTimeOrDate } from '../formatting';

export const NO_PRICES = 'No prices yet';
export const NO_SNAPSHOTS = 'No snapshots yet';
export const EMPTY_FRESHNESS = `${NO_PRICES} · ${NO_SNAPSHOTS}`;
export const EMPTY_FOOTER = 'Last snapshot — · Prices —';

export interface Freshness {
  /** "Prices 14:32 · Snapshot Aug 2026" (or the "No … yet" words). */
  header: string;
  /** "Last snapshot Aug 2026 · Prices 14:32" (or dashes). */
  footer: string;
}

function snapshotMonth(latestPeriod: string | null): string | null {
  if (!latestPeriod) return null;
  try {
    return formatMonth(latestPeriod);
  } catch {
    return null;
  }
}

/**
 * The freshness texts for a status. While the status is loading, or when it failed, pass
 * `undefined`: the header then reads "No prices yet · No snapshots yet" (never an error).
 * A price time from today shows as `HH:mm`, an older one as `dd/mm/yyyy`.
 */
export function freshnessOf(status: AppStatus | undefined, now: Date): Freshness {
  if (!status) return { header: EMPTY_FRESHNESS, footer: EMPTY_FOOTER };
  const prices = formatTimeOrDate(status.prices.lastRefreshAt, now);
  const month = status.snapshots.count > 0 ? snapshotMonth(status.snapshots.latestPeriod) : null;
  return {
    header: `${prices ? `Prices ${prices}` : NO_PRICES} · ${month ? `Snapshot ${month}` : NO_SNAPSHOTS}`,
    footer: `Last snapshot ${month ?? '—'} · Prices ${prices ?? '—'}`,
  };
}
