// The Settings page (stage-5.md §6.5, D84–D87, D91, D95): every setting grouped by area, one
// reference section per group (`/settings#<group>` scrolls there and focuses its heading once
// loaded), an in-page index (a "Jump to" disclosure on a phone, never a navigating select), and a
// form per group with its own Save. The pages keep their in-context forms; both edit the same
// values (D86). Stage 7 (stage-7.md §6.2, §6.3): the Backups and About sections follow the groups, each
// with its own query states, and render whatever the settings query does (so `#backups` and `#about`
// always exist); the hash target waits for both queries to settle. Stage 8 (stage-8.md §8.3): the
// index gains "NAS copy" (`#nas-copy`, the NAS block's subheading inside Backups). Stage 9
// (stage-9.md §8.1, §8.2): the Phone section sits between Backups and About, with its own query
// (`#phone`, before About in the index); the hash target waits for the phone query too.
import type { SettingsPageResponse } from '@joinr/schema';
import { Callout, MEDIA, PageHeader, SectionBar, useMediaQuery } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useBackups, usePhone, useSettingsPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { useHashTarget } from '../history/useHashTarget';
import { AboutSection } from './AboutSection';
import { BackupsSection } from './BackupsSection';
import { ABOUT_SECTION_ID, BACKUPS_SECTION_ID } from './backupsDisplay';
import { NAS_COPY_INDEX_LABEL, NAS_COPY_SECTION_ID } from './nasCopyDisplay';
import { PhoneSection } from './PhoneSection';
import { PHONE_INDEX_LABEL, PHONE_SECTION_ID } from './phoneDisplay';
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

/** The in-page index: every group, then Backups, NAS copy (stage-8.md §8.3), Phone and About. */
function GroupIndex({ groups }: { groups: readonly SettingsGroup[] }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const entries: { id: string; label: string }[] = [
    ...groups.map((group) => ({ id: group.id, label: group.label })),
    { id: BACKUPS_SECTION_ID, label: 'Backups' },
    { id: NAS_COPY_SECTION_ID, label: NAS_COPY_INDEX_LABEL },
    { id: PHONE_SECTION_ID, label: PHONE_INDEX_LABEL },
    { id: ABOUT_SECTION_ID, label: 'About' },
  ];
  const links = (
    <ul className="jf-app-settings-index" aria-label="Settings groups">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a href={`#${entry.id}`}>{entry.label}</a>
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
  const backups = useBackups();
  const phone = usePhone();
  const [notice, setNotice] = useState<string | null>(null);
  // Every query settled (loaded or failed), so a target lower down does not drift as the page grows.
  const settingsSettled = !query.isPending;
  useHashTarget(settingsSettled && !backups.isPending && !phone.isPending);
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
      {settingsSettled ? <GroupIndex groups={groups} /> : null}
      {page ? (
        <>
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
      <BackupsSection query={backups} />
      <PhoneSection query={phone} timeZone={backups.data?.schedule.timeZone} />
      <AboutSection query={backups} />
    </>
  );
}
