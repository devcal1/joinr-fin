// Display helpers shared by the Net Worth, History and Settings pages (stage-5.md §5, §6.1): the
// class and liability labels, the chart stack (order, colours and the one Cash definition), the
// snapshot column labels, month and list words, the unit words for chart titles, the change words
// of the hero tiles, the record sources and audit words, and the server-time text. Pure functions,
// no React.
import {
  CHART_COUNT_MAX,
  NET_WORTH_CLASS_SLOTS,
  NET_WORTH_STACK_ORDER,
  SNAPSHOT_COLUMN_LABELS,
  type ChartDateUnit,
  type DecimalString,
  type IsoMonth,
  type JobRunSummary,
  type NetWorthChangeDto,
  type NetWorthClass,
  type NetWorthLiability,
  type NetWorthStackClass,
  type RecordTrigger,
  type RecorderStatusDto,
  type SnapshotAuditAction,
  type SnapshotDto,
  type SnapshotFigureKey,
  type SnapshotFiguresDto,
  type SnapshotSource,
} from '@joinr/schema';
import {
  CHART_OTHER,
  CHART_PALETTE,
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
  formatTime,
  type StatDelta,
} from '@joinr/ui';
import { formatRate, type MarkerId } from '../assets/display';

// ─── Classes, liabilities and the chart stack (§5) ──────────────────────────────────────────────

/** The assets-and-liabilities table's rows (property at its full value; the loan is a liability). */
export const NET_WORTH_CLASS_LABELS: Readonly<Record<NetWorthClass, string>> = {
  etf: 'ETFs',
  stock: 'Stocks',
  managed_fund: 'Managed funds',
  crypto: 'Crypto',
  cash: 'Cash',
  offsets: 'Offset accounts',
  other_assets: 'Other assets',
  super: 'Super',
  property: 'Property',
};

/** The charts' and the donut's names: property is net equity there (§5). */
export const STACK_LABELS: Readonly<Record<NetWorthStackClass, string>> = {
  stock: 'Stocks',
  etf: 'ETFs',
  crypto: 'Crypto',
  cash: 'Cash',
  managed_fund: 'Managed funds',
  other_assets: 'Other assets',
  super: 'Super',
  property: 'Property equity',
};

export const LIABILITY_LABELS: Readonly<Record<NetWorthLiability, string>> = {
  mortgages: 'Mortgages',
  cash_debit: 'Accounts in debit',
  other_debts: 'Other debts (imported)',
};

/** History U on imported months: the ninth series, "Other" grey, always below zero. */
export const OTHER_DEBTS_SERIES = 'Other debts';
export const OTHER_DEBTS_COLOR: string = CHART_OTHER;

/** Trend lines are 2px dashed "Other" grey, named "Trend" (a reference line, not a series). */
export const TREND_NAME = 'Trend';
export const TREND_COLOR: string = CHART_OTHER;

/** The stacked total's name in the tooltips and tables. */
export const NET_WORTH_TOTAL = 'Net worth';

/** The chart colour of a class: its fixed slot (NET_WORTH_CLASS_SLOTS), whatever else is drawn. */
export function classColor(key: NetWorthStackClass): string {
  return CHART_PALETTE[NET_WORTH_CLASS_SLOTS[key] - 1] ?? CHART_OTHER;
}

/** Whether a class is drawn in the stacked charts and the donut. */
export function isStackClass(key: NetWorthClass): key is NetWorthStackClass {
  return (NET_WORTH_STACK_ORDER as readonly string[]).includes(key);
}

/** The savings tracker's five classes: the first five of the stack order (§5). */
export const TRACKER_CLASSES: readonly NetWorthStackClass[] = NET_WORTH_STACK_ORDER.slice(0, 5);

/**
 * A group's value for a stacked class (§5): Stocks B, ETFs F, Crypto J, Cash N + offsets − linked
 * (net cash, with the offsets not inside equity; on imported months N, so the series is
 * continuous), Managed funds AF, Other assets AJ, Super Q, Property equity Z. Null stays a gap.
 */
