// The router's defaultErrorComponent: a brand error screen with "Try again".
// Inside the app shell (a page failed) it renders as a contained block, so the header and nav stay
// usable; anywhere else (the shell itself, the root, previews) it takes the full viewport.
import { BrandScreen, Button, Icon } from '@joinr/ui';
import { Link, useMatch, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import type { JSX } from 'react';
import { useDocumentTitle } from '../layout/documentTitle';

const TITLE = 'Something went wrong';

/** Route ids of pages rendered inside the pathless `app` layout (the AppShell) start with this. */
const SHELL_ROUTE_PREFIX = '/app/';

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

export function ErrorPage({ error, reset }: ErrorComponentProps): JSX.Element {
  const router = useRouter();
  const routeId: unknown = useMatch({ strict: false, select: (match) => match.routeId });
  const inShell = typeof routeId === 'string' && routeId.startsWith(SHELL_ROUTE_PREFIX);
  const detail = errorDetail(error);
  // Inside the shell the tab keeps the page name the layout set.
  useDocumentTitle(inShell ? null : TITLE);

  const tryAgain = (): void => {
    reset();
    void router.invalidate();
  };

  return (
    <BrandScreen
      variant="error"
      title={TITLE}
      fullViewport={!inShell}
      message="This page hit an unexpected error. Try again, or go back to Net Worth."
      actions={
        <>
          <Button variant="primary" icon={RotateCcw} onClick={tryAgain}>
            Try again
          </Button>
          <Link to="/" className="jf-brand-link">
            <Icon icon={ArrowLeft} />
            Back to Net Worth
          </Link>
        </>
      }
    >
      {detail ? (
        <details className="jf-brand-details">
          <summary className="jf-brand-details__summary">Technical details</summary>
          <code className="jf-brand-details__code">{detail}</code>
        </details>
      ) : null}
    </BrandScreen>
  );
}
