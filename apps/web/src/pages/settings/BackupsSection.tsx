// The Settings Backups section (stage-7.md §6.2, D111, D113, D115): the schedule, the next and last
// run (the frozen §4.3 badge mapping), the space used, the retention line, the uninstall warning,
// "Back up now" with its result, and the newest 12 backups with a "Show all" disclosure, each with a
// download link. Every time is in the server's zone. The section bar renders whatever the query's
// state (the hash target always exists); the section has its own loading and error states, so a
// failure here never blanks the rest of Settings, and a settings failure never hides it.
import type { BackupFileDto, BackupsResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  ColumnTable,
  Icon,
  KeyValueTable,
  MEDIA,
  Pill,
  SectionBar,
  StatusBadge,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { DatabaseBackup, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { errorMessage } from '../../api/client';
import { useBackupNow } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { formatFileSize } from '../../formatting';
import {
  BACKUPS_SECTION_ID,
  BACKUPS_SHOWN,
  UNINSTALL_WARNING_LEAD,
  UNINSTALL_WARNING_STRONG,
  UNINSTALL_WARNING_TAIL,
  backupNowText,
  downloadHref,
  downloadLabel,
  emptyText,
  formatServerDateTime,
  kindLabel,
  lastRunView,
  nextRunText,
  retentionText,
  scheduleText,
  serverMonth,
  showAllText,
  showsMonthlyPill,
  spaceText,
} from './backupsDisplay';
import './backups.css';

const TABLE_ID = 'backups-table';

type BackupResult = { kind: 'done'; text: string } | { kind: 'error'; message: string } | null;

function LastRun({ data }: { data: BackupsResponse }): JSX.Element {
  const view = lastRunView(data.lastRun, data.schedule.timeZone);
  if (!view) return <span data-testid="backups-last-run">No backup has run yet</span>;
  return (
    <span className="jf-app-backups-run" data-testid="backups-last-run">
      <span>{view.at}</span>
      <StatusBadge status={view.status} label={view.label} />
      {view.reason ? <span className="jf-app-muted">{view.reason}</span> : null}
      {view.error ? <span className="jf-app-backups-error">{view.error}</span> : null}
    </span>
  );
}

function KindCell({ file, currentMonth }: { file: BackupFileDto; currentMonth: string }) {
  return (
    <span className="jf-app-backups-kind">
      <Pill>{kindLabel(file)}</Pill>
      {file.keptAs === 'future' ? (
        <Pill tone="na">Future date</Pill>
      ) : showsMonthlyPill(file, currentMonth) ? (
        <Pill>Monthly</Pill>
      ) : null}
    </span>
  );
}

function DownloadLink({
  file,
  timeZone,
  iconOnly,
}: {
  file: BackupFileDto;
  timeZone: string;
  iconOnly: boolean;
}): JSX.Element {
  return (
    <a
      className={[
        'jf-button jf-button--secondary jf-button--sm jf-app-backups-download',
        iconOnly ? 'jf-button--icon' : '',
      ].join(' ')}
      href={downloadHref(file.name)}
      download
      aria-label={downloadLabel(file, timeZone)}
      title={file.name}
    >
      <Icon icon={Download} />
      {iconOnly ? null : <span className="jf-button__label">Download</span>}
    </a>
  );
}

function BackupsTable({ data }: { data: BackupsResponse }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const [expanded, setExpanded] = useState(false);
  const { timeZone } = data.schedule;
  const currentMonth = serverMonth(new Date(), timeZone);
  const count = data.backups.length;
  const rows = expanded ? data.backups : data.backups.slice(0, BACKUPS_SHOWN);

  const columns = useMemo<ColumnTableColumn<BackupFileDto>[]>(() => {
    const when: ColumnTableColumn<BackupFileDto> = {
      id: 'when',
      header: 'When',
      value: (file) => file.createdAt,
      cell: (file) => (
        <span className="jf-app-backups-when">
          <span>{formatServerDateTime(file.createdAt, timeZone)}</span>
          {phone ? (
            <span className="jf-app-backups-when__size">{formatFileSize(file.sizeBytes)}</span>
          ) : null}
        </span>
      ),
    };
    const kind: ColumnTableColumn<BackupFileDto> = {
      id: 'kind',
      header: 'Kind',
      value: (file) => kindLabel(file),
      cell: (file) => <KindCell file={file} currentMonth={currentMonth} />,
    };
    const size: ColumnTableColumn<BackupFileDto> = {
      id: 'size',
      header: 'Size',
      numeric: true,
      value: (file) => file.sizeBytes,
      cell: (file) => formatFileSize(file.sizeBytes),
    };
    const download: ColumnTableColumn<BackupFileDto> = {
      id: 'download',
      header: 'Download',
      value: () => null,
      cell: (file) => <DownloadLink file={file} timeZone={timeZone} iconOnly={phone} />,
    };
    // Phone (D31): status first, no Size column (the size sits under the time).
    return phone ? [when, kind, download] : [when, kind, size, download];
  }, [phone, timeZone, currentMonth]);

  return (
    <>
      <div id={TABLE_ID} data-testid="backups-table">
        <ColumnTable
          caption="Backups"
          columns={columns}
          rows={rows}
          getRowId={(file) => file.name}
          emptyMessage={emptyText(data.schedule)}
        />
      </div>
      {count > BACKUPS_SHOWN ? (
        <Button
          variant="ghost"
          size="sm"
          className="jf-app-backups-more"
          aria-expanded={expanded}
          aria-controls={TABLE_ID}
          onClick={() => setExpanded((open) => !open)}
        >
          {showAllText(expanded, count)}
        </Button>
      ) : null}
    </>
  );
}

function BackupNow({ data }: { data: BackupsResponse }): JSX.Element {
  const mutation = useBackupNow();
  const [result, setResult] = useState<BackupResult>(null);
  const busy = mutation.isPending || data.running;
  const { timeZone } = data.schedule;
  const actionsRef = useRef<HTMLDivElement>(null);
  /** The button had the keyboard focus when it was pressed (disabling it drops the focus). */
  const refocus = useRef(false);

  // Give the focus back once the button is enabled again (Fixer A11Y-1: a disabled button loses
  // it to <body>, so a keyboard or screen-reader user would lose their place).
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      actionsRef.current?.querySelector('button')?.focus();
    }
  }, [busy]);

  const run = (): void => {
    if (busy) return;
    refocus.current = actionsRef.current?.contains(document.activeElement) ?? false;
    setResult(null);
    mutation.mutate(undefined, {
      onSuccess: (response) => setResult({ kind: 'done', text: backupNowText(response, timeZone) }),
      onError: (error) => setResult({ kind: 'error', message: errorMessage(error) }),
    });
  };

  return (
    <div className="jf-app-block jf-app-backups-now">
      <div className="jf-app-backups-actions" ref={actionsRef}>
        <Button
          variant="secondary"
          icon={DatabaseBackup}
          disabled={busy}
          aria-busy={busy}
          onClick={run}
        >
          {busy ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>
      <LiveRegion kind="status" label="Backup result">
        {result?.kind === 'done' ? (
          <Callout kind="note" title="Backed up">
            <p>{result.text}</p>
          </Callout>
        ) : result?.kind === 'error' ? (
          <Callout kind="do-not" title="Not backed up">
            <p>{result.message}</p>
          </Callout>
        ) : null}
      </LiveRegion>
    </div>
  );
}

