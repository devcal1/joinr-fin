// /import: upload the workbook export (preview or import) and list past runs (stage-1.md §6.4).
import {
  UPLOAD_LIMIT_BYTES,
  type CheckStatus,
  type ImportRunDetail,
  type ImportRunSummary,
} from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Cluster,
  ColumnTable,
  Icon,
  PageHeader,
  SectionBar,
  StatTile,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { CircleAlert, Eye, FileSpreadsheet, Upload } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type JSX, type ReactNode } from 'react';
import { errorMessage, isApiError } from '../../api/client';
import { useImportRuns, useImportWorkbook } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadError, Loading, Missing } from '../../components/QueryStates';
import { formatDateTime, formatFileSize } from '../../formatting';
import { NEEDS_REVIEW_LABEL, RECONCILED_HINT, RunKindPill, RunStatusBadge } from './ImportBadges';
import { totalChecks } from './checks';

export const REPLACE_WARNING =
  'Importing replaces the investments, cash, budget, income, assets and history you imported before. A backup is taken first.';
export const REPLACE_LABEL = 'Replace the imported data';
export const CONFIRM_MESSAGE = 'Tick “Replace the imported data” to import.';
export const NO_FILE_MESSAGE = 'Choose the workbook (.xlsx) first.';
const LIMIT_MB = Math.round(UPLOAD_LIMIT_BYTES / (1024 * 1024));
export const TOO_LARGE_MESSAGE = `The file is larger than the ${LIMIT_MB} MB upload limit.`;
export const NOT_XLSX_MESSAGE = 'Choose an Excel workbook (.xlsx).';
export const APP_DATA_TITLE = 'Import is blocked';
export const APP_DATA_MESSAGE =
  'This app holds data entered in the app, and an import would replace it, so importing from this page is switched off. Preview still works.';
export const APP_DATA_OVERRIDE = 'pnpm import:workbook --yes --replace-app-data';
/** What a re-import keeps (the Stage 3 overlays, stage-3.md §3.4, §6.7). */
export const APP_DATA_KEPT =
  'Savings goals, one-off adjustments and dismissed suggestions are kept by a re-import.';
/** The upload route's answer when app-entered data exists (D34). */
export const APP_DATA_ERROR_CODE = 'IMPORT_APP_DATA_EXISTS';

function isAppDataError(error: unknown): boolean {
  return isApiError(error) && error.code === APP_DATA_ERROR_CODE;
}

/** Why Import is off: app-entered data exists (D34). Only the command line can override. */
function AppDataCallout(): JSX.Element {
  return (
    <Callout kind="do-not" title={APP_DATA_TITLE}>
      <p>{APP_DATA_MESSAGE}</p>
      <p>
        To replace it anyway, import from the command line with <code>{APP_DATA_OVERRIDE}</code>. A
        backup is taken first.
      </p>
      <p>{APP_DATA_KEPT}</p>
    </Callout>
  );
}

