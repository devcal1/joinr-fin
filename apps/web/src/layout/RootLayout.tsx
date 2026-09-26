// The app frame for every shell page: AppShell + brand block + nav, around the routed page.
// Stage 5 (stage-5.md §6.6): the nav leaves out the pages switched off in Settings (Pages); a
// switched-off page opened by a link still renders, under a note that says so.
import { AppShell, BrandBlock, Callout, MEDIA, useMediaQuery, type AppLinkProps } from '@joinr/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useMemo, type JSX } from 'react';
import { useStatus } from '../api/hooks';
import { pageForPath } from '../pages';
import { useDocumentTitle } from './documentTitle';
import { freshnessOf } from './freshness';
import { SECONDARY_NAV, navFor, pageSwitchedOff, titleForPath } from './nav';

/** Shown above a page that is switched off in Settings (Pages). */
export const SWITCHED_OFF_NOTE = 'This page is switched off in Settings (Pages).';

function SwitchedOffNote(): JSX.Element {
  return (
    <Callout kind="note" title="Page switched off">
      <p>
        {SWITCHED_OFF_NOTE}{' '}
        <Link to="/settings" hash="features">
          Change it in Settings
        </Link>
      </p>
    </Callout>
  );
}

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

  // Sub-routes (/records/trades, /import/runs/7) keep their page's nav item marked.
  const page = pageForPath(pathname);
  const activeHref = page?.path ?? pathname;
  // Loading or failed → the empty text; the header never shows an error (stage-1.md §6.6).
  const { data: status } = useStatus();
  const freshness = freshnessOf(status, new Date());
  const features = status?.features;
  const nav = useMemo(() => navFor(features), [features]);
  const switchedOff = page !== undefined && pageSwitchedOff(page.id, features);

  useDocumentTitle(pageTitle);

  return (
    <AppShell
      brand={<BrandBlock size={compact ? 'sm' : 'md'} />}
      nav={nav}
      secondaryNav={SECONDARY_NAV}
      activeHref={activeHref}
      pageTitle={pageTitle}
      freshness={freshness.header}
      footer={{ version: __APP_VERSION__, right: freshness.footer }}
      linkComponent={RouterLink}
    >
      {switchedOff ? <SwitchedOffNote /> : null}
      <Outlet />
    </AppShell>
  );
}
