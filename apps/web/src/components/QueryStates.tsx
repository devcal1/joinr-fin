// Loading and error states shared by the data pages (STYLE_GUIDE §6.2 "States", §8 tone;
// stage-6.md §6.9 A–B): a first load shows the page's skeleton, a failed first load an `important`
// callout with Try again, and a failed refetch keeps the last figures under a "Couldn't refresh"
// callout. Refetches never show a skeleton (they dim instead).
import { Button, Callout, Grid, GridItem, Icon, Skeleton } from '@joinr/ui';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import type { JSX } from 'react';
import { errorMessage } from '../api/client';
import { REFRESH_ERROR_TITLE, refreshErrorText } from './queryStateText';

/** A plain status line while something small loads (not a page's first load: see PageSkeleton). */
export function Loading({ label }: { label: string }): JSX.Element {
  return (
    <p className="jf-app-loading" role="status">
      <Icon icon={LoaderCircle} className="jf-app-loading__icon" />
      <span>{label}</span>
    </p>
  );
}

export type PageSkeletonLayout = 'dashboard' | 'table' | 'form';

export interface PageSkeletonProps {
  /** The status label, e.g. "Loading net worth…". */
  label: string;
  layout: PageSkeletonLayout;
  /**
   * Also draw the page header's area (the lazy routes' pending wrappers, before the page's own
   * header exists). A page's own first load leaves it out: its real header is already there.
   */
  header?: boolean;
}

/** The field blocks of the `form` layout (a settings group's first row and a half). */
const FORM_FIELDS = 6;

/**
 * A page's first-load skeleton (stage-6.md §6.9 A): the page's layout in `Skeleton` blocks plus a
 * visually hidden status label. `dashboard`: four tile blocks and two card blocks; `table`: a table
 * block; `form`: field blocks. The blocks are hidden from assistive technology; the label speaks.
 */
export function PageSkeleton({ label, layout, header = false }: PageSkeletonProps): JSX.Element {
  return (
    <div className="jf-app-skeleton" data-skeleton-layout={layout} aria-busy="true">
      <p className="jf-visually-hidden" role="status">
        {label}
      </p>
      {header ? (
        <div className="jf-app-skeleton__header" data-testid="skeleton-header">
          <Skeleton variant="text" lines={2} />
        </div>
      ) : null}
      {layout === 'dashboard' ? (
        <>
          <div className="jf-app-tiles jf-app-skeleton__tiles">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="tile" />
            ))}
          </div>
          <Grid>
            <GridItem span={6} spanTablet={6}>
              <Skeleton variant="card" />
            </GridItem>
            <GridItem span={6} spanTablet={6}>
              <Skeleton variant="card" />
            </GridItem>
          </Grid>
        </>
      ) : null}
      {layout === 'table' ? <Skeleton variant="table" /> : null}
      {layout === 'form' ? (
        <Grid>
          {Array.from({ length: FORM_FIELDS }, (_, i) => (
            <GridItem key={i} span={4} spanTablet={3}>
              <Skeleton variant="text" lines={2} />
            </GridItem>
          ))}
        </Grid>
      ) : null}
    </div>
  );
}

export interface LoadErrorProps {
  /** e.g. "Could not load the records". */
  title: string;
  error: unknown;
  onRetry?: () => void;
}

/**
 * A failed first load: an `important` callout with the server's message and a retry button
 * (STYLE_GUIDE §5 keeps "Do not" for destructive actions; stage-6.md §6.9 B).
 */
export function LoadError({ title, error, onRetry }: LoadErrorProps): JSX.Element {
  return (
    <Callout kind="important" title={title}>
      <p>{errorMessage(error)}</p>
      {onRetry ? (
        <p>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
            Try again
          </Button>
        </p>
      ) : null}
    </Callout>
  );
}

export interface RefreshErrorProps {
  error: unknown;
  /** The query's `dataUpdatedAt` (ms since the epoch): when the figures on screen were loaded. */
  updatedAt: number;
  onRetry?: () => void;
}

/** A failed refetch: the page keeps its last figures under this callout (stage-6.md §6.9 B). */
export function RefreshError({ error, updatedAt, onRetry }: RefreshErrorProps): JSX.Element {
  return (
    <Callout kind="important" title={REFRESH_ERROR_TITLE}>
      <p>{refreshErrorText(error, updatedAt, new Date())}</p>
      {onRetry ? (
        <p>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
            Try again
          </Button>
        </p>
      ) : null}
    </Callout>
  );
}

/** The parts of a TanStack query result the page states read. */
export interface PageQueryLike {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

export interface QueryStatesProps {
  query: PageQueryLike;
  /** The skeleton's status label, e.g. "Loading net worth…". */
  loading: string;
  layout: PageSkeletonLayout;
  /** The first-load error's title, e.g. "Could not load net worth". */
  errorTitle: string;
}

/**
 * A page query's states in one place: the skeleton on the first load, `LoadError` when the first
 * load failed, `RefreshError` above the kept figures when a refetch failed, nothing otherwise.
 */
export function QueryStates({
  query,
  loading,
  layout,
  errorTitle,
}: QueryStatesProps): JSX.Element | null {
  const retry = (): void => void query.refetch();
  if (query.isPending) return <PageSkeleton label={loading} layout={layout} />;
  if (!query.isError) return null;
  if (query.data === undefined) {
    return <LoadError title={errorTitle} error={query.error} onRetry={retry} />;
  }
  return <RefreshError error={query.error} updatedAt={query.dataUpdatedAt} onRetry={retry} />;
}

/** A missing value in a table or record: a muted dash. */
export function Missing(): JSX.Element {
  return <span className="jf-app-muted">—</span>;
}