const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fileProblem(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return NOT_XLSX_MESSAGE;
  if (file.size > UPLOAD_LIMIT_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

/** The totals of a finished run as tiles, with a link to the full report. */
function RunResult({ run }: { run: ImportRunDetail }): JSX.Element {
  const totals = run.totals;
  const kind = run.dryRun ? 'Preview' : 'Import';
  if (run.status === 'failed' || !totals) {
    return (
      <Callout kind="do-not" title={`${kind} failed`}>
        <p>{run.error?.message ?? 'The import failed.'}</p>
      </Callout>
    );
  }
  return (
    <section className="jf-app-result" aria-label={`${kind} result`}>
      <p className="jf-app-meta">
        {run.dryRun ? 'Preview finished; nothing was saved.' : 'Import finished.'}{' '}
        <Link to="/import/runs/$runId" params={{ runId: String(run.id) }}>
          Open the full report for run #{run.id}
        </Link>
      </p>
      <div className="jf-app-tiles">
        <StatTile label="Checks" value={totalChecks(totals).toLocaleString('en-AU')} />
        <StatTile
          label="Unexplained"
          value={totals.unexplained.toLocaleString('en-AU')}
          keyFigure
          hint={totals.unexplained === 0 ? RECONCILED_HINT : NEEDS_REVIEW_LABEL}
        />
        <StatTile label="Suspect" value={totals.suspect.toLocaleString('en-AU')} />
        <StatTile
          label="Explained"
          value={totals.explained.toLocaleString('en-AU')}
          hint={`${totals.match.toLocaleString('en-AU')} match`}
        />
      </div>
    </section>
  );
}

function ImportCard({
  hasImportedData,
  hasAppData,
  inProgress,
}: {
  hasImportedData: boolean;
  /** App-entered data exists: Import is blocked, Preview still works (D34). */
  hasAppData: boolean;
  inProgress: boolean;
}): JSX.Element {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState(false);
  const mutation = useImportWorkbook();
  const busy = mutation.isPending;
  const pendingDryRun = busy ? (mutation.variables?.dryRun ?? null) : null;

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setProblem(chosen ? fileProblem(chosen) : null);
    mutation.reset();
  };

  const start = (dryRun: boolean): void => {
    if (!file) {
      setProblem(NO_FILE_MESSAGE);
      inputRef.current?.focus();
      return;
    }
    const issue = fileProblem(file);
    if (issue) {
      setProblem(issue);
      return;
    }
    if (hasAppData && !dryRun) return;
    const needsConfirm = hasImportedData && !dryRun;
    if (needsConfirm && !confirmed) {
      setConfirmError(true);
      return;
    }
    setConfirmError(false);
    mutation.mutate(
      { file, dryRun, confirmReplace: needsConfirm && confirmed },
      // The next import asks again.
      { onSuccess: () => setConfirmed(false) },
    );
  };

  return (
    <Card as="section" title="Import a workbook" subtitle="The .xlsx export of the finance sheet">
      <div className="jf-app-form">
        <div className="jf-app-file">
          <label htmlFor={inputId} className="jf-app-file__label">
            Workbook file
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="jf-app-file__input"
            type="file"
            accept={XLSX_ACCEPT}
            onChange={onFile}
            disabled={busy}
            aria-describedby={hintId}
            aria-invalid={problem ? true : undefined}
          />
          <p id={hintId} className="jf-app-file__hint">
            {file ? (
              <>
                <Icon icon={FileSpreadsheet} /> {file.name} · {formatFileSize(file.size)}
              </>
            ) : (
              `Excel .xlsx, up to ${LIMIT_MB} MB.`
            )}
          </p>
          {problem ? (
            <p className="jf-app-error" role="alert">
              <Icon icon={CircleAlert} />
              <span>{problem}</span>
            </p>
          ) : null}
        </div>

        {hasAppData ? <AppDataCallout /> : null}

        {hasImportedData && !hasAppData ? (
          <Callout kind="important">
            <p>{REPLACE_WARNING}</p>
            <Checkbox
              label={REPLACE_LABEL}
              checked={confirmed}
              onChange={(checked) => {
                setConfirmed(checked);
                if (checked) setConfirmError(false);
              }}
              disabled={busy}
            />
            {confirmError ? (
              <p className="jf-app-error" role="alert">
                <Icon icon={CircleAlert} />
                <span>{CONFIRM_MESSAGE}</span>
              </p>
            ) : null}
          </Callout>
        ) : null}

        {inProgress ? (
          <Callout kind="note">
            <p>An import is running. Wait for it to finish before starting another.</p>
          </Callout>
        ) : null}

        <Cluster gap={3}>
          <Button
            variant="secondary"
            icon={Eye}
            onClick={() => start(true)}
            disabled={busy}
            aria-busy={pendingDryRun === true ? true : undefined}
          >
            {pendingDryRun === true ? 'Previewing…' : 'Preview'}
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            onClick={() => start(false)}
            disabled={busy || hasAppData}
            aria-busy={pendingDryRun === false ? true : undefined}
          >
            {pendingDryRun === false ? 'Importing…' : 'Import'}
          </Button>
        </Cluster>
        <p className="jf-app-meta">
          Preview checks the workbook and shows the report without saving anything.
        </p>
      </div>

      {/* Persistent live regions: the outcome is announced when it appears. */}
      <LiveRegion kind="alert" label="Import error" className="jf-app-live--card">
        {/* A 409 when the list had not caught up yet; once it has, the card shows the same note. */}
        {mutation.isError && isAppDataError(mutation.error) && !hasAppData ? (
          <AppDataCallout />
        ) : null}
        {mutation.isError && !isAppDataError(mutation.error) ? (
          <Callout kind="do-not" title="Import failed">
            <p>{errorMessage(mutation.error)}</p>
          </Callout>
        ) : null}
        {mutation.isSuccess && (mutation.data.status === 'failed' || !mutation.data.totals) ? (
          <RunResult run={mutation.data} />
        ) : null}
      </LiveRegion>
      <LiveRegion kind="status" label="Import outcome" className="jf-app-live--card">
        {mutation.isSuccess && mutation.data.status !== 'failed' && mutation.data.totals ? (
          <RunResult run={mutation.data} />
        ) : null}
      </LiveRegion>
    </Card>
  );
}

function count(run: ImportRunSummary, status: CheckStatus): number | null {
  return run.totals ? run.totals[status] : null;
}

function countCell(value: number | null, emphasise = false): ReactNode {
  if (value === null) return <Missing />;
  const text = value.toLocaleString('en-AU');
  return emphasise && value > 0 ? <strong className="jf-app-strong">{text}</strong> : text;
}

const RUN_COLUMNS: ColumnTableColumn<ImportRunSummary>[] = [
  {
    id: 'started',
    header: 'Started',
    value: (run) => run.startedAt,
    cell: (run) => (
      <Link to="/import/runs/$runId" params={{ runId: String(run.id) }}>
        {formatDateTime(run.startedAt)}
      </Link>
    ),
    sortable: true,
    minWidth: 150,
  },
  { id: 'file', header: 'File', value: (run) => run.fileName, sortable: true },
  {
    id: 'kind',
    header: 'Kind',
    value: (run) => (run.dryRun ? 'Dry run' : 'Import'),
    cell: (run) => <RunKindPill dryRun={run.dryRun} />,
  },
  {
    id: 'status',
    header: 'Status',
    value: (run) => run.status,
    cell: (run) => <RunStatusBadge status={run.status} unexplained={count(run, 'unexplained')} />,
  },
  {
    id: 'unexplained',
    header: 'Unexplained',
    value: (run) => count(run, 'unexplained'),
    cell: (run) => countCell(count(run, 'unexplained'), true),
    numeric: true,
  },
  {
    id: 'suspect',
    header: 'Suspect',
    value: (run) => count(run, 'suspect'),
    cell: (run) => countCell(count(run, 'suspect')),
    numeric: true,
  },
  {
    id: 'explained',
    header: 'Explained',
    value: (run) => count(run, 'explained'),
    cell: (run) => countCell(count(run, 'explained')),
    numeric: true,
  },
  {
    id: 'match',
    header: 'Match',
    value: (run) => count(run, 'match'),
    cell: (run) => countCell(count(run, 'match')),
    numeric: true,
  },
];

export function ImportPage(): JSX.Element {
  const runs = useImportRuns();
  return (
    <>
      <PageHeader title="Import" subtitle="Bring in the workbook export" />
      <ImportCard
        hasImportedData={runs.data?.hasImportedData ?? false}
        hasAppData={runs.data?.hasAppData ?? false}
        inProgress={runs.data?.inProgress ?? false}
      />
      <section className="jf-app-block" aria-labelledby="import-runs">
        <SectionBar id="import-runs" title="Runs" role="supporting" />
        {runs.isPending ? <Loading label="Loading the import runs…" /> : null}
        {runs.isError ? (
          <LoadError
            title="Could not load the import runs"
            error={runs.error}
            onRetry={() => void runs.refetch()}
          />
        ) : null}
        {runs.isSuccess ? (
          <ColumnTable
            columns={RUN_COLUMNS}
            rows={runs.data.runs}
            getRowId={(run) => String(run.id)}
            caption="Import runs, newest first"
            emptyMessage="No imports yet."
          />
        ) : null}
      </section>
    </>
  );
}