function BackupsBody({ data }: { data: BackupsResponse }): JSX.Element {
  const { schedule } = data;
  return (
    <>
      <KeyValueTable
        caption="Backup schedule"
        items={[
          {
            label: 'Schedule',
            value: <span data-testid="backups-schedule">{scheduleText(schedule)}</span>,
          },
          { label: 'Next', value: <span data-testid="backups-next">{nextRunText(schedule)}</span> },
          { label: 'Last run', value: <LastRun data={data} /> },
          {
            label: 'Space',
            value: (
              <span data-testid="backups-space">
                {spaceText(data.totalBytes, data.backups.length, data.freeBytes)}
              </span>
            ),
          },
        ]}
      />
      <p className="jf-app-meta jf-app-backups-retention" data-testid="backups-retention">
        {retentionText(data.retention)}
      </p>
      <Callout kind="important" title="Stored on the server">
        <p>
          {UNINSTALL_WARNING_LEAD} <strong>{UNINSTALL_WARNING_STRONG}</strong>{' '}
          {UNINSTALL_WARNING_TAIL}
        </p>
      </Callout>
      <BackupNow data={data} />
      <BackupsTable data={data} />
    </>
  );
}

export function BackupsSection({ query }: { query: UseQueryResult<BackupsResponse> }): JSX.Element {
  return (
    <section className="jf-app-block" aria-labelledby={BACKUPS_SECTION_ID}>
      <SectionBar id={BACKUPS_SECTION_ID} title="Backups" role="reference" />
      <QueryStates
        query={query}
        loading="Loading backups…"
        layout="table"
        errorTitle="Could not load backups"
      />
      {query.data ? <BackupsBody data={query.data} /> : null}
    </section>
  );
}
