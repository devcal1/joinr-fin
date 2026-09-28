// The Settings About block (stage-7.md §6.3): the web build's version, the server's version, the
// database level, the server's time zone and, after a restore, where it came from. When the page
// and the server disagree (an update landed while the tab was open), a note offers a reload. The
// data is `GET /api/backups`'s `app` block and schedule zone; the web version is always known.
import type { BackupsResponse } from '@joinr/schema';
import { Button, Callout, KeyValueTable, SectionBar, type KeyValueItem } from '@joinr/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import type { JSX } from 'react';
import { ABOUT_SECTION_ID, restoredText, versionMismatchText } from './backupsDisplay';

function aboutItems(data: BackupsResponse | undefined): KeyValueItem[] {
  const items: KeyValueItem[] = [{ label: 'App version', value: `v${__APP_VERSION__}` }];
  if (!data) return items;
  items.push(
    { label: 'Server version', value: `v${data.app.version}` },
    { label: 'Database level', value: String(data.app.migrations), numeric: true },
    { label: 'Time zone', value: data.schedule.timeZone },
  );
  if (data.app.restoredFrom) {
    items.push({
      label: 'Restored',
      value: restoredText(data.app.restoredFrom, data.schedule.timeZone),
    });
  }
  return items;
}

export function AboutSection({ query }: { query: UseQueryResult<BackupsResponse> }): JSX.Element {
  const data = query.data;
  const mismatch = data ? versionMismatchText(__APP_VERSION__, data.app.version) : null;
  return (
    <section className="jf-app-block" aria-labelledby={ABOUT_SECTION_ID}>
      <SectionBar id={ABOUT_SECTION_ID} title="About" role="reference" />
      {mismatch ? (
        <Callout kind="note" title="New version">
          <p>{mismatch}</p>
          <p>
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCw}
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </p>
        </Callout>
      ) : null}
      <KeyValueTable caption="About this app" items={aboutItems(data)} />
      {!data && query.isError ? (
        <p className="jf-app-meta">The server’s details could not be loaded (see Backups).</p>
      ) : null}
    </section>
  );
}
