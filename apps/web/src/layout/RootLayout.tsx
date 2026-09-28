// The app frame for every shell page: AppShell + brand block + nav, around the routed page.
// Stage 5 (stage-5.md §6.6): the nav leaves out the pages switched off in Settings (Pages); a
// switched-off page opened by a link still renders, under a note that says so. Stage 7 (stage-7.md
// §6.4): while the backups are stale, an `important` callout above every page links to Backups.
// Stage 8 (stage-8.md §8.4): while the copy to the NAS is overdue, half set up, unusable or locked, a
// second `important` callout (below the backup one) links to Settings → Backups → NAS copy.
import { AppShell, BrandBlock, Callout, MEDIA, useMediaQuery, type AppLinkProps } from '@joinr/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useMemo, type JSX } from 'react';
import { useStatus } from '../api/hooks';
import { pageForPath } from '../pages';
import { OPEN_BACKUPS, STALE_BACKUP_TITLE, backupsStale, staleBackupText } from './backupStale';
import { useDocumentTitle } from './documentTitle';
import { OPEN_NAS_COPY, nasCopyProblem, type NasCopyProblem } from './nasCopyStale';
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

/** Above every page while no nightly or manual backup has succeeded for 48 hours (§6.4). */
function StaleBackupCallout({ lastBackupAt }: { lastBackupAt: string | null }): JSX.Element {
  return (
    <Callout kind="important" title={STALE_BACKUP_TITLE}>
      <p>
        {staleBackupText(lastBackupAt)}{' '}
        <Link to="/settings" hash="backups">
          {OPEN_BACKUPS}
        </Link>
      </p>
    </Callout>
  );
}

/** Above every page while the copy to the NAS needs attention (stage-8.md §8.4). */
function NasCopyCallout({ problem }: { problem: NasCopyProblem }): JSX.Element {
  return (
    <Callout kind="important" title={problem.title}>
      <p>
        {problem.text}{' '}
        <Link to="/settings" hash="nas-copy">
          {OPEN_NAS_COPY}
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
  const nasProblem = nasCopyProblem(status);

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
      {backupsStale(status) ? (
        <StaleBackupCallout lastBackupAt={status?.backups?.lastBackupAt ?? null} />
      ) : null}
      {nasProblem ? <NasCopyCallout problem={nasProblem} /> : null}
      {switchedOff ? <SwitchedOffNote /> : null}
      <Outlet />
    </AppShell>
  );
}
