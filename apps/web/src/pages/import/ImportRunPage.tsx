// /import/runs/$runId: one run's reconciliation report, filterable by status and section
// (stage-1.md §6.4). It opens on "Needs attention", with the run facts at the top (D32).
import type { ImportRunDetail, ReconciliationCheck, ReconciliationReport } from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  ColumnTable,
  Icon,
  KeyValueTable,
  MEDIA,
  PageHeader,
  SectionBar,
  Select,
  StatTile,
  formatDate,
  useMediaQuery,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { isApiError } from '../../api/client';
import { useImportRun } from '../../api/hooks';
import { Missing, QueryStates } from '../../components/QueryStates';
import { formatDateTime, formatFileSize } from '../../formatting';
import { flagLabel } from '../records/cells';
import {
  CheckStatusBadge,
  NEEDS_REVIEW_LABEL,
  RECONCILED_HINT,
  RunKindPill,
  RunStatusBadge,
} from './ImportBadges';
import {
  CHECK_STATUS_LABELS,
  FILTER_STATUSES,
  filterChecks,
  formatCheckValue,
  isNumericUnit,
  orderSections,
  runTitle,
  sectionLabel,
  sectionStartsOpen,
  statusBreakdown,
  totalChecks,
  type StatusFilter,
} from './checks';

export const NO_MATCHING_CHECKS = 'No checks match these filters.';
export const NOTHING_NEEDS_ATTENTION =
  'Nothing needs attention. Every check matched or is explained.';
export const NEEDS_ATTENTION_LABEL = 'Needs attention';

/** The filter buttons in order: Needs attention (the default) · All · each status. */
const REPORT_FILTERS: readonly StatusFilter[] = ['attention', 'all', ...FILTER_STATUSES];

/** "Needs attention (3)", "All (24)", "Suspect (2)". */
function filterLabel(filter: StatusFilter, count: number): string {
  const name =
    filter === 'attention'
      ? NEEDS_ATTENTION_LABEL
      : filter === 'all'
        ? 'All'
        : CHECK_STATUS_LABELS[filter];
  return `${name} (${count.toLocaleString('en-AU')})`;
}

function reasonCell(check: ReconciliationCheck): ReactNode {
  const refs = [check.refs?.decision, check.refs?.correctionId].filter(Boolean).join(' · ');
  const text = check.reason ?? check.reasonCode?.replace(/_/g, ' ') ?? null;
  if (!text && !refs) return <Missing />;
  return (
    <span className="jf-app-reason">
      {text}
      {refs ? <span className="jf-app-muted"> ({refs})</span> : null}
    </span>
  );
}

/**
 * Expected / Actual / Diff hold figures for most checks but words, codes and dates for others, so
 * the columns are not numeric: figures sit in a right-aligned mono block, dates in inline mono,
 * words in the body face (STYLE_GUIDE §3, §6).
 */
export function CheckValue({
  check,
  field,
}: {
  check: ReconciliationCheck;
  field: 'expected' | 'actual' | 'diff';
}): JSX.Element {
  const value = check[field];
  // A suspect row's value lists its review flags ("out_of_order, price_outlier"): show words.
  const flags = check.refs?.flags;
  const content =
    flags?.length && value === flags.join(', ')
      ? flags.map(flagLabel).join(', ')
      : formatCheckValue(check.unit, value);
  // Figures (and their missing-value dash) line up on the right.
  if (isNumericUnit(check.unit)) return <span className="jf-app-num">{content}</span>;
  if (value === null || value === '') return <>{content}</>;
  if (check.unit === 'date')
    return <span className="jf-app-num jf-app-num--inline">{content}</span>;
  return <span className="jf-app-text-value">{content}</span>;
}

function valueColumn(
  id: 'expected' | 'actual' | 'diff',
  header: string,
): ColumnTableColumn<ReconciliationCheck> {
  return {
    id,
    header,
    value: (check) => check[id],
    cell: (check) => <CheckValue check={check} field={id} />,
  };
}

const CHECK_COLUMN_LIST: ColumnTableColumn<ReconciliationCheck>[] = [
  { id: 'label', header: 'Check', value: (check) => check.label, minWidth: 180 },
  {
    id: 'sheetRef',
    header: 'Sheet ref',
    value: (check) => check.sheetRef,
    cell: (check) =>
      check.sheetRef ? <code className="jf-app-code">{check.sheetRef}</code> : <Missing />,
  },
  valueColumn('expected', 'Expected'),
  valueColumn('actual', 'Actual'),
  valueColumn('diff', 'Diff'),
  {
    id: 'status',
    header: 'Status',
    value: (check) => check.status,
    cell: (check) => <CheckStatusBadge status={check.status} />,
  },
  {
    id: 'reason',
    header: 'Reason',
    value: (check) => check.reason,
    cell: reasonCell,
    minWidth: 200,
  },
];

