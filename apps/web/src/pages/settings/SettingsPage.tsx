// The Settings page (stage-5.md §6.5, D84–D87, D91, D95): every setting grouped by area, one
// reference section per group (`/settings#<group>` scrolls there and focuses its heading once
// loaded), an in-page index (a "Jump to" disclosure on a phone, never a navigating select), and a
// form per group with its own Save. The pages keep their in-context forms; both edit the same
// values (D86).
import type { SettingsPageResponse } from '@joinr/schema';
import { Callout, MEDIA, PageHeader, SectionBar, useMediaQuery } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useSettingsPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { useHashTarget } from '../history/useHashTarget';
import { SettingsGroupForm, type SettingsGroup } from './SettingsGroupForm';

/** The groups in page order with their settings in registry order. */
function groupsOf(page: SettingsPageResponse): SettingsGroup[] {
  return page.groups.map((group) => ({
    id: group.id,
    label: group.label,
    settings: group.keys.flatMap((key) => {
      const dto = page.settings.find((s) => s.key === key);
      return dto ? [dto] : [];
    }),
  }));
}

function GroupIndex({ groups }: { groups: readonly SettingsGroup[] }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const links = (
    <ul className="jf-app-settings-index" aria-label="Settings groups">
      {groups.map((group) => (
        <li key={group.id}>
          <a href={`#${group.id}`}>{group.label}</a>
        </li>
      ))}
    </ul>
  );
  if (phone) {
    return (
      <details className="jf-app-details" data-testid="settings-jump">
        <summary className="jf-app-details__summary">Jump to</summary>
        {links}
      </details>
    );
  }
  return <nav aria-label="On this page">{links}</nav>;
}

export function SettingsPage(): JSX.Element {
  const query = useSettingsPage();
  const page = query.data;
  const [notice, setNotice] = useState<string | null>(null);
  useHashTarget(page !== undefined);
  const groups = page ? groupsOf(page) : [];
  return (
    <>
      <PageHeader title="Settings" subtitle="App" />
      <QueryStates
        query={query}
        loading="Loading settings…"
        layout="form"
        errorTitle="Could not load settings"
      />
      {page ? (
        <>
          <GroupIndex groups={groups} />
          <LiveRegion kind="status" label="Save result">
            {notice ? (
              <Callout kind="note" title="Saved">
                <p>{notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          {groups.map((group) => (
            <section key={group.id} className="jf-app-block" aria-labelledby={group.id}>
              <SectionBar id={group.id} title={group.label} role="reference" />
              <SettingsGroupForm group={group} page={page} onSaved={setNotice} />
            </section>
          ))}
        </>
      ) : null}
    </>
  );
}
