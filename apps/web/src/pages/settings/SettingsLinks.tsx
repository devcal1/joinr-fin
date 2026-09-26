// Links from a page to its settings on the Settings page (stage-5.md §6.5 item 10, D86): one link
// per group of the keys shown, each to `/settings#<group>` (the Settings page scrolls to the group
// and focuses its heading once loaded, §6.1).
import { Link } from '@tanstack/react-router';
import { Fragment, type JSX } from 'react';
import { settingsGroupsOf } from './groupLinks';

/** One link per group of `keys`, joined by `separator`. */
export function SettingsGroupLinks({
  keys,
  separator = ' · ',
}: {
  keys: readonly string[];
  separator?: string;
}): JSX.Element {
  const groups = settingsGroupsOf(keys);
  return (
    <>
      {groups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 ? separator : null}
          <Link to="/settings" hash={group.id}>
            {group.label}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

/** "In Settings: Pay and tax · Budget" under a page's settings section. */
export function InSettingsLine({ keys }: { keys: readonly string[] }): JSX.Element | null {
  if (settingsGroupsOf(keys).length === 0) return null;
  return (
    <p className="jf-app-meta" data-testid="settings-links">
      In Settings: <SettingsGroupLinks keys={keys} />
    </p>
  );
}
