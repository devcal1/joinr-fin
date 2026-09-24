// Status badges for prices and market series (stage-1.md §6.5): always an icon and a word.
import type { MarketQuoteStatus, PriceStatus } from '@joinr/schema';
import { StatusBadge } from '@joinr/ui';
import type { JSX } from 'react';

/** fresh → fresh · stale → stale · failed → failed · none → failed "No price" · manual → go "Manual". */
export function PriceStatusBadge({ status }: { status: PriceStatus }): JSX.Element {
  switch (status) {
    case 'fresh':
      return <StatusBadge status="fresh" />;
    case 'stale':
      return <StatusBadge status="stale" />;
    case 'failed':
      return <StatusBadge status="failed" />;
    case 'manual':
      return <StatusBadge status="go" label="Manual" />;
    default:
      return <StatusBadge status="failed" label="No price" />;
  }
}

/**
 * A market series: fresh / stale / failed, or a neutral "Not fetched" before its first fetch
 * (nothing has failed yet; a fresh install or mode off shows this, not a red failure).
 */
export function SeriesStatusBadge({ status }: { status: MarketQuoteStatus }): JSX.Element {
  switch (status) {
    case 'fresh':
      return <StatusBadge status="fresh" />;
    case 'stale':
      return <StatusBadge status="stale" />;
    case 'failed':
      return <StatusBadge status="failed" />;
    default:
      return <StatusBadge status="pending" label="Not fetched" />;
  }
}
