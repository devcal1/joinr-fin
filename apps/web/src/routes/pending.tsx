// The lazy routes' pending wrappers (stage-6.md §6.1, §6.9 A): while a route's chunk loads, the
// router shows `PageSkeleton` with that route's layout (the same layout the page's own first-load
// skeleton uses, so a cold navigation never swaps skeleton shapes) plus the header's area.
import type { JSX } from 'react';
import { PageSkeleton, type PageSkeletonProps } from '../components/QueryStates';

type Skeleton = Pick<PageSkeletonProps, 'label' | 'layout'>;

/** Every lazy route's pending skeleton, by route path (a web test compares each with its page). */
export const ROUTE_SKELETONS = {
  '/': { label: 'Loading net worth…', layout: 'dashboard' },
  '/history': { label: 'Loading history…', layout: 'dashboard' },
  '/stocks': { label: 'Loading stocks…', layout: 'dashboard' },
  '/etfs': { label: 'Loading ETFs…', layout: 'dashboard' },
  '/managed-funds': { label: 'Loading managed funds…', layout: 'dashboard' },
  '/crypto': { label: 'Loading crypto holdings…', layout: 'dashboard' },
  '/stocks/$instrumentId': { label: 'Loading the holding…', layout: 'dashboard' },
  '/etfs/$instrumentId': { label: 'Loading the holding…', layout: 'dashboard' },
  '/managed-funds/$instrumentId': { label: 'Loading the holding…', layout: 'dashboard' },
  '/crypto/$instrumentId': { label: 'Loading the holding…', layout: 'dashboard' },
  '/cash': { label: 'Loading cash…', layout: 'dashboard' },
  '/side-income': { label: 'Loading side income…', layout: 'dashboard' },
  '/dividends': { label: 'Loading dividends…', layout: 'dashboard' },
  '/budget': { label: 'Loading the budget…', layout: 'dashboard' },
  '/other-assets': { label: 'Loading other assets…', layout: 'dashboard' },
  '/super': { label: 'Loading super…', layout: 'dashboard' },
  '/property': { label: 'Loading property…', layout: 'dashboard' },
  '/fire': { label: 'Loading FIRE…', layout: 'dashboard' },
  '/records': { label: 'Loading the record tables…', layout: 'table' },
  '/records/$entity': { label: 'Loading the records…', layout: 'table' },
  '/import': { label: 'Loading the import runs…', layout: 'table' },
  '/import/runs/$runId': { label: 'Loading the run…', layout: 'table' },
  '/prices': { label: 'Loading prices…', layout: 'table' },
  '/settings': { label: 'Loading settings…', layout: 'form' },
  '/styleguide': { label: 'Loading the style guide…', layout: 'dashboard' },
} as const satisfies Record<string, Skeleton>;

export type SkeletonRoutePath = keyof typeof ROUTE_SKELETONS;

/** A no-props pending component for a route (the router calls it with no props). */
export function pendingFor(path: SkeletonRoutePath): () => JSX.Element {
  const { label, layout } = ROUTE_SKELETONS[path];
  function RoutePending(): JSX.Element {
    return <PageSkeleton label={label} layout={layout} header />;
  }
  RoutePending.displayName = `RoutePending(${path})`;
  return RoutePending;
}
