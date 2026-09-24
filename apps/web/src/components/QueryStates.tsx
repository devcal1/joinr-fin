// Loading and error states shared by the data pages (STYLE_GUIDE §6.2 "States", §8 tone).
import { Button, Callout, Icon } from '@joinr/ui';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import type { JSX } from 'react';
import { errorMessage } from '../api/client';

/** A plain status line while a query loads. */
export function Loading({ label }: { label: string }): JSX.Element {
  return (
    <p className="jf-app-loading" role="status">
      <Icon icon={LoaderCircle} className="jf-app-loading__icon" />
      <span>{label}</span>
    </p>
  );
}

export interface LoadErrorProps {
  /** e.g. "Could not load the records". */
  title: string;
  error: unknown;
  onRetry?: () => void;
}

/** A failed query: a "do not" callout with the server's message and a retry button. */
export function LoadError({ title, error, onRetry }: LoadErrorProps): JSX.Element {
  return (
    <Callout kind="do-not" title={title}>
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

/** A missing value in a table or record: a muted dash. */
export function Missing(): JSX.Element {
  return <span className="jf-app-muted">—</span>;
}
