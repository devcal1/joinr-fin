// The app frame for every shell page: AppShell + brand block + nav, around the routed page.
import { AppShell, BrandBlock, MEDIA, useMediaQuery, type AppLinkProps } from '@joinr/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useDocumentTitle } from './documentTitle';
import { NAV, SECONDARY_NAV, titleForPath } from './nav';

/** Adapts AppShell's plain links to TanStack Router (client-side navigation, preloading). */
function RouterLink({ href, children, ...rest }: AppLinkProps): JSX.Element {
  // Nav hrefs come from the page registry, so they are all registered routes.
  return (
    <Link to={href as '/'} activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  );
}

export function RootLayout(): JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pageTitle = titleForPath(pathname);
  // On a phone the smaller brand block leaves room for the page name in the header row.
  const compact = useMediaQuery(MEDIA.phone);

  useDocumentTitle(pageTitle);

  return (
    <AppShell
      brand={<BrandBlock size={compact ? 'sm' : 'md'} />}
      nav={NAV}
      secondaryNav={SECONDARY_NAV}
      activeHref={pathname}
      pageTitle={pageTitle}
      freshness="No prices yet · No snapshots yet"
      footer={{ version: __APP_VERSION__, right: 'Last snapshot — · Prices —' }}
      linkComponent={RouterLink}
    >
      <Outlet />
    </AppShell>
  );
}