/** Wider screens: the sheet's reading order. */
const CHECK_COLUMN_ORDER = [
  'label',
  'sheetRef',
  'expected',
  'actual',
  'diff',
  'status',
  'reason',
] as const;

/**
 * Phone (D31): status first, so it shows without scrolling sideways. Diff, Expected and Actual stay
 * the 3rd–5th columns, where app.css right-aligns the value headers.
 */
const PHONE_CHECK_COLUMN_ORDER = [
  'label',
  'status',
  'diff',
  'expected',
  'actual',
  'sheetRef',
  'reason',
] as const;

/** The sticky Check column is narrower on a phone. */
const PHONE_CHECK_MIN_WIDTH = 120;

function checkColumns(
  order: readonly string[],
  phone: boolean,
): ColumnTableColumn<ReconciliationCheck>[] {
  const byId = new Map(CHECK_COLUMN_LIST.map((column) => [column.id, column]));
  return order.flatMap((id) => {
    const column = byId.get(id);
    if (!column) return [];
    return phone && id === 'label' ? [{ ...column, minWidth: PHONE_CHECK_MIN_WIDTH }] : [column];
  });
}

const DESKTOP_COLUMNS = checkColumns(CHECK_COLUMN_ORDER, false);
const PHONE_COLUMNS = checkColumns(PHONE_CHECK_COLUMN_ORDER, true);

function InlineFigure({ text }: { text: string }): JSX.Element {
  return <span className="jf-app-num jf-app-num--inline">{text}</span>;
}

function RunFacts({ run }: { run: ImportRunDetail }): JSX.Element {
  const items: KeyValueItem[] = [
    {
      label: 'Status',
      value: <RunStatusBadge status={run.status} unexplained={run.totals?.unexplained} />,
    },
    { label: 'Kind', value: <RunKindPill dryRun={run.dryRun} /> },
    // One left-aligned value column: only the figures are mono (no right-aligned zig-zag).
    { label: 'Started', value: <InlineFigure text={formatDateTime(run.startedAt)} /> },
    {
      label: 'Finished',
      value: run.finishedAt ? <InlineFigure text={formatDateTime(run.finishedAt)} /> : <Missing />,
    },
    { label: 'From', value: run.trigger === 'cli' ? 'Command line' : 'Upload' },
    { label: 'File', value: `${run.fileName} · ${formatFileSize(run.fileSizeBytes)}` },
    {
      label: 'Workbook as of',
      value: run.workbookAsOf ? <InlineFigure text={formatDate(run.workbookAsOf)} /> : <Missing />,
    },
    { label: 'Corrections', value: run.correctionsName ?? 'None' },
  ];
  return (
    <Card as="section" title="Run" padding="none">
      <KeyValueTable items={items} caption={`Run #${run.id}`} />
    </Card>
  );
}

/** The totals as tiles. Unexplained is the key figure, and says so in words when it is not 0. */
function ReportTiles({ report }: { report: ReconciliationReport }): JSX.Element {
  const totals = report.totals;
  const tiles: { label: string; value: number }[] = [
    { label: 'Checks', value: totalChecks(totals) },
    { label: 'Match', value: totals.match },
    { label: 'Explained', value: totals.explained },
    { label: 'Suspect', value: totals.suspect },
    { label: 'Info', value: totals.info },
  ];
  const unexplained = totals.unexplained.toLocaleString('en-AU');
  return (
    <div className="jf-app-tiles">
      {tiles.map((tile) => (
        <StatTile key={tile.label} label={tile.label} value={tile.value.toLocaleString('en-AU')} />
      ))}
      <StatTile
        label="Unexplained"
        keyFigure
        value={
          totals.unexplained > 0 ? (
            <span className="jf-app-tile-flag">
              <Icon icon={CircleAlert} className="jf-app-tile-flag__icon" />
              {unexplained}
            </span>
          ) : (
            unexplained
          )
        }
        hint={totals.unexplained > 0 ? NEEDS_REVIEW_LABEL : RECONCILED_HINT}
      />
    </div>
  );
}

