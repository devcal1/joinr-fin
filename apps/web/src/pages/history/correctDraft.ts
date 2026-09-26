// The correction form's model (stage-5.md §4.3, §6.4 item 5, UX-5): one money field per
// correctable column in the History header groups; "Mortgage owed" and "Accounts in debit (owed)"
// are entered as positive amounts and negated before sending; the offset extras are read-only on an
// imported month (the server refuses them) and required on any other; Save sends only the changed
// columns. Pure functions, no React.
import {
  CASHFLOW_MONEY_MAX,
  SNAPSHOT_OFFSET_EXTRAS,
  type CorrectableSnapshotColumn,
  type SnapshotCorrectionBody,
  type SnapshotDto,
} from '@joinr/schema';
import { columnLabel } from './display';

export interface CorrectGroup {
  title: string;
  columns: readonly CorrectableSnapshotColumn[];
}

/** The correctable columns in the History header groups (the Details groups, §6.4 item 5). */
export const CORRECT_GROUPS: readonly CorrectGroup[] = [
  {
    title: 'Investments',
    columns: [
      'stocksValueCents',
      'stocksGainCents',
      'etfValueCents',
      'etfGainCents',
      'cryptoValueCents',
      'cryptoGainCents',
      'mfValueCents',
      'mfGainCents',
    ],
  },
  {
    title: 'Cash',
    columns: ['cashValueCents', 'cashDebtCents', 'offsetCents', 'mortgageOffsetCents'],
  },
  { title: 'Super', columns: ['superValueCents', 'superContribCents', 'superGainCents'] },
  {
    title: 'Property',
    columns: [
      'propertyValueCents',
      'propertyPurchaseCents',
      'propertyGainCents',
      'mortgageBalanceCents',
      'mortgageInterestFeesCents',
      'mortgagePrincipalPaidCents',
    ],
  },
  { title: 'Other assets', columns: ['otherValueCents', 'otherGainCents'] },
  { title: 'Pay', columns: ['salaryMonthlyCents'] },
];

/** Stored ≤ 0, entered and shown as a positive "owed" amount. */
export const OWED_COLUMNS: ReadonlySet<CorrectableSnapshotColumn> = new Set([
  'mortgageBalanceCents',
  'cashDebtCents',
]);

/** Gains may be negative (a loss); every other entered figure is zero or more. */
export const SIGNED_COLUMNS: ReadonlySet<CorrectableSnapshotColumn> = new Set([
  'stocksGainCents',
  'etfGainCents',
  'cryptoGainCents',
  'superGainCents',
  'propertyGainCents',
  'mfGainCents',
  'otherGainCents',
]);

const OWED_LABELS: Partial<Record<CorrectableSnapshotColumn, string>> = {
  mortgageBalanceCents: 'Mortgage owed',
  cashDebtCents: 'Accounts in debit (owed)',
};

/** The field's label: the owed wording, else the column's plain words. */
export function correctLabel(column: CorrectableSnapshotColumn): string {
  return OWED_LABELS[column] ?? columnLabel(column);
}

export function isOffsetExtra(column: CorrectableSnapshotColumn): boolean {
  return (SNAPSHOT_OFFSET_EXTRAS as readonly string[]).includes(column);
}

/** Read-only on an imported month: the extras were never recorded there (§4.3). */
export function isReadOnly(snapshot: SnapshotDto, column: CorrectableSnapshotColumn): boolean {
  return snapshot.source === 'migrated' && isOffsetExtra(column);
}

/** The value a field shows: owed columns positive. */
export function displayCents(
  column: CorrectableSnapshotColumn,
  stored: number | null,
): number | null {
  if (stored === null) return null;
  return OWED_COLUMNS.has(column) ? Math.abs(stored) : stored;
}

/** The stored value of an entered one: owed columns negated (0 stays 0). */
export function storedCents(
  column: CorrectableSnapshotColumn,
  entered: number | null,
): number | null {
  if (entered === null) return null;
  return OWED_COLUMNS.has(column) && entered !== 0 ? -entered : entered;
}

export type CorrectDrafts = Partial<Record<CorrectableSnapshotColumn, number | null>>;

/** The form's starting values: every editable column's stored figure, owed ones positive. */
export function initialDrafts(snapshot: SnapshotDto): CorrectDrafts {
  const drafts: CorrectDrafts = {};
  for (const group of CORRECT_GROUPS) {
    for (const column of group.columns) {
      if (isReadOnly(snapshot, column)) continue;
      drafts[column] = displayCents(column, snapshot.figures[column]);
    }
  }
  return drafts;
}

export interface CorrectDiff {
  values: SnapshotCorrectionBody['values'];
  errors: Partial<Record<CorrectableSnapshotColumn, string>>;
}

/** The changed columns (stored signs) and the entry errors (positive wording for owed figures). */
export function diffCorrection(snapshot: SnapshotDto, drafts: CorrectDrafts): CorrectDiff {
  const diff: CorrectDiff = { values: {}, errors: {} };
  for (const [column, entered] of Object.entries(drafts) as [
    CorrectableSnapshotColumn,
    number | null,
  ][]) {
    if (isReadOnly(snapshot, column)) continue;
    if (entered === null && isOffsetExtra(column)) {
      diff.errors[column] = 'Enter an amount (0 when there is none)';
      continue;
    }
    if (entered !== null && Math.abs(entered) > CASHFLOW_MONEY_MAX) {
      diff.errors[column] = 'Enter an amount up to $100,000,000';
      continue;
    }
    if (entered !== null && entered < 0 && !SIGNED_COLUMNS.has(column)) {
      diff.errors[column] = 'Enter an amount of zero or more';
      continue;
    }
    const stored = storedCents(column, entered);
    if (stored !== snapshot.figures[column]) diff.values[column] = stored;
  }
  return diff;
}

/** Maps a server issue path (`values.cashDebtCents`) to its field. */
export function fieldOfPath(path: string): CorrectableSnapshotColumn | 'note' | undefined {
  if (path === 'note') return 'note';
  const m = /^values\.(\w+)/.exec(path);
  if (!m) return undefined;
  for (const group of CORRECT_GROUPS) {
    const column = group.columns.find((c) => c === m[1]);
    if (column) return column;
  }
  return undefined;
}

/** A server message in the positive "owed" wording (the stored sign is negative). */
export function owedMessage(column: string, message: string): string {
  if (column === 'mortgageBalanceCents' || column === 'cashDebtCents') {
    if (/must not be positive/.test(message)) return 'Enter an amount of zero or more.';
  }
  const text = message.trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}
