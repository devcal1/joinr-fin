// Display helpers for import runs and reconciliation checks (stage-1.md §6.4).
import {
  CHECK_STATUSES,
  REPORT_SECTIONS,
  type CheckStatus,
  type CheckUnit,
  type ImportRunSummary,
  type ReconciliationCheck,
  type ReportSection,
} from '@joinr/schema';
import { Amount, formatDate, formatPercent, formatQuantity, isIsoDate } from '@joinr/ui';
import type { ReactNode } from 'react';
import { Missing } from '../../components/QueryStates';
import { RATE_DP_PLACE, formatCount } from '../../formatting';

export const SECTION_LABELS: Readonly<Record<ReportSection, string>> = {
  workbook: 'Workbook',
  counts: 'Row counts',
  holdings: 'Holdings',
  ledgers: 'Ledgers',
  movements: 'Movements',
  dividends: 'Dividends',
  cash: 'Cash',
  income: 'Side income',
  budget: 'Budget',
  other_assets: 'Other assets',
  super: 'Super',
  property: 'Property',
  snapshots: 'Snapshots',
  net_worth: 'Net worth',
  settings: 'Settings',
  exclusions: 'Exclusions',
  corrections: 'Corrections',
  suspects: 'Suspect rows',
};

export function sectionLabel(section: string): string {
  return (SECTION_LABELS as Record<string, string>)[section] ?? section;
}

/** Sections in report order (unknown ones last, in the order they appear). */
export function orderSections(sections: Iterable<string>): string[] {
  const known = REPORT_SECTIONS as readonly string[];
  const unique = [...new Set(sections)];
  const rank = (section: string): number => {
    const index = known.indexOf(section);
    return index === -1 ? known.length : index;
  };
  return unique
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index)
    .map(({ section }) => section);
}

export const CHECK_STATUS_LABELS: Readonly<Record<CheckStatus, string>> = {
  match: 'Match',
  explained: 'Explained',
  suspect: 'Suspect',
  unexplained: 'Unexplained',
  info: 'Info',
};

/** Every CheckStatus in the fixed filter order: Unexplained · Suspect · Explained · Match · Info. */
export const FILTER_STATUSES: readonly CheckStatus[] = [
  'unexplained',
  'suspect',
  'explained',
  'match',
  'info',
];

/** Total checks of a run (all statuses). */
export function totalChecks(totals: Record<CheckStatus, number>): number {
  return CHECK_STATUSES.reduce((sum, status) => sum + (totals[status] ?? 0), 0);
}

function asNumber(value: string | number): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A check's expected / actual / diff, formatted by the check's unit. */
export function formatCheckValue(unit: CheckUnit, value: string | number | null): ReactNode {
  if (value === null || value === '') return <Missing />;
  try {
    switch (unit) {
      case 'cents': {
        const cents = asNumber(value);
        return cents !== null && Number.isSafeInteger(cents) ? (
          <Amount cents={cents} />
        ) : (
          String(value)
        );
      }
      case 'units':
        return formatQuantity(value, { maxDp: 8 });
      case 'ratio': {
        const ratio = asNumber(value);
        return ratio === null ? (
          String(value)
        ) : (
          <span {...RATE_DP_PLACE}>{formatPercent(ratio, { dp: 2 })}</span>
        );
      }
      case 'date':
        return typeof value === 'string' && isIsoDate(value) ? formatDate(value) : String(value);
      case 'count': {
        const count = asNumber(value);
        return count === null ? String(value) : formatCount(count);
      }
      default:
        return String(value);
    }
  } catch {
    return String(value);
  }
}

/** Numeric units are right-aligned and monospaced. */
export function isNumericUnit(unit: CheckUnit): boolean {
  return unit === 'cents' || unit === 'units' || unit === 'ratio' || unit === 'count';
}

/** A run's headline: "Import" / "Dry run" + file. */
export function runTitle(run: Pick<ImportRunSummary, 'id' | 'fileName'>): string {
  return `Run #${run.id} · ${run.fileName}`;
}

/**
 * The status filter on the report page: "Needs attention" (unexplained + suspect, the default,
 * D32), all checks, or one status.
 */
export type StatusFilter = 'attention' | 'all' | CheckStatus;

/** The statuses "Needs attention" shows. */
export const ATTENTION_STATUSES: ReadonlySet<CheckStatus> = new Set(['unexplained', 'suspect']);

/** Statuses that open a report section under "All"; one with only match / info lines is collapsed. */
const NOTABLE_STATUSES: ReadonlySet<CheckStatus> = new Set(['unexplained', 'suspect', 'explained']);

function matchesStatus(check: ReconciliationCheck, status: StatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'attention') return ATTENTION_STATUSES.has(check.status);
  return check.status === status;
}

/** Checks matching the status filter and the section ('' = all sections). */
export function filterChecks(
  checks: readonly ReconciliationCheck[],
  status: StatusFilter,
  section: string,
): ReconciliationCheck[] {
  return checks.filter(
    (check) => matchesStatus(check, status) && (!section || check.section === section),
  );
}

/**
 * Whether a report section starts open (D32). Under "All", only a section whose checks include an
 * explained, suspect or unexplained line; under any other filter every section opens, because the
 * reader picked exactly those lines (choosing Match must not show only collapsed bars).
 */
export function sectionStartsOpen(
  checks: readonly ReconciliationCheck[],
  filter: StatusFilter,
): boolean {
  return filter !== 'all' || checks.some((check) => NOTABLE_STATUSES.has(check.status));
}

/** "3 match · 1 info": a section's checks counted by status, in the filter order. */
export function statusBreakdown(checks: readonly ReconciliationCheck[]): string {
  return FILTER_STATUSES.map((status) => ({
    status,
    count: checks.filter((check) => check.status === status).length,
  }))
    .filter(({ count }) => count > 0)
    .map(
      ({ status, count }) =>
        `${count.toLocaleString('en-AU')} ${CHECK_STATUS_LABELS[status].toLowerCase()}`,
    )
    .join(' · ');
}
