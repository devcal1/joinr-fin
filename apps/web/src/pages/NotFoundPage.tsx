// Any unmatched path (router notFoundComponent, outside the shell): a full-viewport brand screen.
import { BrandScreen, Icon } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { JSX } from 'react';
import { useDocumentTitle } from '../layout/documentTitle';

const TITLE = 'Page not found';

export function NotFoundPage(): JSX.Element {
  useDocumentTitle(TITLE);
  return (
    <BrandScreen
      variant="error"
      title={TITLE}
      message="There's no page at this address. It may have moved, or the link has a typo."
      actions={
        <Link to="/" className="jf-brand-link">
          <Icon icon={ArrowLeft} />
          Back to Net Worth
        </Link>
      }
    />
  );
}