export function stackValueCents(
  figures: SnapshotFiguresDto,
  key: NetWorthStackClass,
): number | null {
  switch (key) {
    case 'stock':
      return figures.stocksValueCents;
    case 'etf':
      return figures.etfValueCents;
    case 'crypto':
      return figures.cryptoValueCents;
    case 'cash':
      return figures.cashValueCents === null
        ? null
        : figures.cashValueCents + (figures.offsetCents ?? 0) - (figures.mortgageOffsetCents ?? 0);
    case 'managed_fund':
      return figures.mfValueCents;
    case 'other_assets':
      return figures.otherValueCents;
    case 'super':
      return figures.superValueCents;
    case 'property':
      return figures.propertyEquityCents;
  }
}

/** History U as the chart's "Other debts" (≤ 0), or null when not recorded. */
export function otherDebtsCents(figures: SnapshotFiguresDto): number | null {
  const u = figures.liabilitiesBalanceCents;
  // 0 stays 0 (not -0, which would print a minus sign).
  return u === null ? null : u === 0 ? 0 : -Math.abs(u);
}

// ─── Words ──────────────────────────────────────────────────────────────────────────────────────

/** '2027-02' → "Feb 2027" (an unparsable month is returned as is). */
export function monthWords(month: IsoMonth): string {
  try {
    return formatMonth(month);
  } catch {
    return month;
  }
}

/** "A", "A and B", "A, B and C". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Months as words: "Jan 2027 and Feb 2027". */
export function monthsWords(months: readonly IsoMonth[]): string {
  return listWords(months.map(monthWords));
}

/** "is" or "are" for a list of months. */
export function isAre(count: number): string {
  return count === 1 ? 'is' : 'are';
}

/** A ratio at one decimal ("0.074" → "7.4%"); null → null. */
export function percentOf(ratio: DecimalString | null): string | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  return Number.isFinite(value) ? formatPercent(value) : null;
}

/** A percentage in prose without a trailing ".0" ("20%", "12.5%"). */
export function percentProse(ratio: DecimalString | number): string {
  return formatPercent(Number(ratio)).replace(/\.0%$/, '%');
}

/** Whole dollars with a sign for a change ("+$4,500", "−$800"). */
export function signedDollars(cents: number): string {
  return formatMoney(cents, { wholeDollars: true, signDisplay: cents === 0 ? 'auto' : 'always' });
}

/**
 * A hero tile's change (§6.3 item 2): the arrow, the percentage and "up since 28/02/2027" (the base
 * run date); null when there is no change to show. Without a ratio (a zero base) the words stand
 * alone.
 */
export function changeDelta(change: NetWorthChangeDto): StatDelta | undefined {
  if (change.cents === null || change.base === null) return undefined;
  const direction = change.cents > 0 ? 'up' : change.cents < 0 ? 'down' : 'flat';
  const since = formatDate(change.base.runDate);
  const ratio = change.ratio === null ? null : Math.abs(Number(change.ratio));
  const value = ratio === null || !Number.isFinite(ratio) ? '' : formatPercent(ratio);
  const word = direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'no change';
  return { value, direction, text: `${word} since ${since}` };
}

// ─── Chart units (§5: titles and the first table column follow the unit) ────────────────────────

export const UNIT_LABELS: Readonly<Record<ChartDateUnit, string>> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const UNIT_TITLE_WORDS: Readonly<Record<ChartDateUnit, string>> = {
  monthly: 'by month',
  quarterly: 'by quarter',
  yearly: 'by year',
};

/** "Net worth by month / by quarter / by year". */
export function unitTitle(prefix: string, unit: ChartDateUnit): string {
  return `${prefix} ${UNIT_TITLE_WORDS[unit]}`;
}

/** The count choices of the view switch (§6.3 item 5); 'all' = every group. */
export const COUNT_CHOICES = ['6', '12', '24', 'all'] as const;

/** A count on screen as the Select's value: "all" for every group (null or the query maximum). */
export function countValue(count: number | null): string {
  return count === null || count >= CHART_COUNT_MAX ? 'all' : String(count);
}

/** The Select's value back to the query's count: "all" is sent as the query maximum. */
export function countOfValue(value: string): number {
  return value === 'all' ? CHART_COUNT_MAX : Number(value);
}

/** The count choices, plus the saved count when it is none of them (e.g. 8). */
export function countOptions(count: number | null): { value: string; label: string }[] {
  const current = countValue(count);
  const values: string[] = [...COUNT_CHOICES];
  if (!values.includes(current)) values.splice(values.length - 1, 0, current);
  return values
    .sort((x, y) => (x === 'all' ? 1 : y === 'all' ? -1 : Number(x) - Number(y)))
    .map((value) => ({ value, label: value === 'all' ? 'All' : value }));
}