/** One report section: a section bar with its counts and a disclosure button, then its checks. */
function ReportSection({
  id,
  checks,
  open,
  phone,
  onToggle,
}: {
  id: string;
  checks: readonly ReconciliationCheck[];
  open: boolean;
  phone: boolean;
  onToggle: () => void;
}): JSX.Element {
  const headingId = `report-section-${id}`;
  const bodyId = `report-section-body-${id}`;
  const label = sectionLabel(id);
  return (
    <section className="jf-app-block jf-app-report-section" aria-labelledby={headingId}>
      <SectionBar
        id={headingId}
        title={`${label} · ${checks.length.toLocaleString('en-AU')}`}
        role="supporting"
        level={3}
        actions={
          <>
            <span className="jf-app-meta">{statusBreakdown(checks)}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={open ? ChevronUp : ChevronDown}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${open ? 'Hide' : 'Show'} ${label} checks`}
              onClick={onToggle}
            >
              {open ? 'Hide' : 'Show'}
            </Button>
          </>
        }
      />
      {/* Report-scoped fixed column widths (wide screens), so the sections line up. */}
      <div id={bodyId} className="jf-app-report-table" hidden={!open}>
        {open ? (
          <ColumnTable
            columns={phone ? PHONE_COLUMNS : DESKTOP_COLUMNS}
            rows={checks}
            getRowId={(check) => check.id}
            caption={`${label} checks`}
          />
        ) : null}
      </div>
    </section>
  );
}

function ReportChecks({ report }: { report: ReconciliationReport }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const [status, setStatus] = useState<StatusFilter>('attention');
  const [section, setSection] = useState('');
  // Sections the reader opened or closed; the others follow sectionStartsOpen.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const checks = report.checks;
  const sections = useMemo(() => orderSections(checks.map((check) => check.section)), [checks]);
  const visible = useMemo(() => filterChecks(checks, status, section), [checks, status, section]);
  const groups = useMemo(
    () =>
      orderSections(visible.map((check) => check.section)).map((id) => ({
        id,
        checks: visible.filter((check) => check.section === id),
      })),
    [visible],
  );
  const count = (filter: StatusFilter): number => filterChecks(checks, filter, section).length;
  const allClear = status === 'attention' && groups.length === 0;

  return (
    <section className="jf-app-block" aria-labelledby="report-checks">
      <SectionBar id="report-checks" title="Checks" role="primary" />
      <div className="jf-app-filters">
        <div role="group" aria-label="Filter checks by status" className="jf-app-filters__buttons">
          {REPORT_FILTERS.map((filter) => (
            <Button
              key={filter}
              size="sm"
              variant={status === filter ? 'secondary' : 'ghost'}
              className="jf-app-filter"
              aria-pressed={status === filter}
              onClick={() => setStatus(filter)}
            >
              {filterLabel(filter, count(filter))}
            </Button>
          ))}
        </div>
        <Select
          label="Section"
          className="jf-app-filters__section"
          value={section}
          onChange={setSection}
          options={[
            { value: '', label: 'All sections' },
            ...sections.map((id) => ({ value: id, label: sectionLabel(id) })),
          ]}
        />
      </div>
      {allClear ? (
        <Callout kind="note" title="All clear">
          <p>
            {section
              ? `Nothing in ${sectionLabel(section)} needs attention. Every check there matched or is explained.`
              : NOTHING_NEEDS_ATTENTION}
          </p>
          <p>
            <Button size="sm" onClick={() => setStatus('all')}>
              Show all checks
            </Button>
          </p>
        </Callout>
      ) : groups.length === 0 ? (
        <p className="jf-app-meta">{NO_MATCHING_CHECKS}</p>
      ) : null}
      {groups.map((group) => {
        const open = toggled[group.id] ?? sectionStartsOpen(group.checks, status);
        return (
          <ReportSection
            key={group.id}
            id={group.id}
            checks={group.checks}
            open={open}
            phone={phone}
            onToggle={() => setToggled((current) => ({ ...current, [group.id]: !open }))}
          />
        );
      })}
    </section>
  );
}

export function ImportRunPage({ runId }: { runId: number }): JSX.Element {
  const query = useImportRun(runId);
  const run = query.data;
  return (
    <>
      <PageHeader
        title="Import"
        subtitle={run ? runTitle(run) : `Run #${runId}`}
        actions={
          <Link to="/import" className="jf-app-back-link" activeOptions={{ exact: true }}>
            <Icon icon={ArrowLeft} />
            All imports
          </Link>
        }
      />
      {query.isError && isApiError(query.error) && query.error.status === 404 ? (
        // A missing run: retrying cannot help, so no retry button.
        <Callout kind="note" title="Run not found">
          <p>
            There is no run #{runId}. <Link to="/import">See all imports</Link>.
          </p>
        </Callout>
      ) : (
        <QueryStates
          query={query}
          loading={`Loading run #${runId}…`}
          layout="table"
          errorTitle={`Could not load run #${runId}`}
        />
      )}
      {run ? (
        <>
          {run.status === 'running' ? (
            <Callout kind="note">
              <p>This import is still running. The report appears when it finishes.</p>
            </Callout>
          ) : null}
          {run.status === 'failed' ? (
            <Callout kind="do-not" title="Import failed">
              <p>{run.error?.message ?? 'The import failed.'}</p>
              {run.error?.code ? <p className="jf-app-muted">Code {run.error.code}</p> : null}
            </Callout>
          ) : null}
          {run.dryRun && run.status === 'succeeded' ? (
            <Callout kind="note">
              <p>This was a preview: nothing was saved.</p>
            </Callout>
          ) : null}
          {/* The totals, then the run facts, then the checks (D32). */}
          {run.report ? <ReportTiles report={run.report} /> : null}
          <RunFacts run={run} />
          {run.report ? <ReportChecks report={run.report} /> : null}
        </>
      ) : null}
    </>
  );
}
