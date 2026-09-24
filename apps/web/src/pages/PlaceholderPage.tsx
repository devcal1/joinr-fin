// A page that is routed but not built yet: its title, its nav group, and the stage that delivers it.
import { Callout, PageHeader } from '@joinr/ui';
import type { JSX } from 'react';
import { NAV_GROUPS, STAGE_TITLES, type PageDef } from '../pages';

export function PlaceholderPage({ page }: { page: PageDef }): JSX.Element {
  const groupLabel = NAV_GROUPS.find((group) => group.id === page.group)?.label;
  const stageTitle = STAGE_TITLES[page.stage];
  return (
    <>
      <PageHeader title={page.title} subtitle={groupLabel} />
      <Callout kind="note">
        <p>
          {page.title} arrives in Stage {page.stage}
          {stageTitle ? ` — ${stageTitle}` : ''}.
        </p>
      </Callout>
    </>
  );
}