/** The live-region words for a view: "Showing quarterly, last 8" / "Showing monthly, all". */
export function viewAnnouncement(unit: ChartDateUnit, count: number | null): string {
  return `Showing ${UNIT_LABELS[unit].toLowerCase()}, ${countValue(count) === 'all' ? 'all' : `last ${count}`}`;
}

/** A chart category: the label, and " (live)" on the live group (§5). */
export function groupCategory(group: { label: string; live: boolean }): string {
  return group.live ? `${group.label} (live)` : group.label;
}

/** Under a bar chart with a live group (§5). */
export const LIVE_GROUP_NOTE = "The last bar is live: today's prices and balances.";
/** Under an area or line chart with a live group (the Stage 4 line-chart wording). */
export const LIVE_AREA_NOTE = "The last point is live: today's prices and balances.";
/** Under a chart's table view with a live group (its period reads "(live)", `groupCategory`). */
export const LIVE_TABLE_NOTE = "The period marked (live) uses today's prices and balances.";

// ─── Times (§6.1: 24-hour, a server time in its own offset) ─────────────────────────────────────

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** "23:00" from an hour. */
export function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * A server time (an ISO string with the server's offset) in that offset's wall time: "30/09/2026
 * at 23:00", plus " (server time)" when the browser's offset at that instant differs.
 */
export function serverTimeText(iso: string | null): string | null {
  if (!iso) return null;
  const m = ISO_WITH_OFFSET.exec(iso);
  if (!m) return localTimeText(iso);
  const [, y, mo, d, h, mi, zone] = m;
  const text = `${d}/${mo}/${y} at ${h}:${mi}`;
  const serverOffset =
    zone === 'Z'
      ? 0
      : (zone?.startsWith('-') ? -1 : 1) *
        (Number(zone?.slice(1, 3)) * 60 + Number(zone?.slice(4, 6)));
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return text;
  const browserOffset = -instant.getTimezoneOffset();
  return browserOffset === serverOffset ? text : `${text} (server time)`;
}

/** A UTC timestamp in the browser's time: "31/03/2027 at 23:00". */
export function localTimeText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatDate(date)} at ${formatTime(date)}`;
}

// ─── Sources, triggers and audit words (§6.1, §6.4) ─────────────────────────────────────────────

/** The marker of a recorded month's source: Recorded, Recorded late (late / look-back), Imported. */
export function sourceMarker(source: SnapshotSource): MarkerId {
  switch (source) {
    case 'recorded':
      return 'recorded';
    case 'late':
    case 'lookback':
      return 'recordedLate';
    case 'migrated':
      return 'imported';
  }
}

/** A recorded month's markers: its source, then "Corrected" when a correction was applied. */
export function snapshotMarkers(snapshot: Pick<SnapshotDto, 'source' | 'revision'>): MarkerId[] {
  const ids: MarkerId[] = [sourceMarker(snapshot.source)];
  if (snapshot.revision > 0) ids.push('corrected');
  return ids;
}

/** How a late month was recorded (the Details and the badge's title). */
export function lateHowText(source: SnapshotSource): string | null {
  if (source === 'late') return 'Recorded late, automatically at start-up';
  if (source === 'lookback') return 'Recorded late, by you';
  return null;
}

export const TRIGGER_WORDS: Readonly<Record<RecordTrigger, string>> = {
  manual: 'You',
  schedule: 'Scheduled',
  startup: 'At start-up',
};

export const AUDIT_ACTION_WORDS: Readonly<Record<SnapshotAuditAction, string>> = {
  record: 'Recorded',
  correct: 'Corrected',
  delete: 'Deleted',
};

/** A figure column's plain words; "YYYY-MM.column" (the next month's follow-up) is prefixed. */
export function changeKeyLabel(key: string): string {
  const dot = key.indexOf('.');
  if (dot > 0) {
    return `${monthWords(key.slice(0, dot))} ${columnLabel(key.slice(dot + 1))}`;
  }
  return columnLabel(key);
}

/** SNAPSHOT_COLUMN_LABELS' words for a figure column (the key itself when unknown). */
export function columnLabel(key: string): string {
  return SNAPSHOT_COLUMN_LABELS[key as SnapshotFigureKey]?.label ?? key;
}

/** A column's kind: ratio columns end in "Ratio", the measured-to date is a date, else money. */
export function columnKind(key: string): 'money' | 'ratio' | 'date' {
  const column = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  if (column.endsWith('Ratio')) return 'ratio';
  if (column === 'superMeasuredThrough') return 'date';
  return 'money';
}

/** An audit value in words: money, a percentage, a date or "—". */
export function changeValueText(key: string, value: number | string | null): string {
  if (value === null) return '—';
  switch (columnKind(key)) {
    case 'ratio':
      return percentOf(String(value)) ?? String(value);
    case 'date':
      try {
        return formatDate(String(value));
      } catch {
        return String(value);
      }
    case 'money':
      return typeof value === 'number' ? formatMoney(value) : String(value);
  }
}

/**
 * An audit change "before → after". A ratio change that one decimal hides ("0.5% → 0.5%") is shown
 * at up to two decimals (`formatRate`), then three, so a logged change never reads as a no-op
 * (Fixer round 1, STYLE-11: an exception to §6.1's one-decimal rule, audit pairs only).
 */
export function changePairText(
  key: string,
  before: number | string | null,
  after: number | string | null,
): string {
  const pair = (b: string, a: string): string => `${b} → ${a}`;
  const b = changeValueText(key, before);
  const a = changeValueText(key, after);
  if (columnKind(key) !== 'ratio' || before === null || after === null || b !== a)
    return pair(b, a);
  if (Number(before) === Number(after)) return pair(b, a);
  const b2 = formatRate(String(before));
  const a2 = formatRate(String(after));
  if (b2 !== null && a2 !== null && b2 !== a2) return pair(b2, a2);
  return pair(formatPercent(Number(before), { dp: 3 }), formatPercent(Number(after), { dp: 3 }));
}

// ─── The recorder (§6.4 item 2) ─────────────────────────────────────────────────────────────────

/** "On · next 30/09/2026 at 23:00" / "On (set by the server)" / "Off". */
export function autoRecordText(recorder: RecorderStatusDto): string {
  if (!recorder.autoRecord.enabled) return 'Off';
  if (recorder.autoRecord.source === 'env') {
    const next = serverTimeText(recorder.nextRunAt);
    return next ? `On (set by the server) · next ${next}` : 'On (set by the server)';
  }
  const next = serverTimeText(recorder.nextRunAt);
  return next ? `On · next ${next}` : 'On';
}

/** The months a snapshot job run recorded or skipped (its detail is loosely typed). */
function detailMonths(run: JobRunSummary, field: 'recorded' | 'due'): IsoMonth[] {
  const value = run.detail?.[field];
  return Array.isArray(value) ? value.filter((m): m is string => typeof m === 'string') : [];
}

/** "Waiting: Jan 2027 is not recorded" (D94). */
export function blockedText(blocked: NonNullable<RecorderStatusDto['blocked']>): string {
  const months = blocked.missing.length > 0 ? blocked.missing : [blocked.periodMonth];
  return `Waiting: ${monthsWords(months)} ${isAre(months.length)} not recorded`;
}

/**
 * The last automatic run in words (§6.4 item 2): "Recorded Jan 2027 late at start-up",
 * "Recorded Aug 2026", "Nothing due", "Failed: <error>", or the blocked wait.
 */
export function lastRunText(recorder: RecorderStatusDto): string {
  if (recorder.blocked) return blockedText(recorder.blocked);
  const run = recorder.lastRun;
  if (!run) return 'No automatic run yet';
  if (run.status === 'running') return 'Recording now';
  if (run.status === 'failed') return `Failed: ${run.error ?? 'the record did not finish'}`;
  const recorded = detailMonths(run, 'recorded');
  if (recorded.length === 0) return 'Nothing due';
  const how = run.trigger === 'startup' ? ' late at start-up' : '';
  return `Recorded ${monthsWords(recorded)}${how}`;
}

/** When the last automatic run started (browser time), or null when there is none or it waits. */
export function lastRunTime(recorder: RecorderStatusDto): string | null {
  if (recorder.blocked || !recorder.lastRun) return null;
  return localTimeText(recorder.lastRun.startedAt);
}

/** A negative figure shown as an owed amount: its absolute value (never tinted, §6.4 item 5). */
export function owedCents(cents: number | null): number | null {
  return cents === null ? null : Math.abs(cents);
}
