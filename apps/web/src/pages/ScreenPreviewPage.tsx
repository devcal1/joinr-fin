// /preview/screen/$variant: each brand screen at full viewport, outside the shell, for review.
// The router validates `$variant` (unknown → notFound()) and passes it in as a prop.
import { BRAND_SCREEN_TITLES, BrandScreen, Button, Icon, type BrandScreenVariant } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, LogIn, Plus, RotateCcw, type LucideIcon } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { useDocumentTitle } from '../layout/documentTitle';

/** Generic sample copy per variant; the sample buttons do nothing. */
const SAMPLES: Record<
  BrandScreenVariant,
  { message: string; primary?: { label: string; icon: LucideIcon } }
> = {
  loading: { message: 'Getting your figures ready.' },
  empty: {
    message: 'Add your first account and its balance will show up here.',
    primary: { label: 'Add account', icon: Plus },
  },
  error: {
    message: 'This page hit an unexpected error. Try again, or go back to Net Worth.',
    primary: { label: 'Try again', icon: RotateCcw },
  },
  login: {
    message: 'Sign-in is not switched on yet. This preview shows how the screen will look.',
    primary: { label: 'Continue', icon: LogIn },
  },
};

export interface BrandScreenSampleProps {
  variant: BrandScreenVariant;
  /** Default true. The style guide shows contained versions. */
  fullViewport?: boolean;
  headingLevel?: 1 | 2 | 3;
  /** Extra actions after the sample's primary button (e.g. a way back). */
  extraActions?: ReactNode;
}

/** A brand screen filled with generic sample copy (shared by the preview page and the gallery). */
export function BrandScreenSample({
  variant,
  fullViewport = true,
  headingLevel,
  extraActions,
}: BrandScreenSampleProps): JSX.Element {
  const sample = SAMPLES[variant];
  const primary = sample.primary ? (
    <Button variant="primary" icon={sample.primary.icon}>
      {sample.primary.label}
    </Button>
  ) : null;
  return (
    <BrandScreen
      variant={variant}
      message={sample.message}
      fullViewport={fullViewport}
      headingLevel={headingLevel}
      actions={
        primary || extraActions ? (
          <>
            {primary}
            {extraActions}
          </>
        ) : undefined
      }
    />
  );
}

export interface ScreenPreviewPageProps {
  variant: BrandScreenVariant;
}

export function ScreenPreviewPage({ variant }: ScreenPreviewPageProps): JSX.Element {
  useDocumentTitle(`${BRAND_SCREEN_TITLES[variant]} (preview)`);
  return (
    <BrandScreenSample
      variant={variant}
      extraActions={
        <Link to="/styleguide" hash="brand" className="jf-brand-link">
          <Icon icon={ArrowLeft} />
          Back to style guide
        </Link>
      }
    />
  );
}
