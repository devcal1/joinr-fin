// The History page's words (stage-5.md §6.4, §6.9): the lead, the record form's notes (the gap
// warning, today's values for ended months, months recorded together, an early record), the
// status card's lines, the delete question, the consistency panel and the empty states. Pure
// functions, no React.
import {
  addMonthsIso,
  isoMonthOf,
  monthEndOf,
  type HistoryPageResponse,
  type IsoDate,
  type IsoMonth,
  type RecorderStatusDto,
  type SnapshotDifferenceDto,
  type SnapshotDto,
} from '@joinr/schema';
import { formatDate, formatMoney } from '@joinr/ui';
import { plural } from '../../formatting';
import {
  columnLabel,
  hourText,
  isAre,
  monthWords,
  monthsWords,
  percentOf,
  serverTimeText,
} from './display';

/**
 * Auto-record waits for an earlier missing month (D94): record it (them), or record the current
 * month alone. `where` ends the sentence (", on the History page" on Net Worth; nothing on History).
 */
export function blockedWaitingText(
  blocked: RecorderStatusDto['blocked'],
  where = '',
): string | null {
  if (!blocked) return null;
  const missing = blockedMonths(blocked);
  const words = monthsWords(missing);
  const one = missing.length === 1;
  return `Auto-record is waiting: ${words} ${isAre(missing.length)} not recorded. Record ${one ? 'it' : 'them'}, or record ${monthWords(blocked.periodMonth)} alone (${words} then ${one ? 'becomes a gap' : 'become gaps'})${where}.`;
}

/** The months a blocked plan waits for (the missing ones, else the blocked month). */
export function blockedMonths(blocked: NonNullable<RecorderStatusDto['blocked']>): IsoMonth[] {
  return blocked.missing.length > 0 ? blocked.missing : [blocked.periodMonth];
}

/** The History page's blocked callout (Fixer round 1, STYLE-7). */
export function historyBlockedCallout(blocked: RecorderStatusDto['blocked']): string | null {
  return blockedWaitingText(blocked);
}

export const HISTORY_LEAD =
  "Recording a month freezes its figures. Later edits to trades, balances or prices don't change a recorded month; to change one, use Correct (you type the figures, and every change is logged below). The live row is today's provisional position.";
export const RECORD_FORM_LEAD = "Recording freezes these figures; later edits won't change them.";
export const RECORD_APP_DATA_NOTE =
  'Recording a month adds app data: re-importing the workbook will then be blocked.';
export const RECORD_PENDING = 'Refreshing prices and recording…';
export const NO_SNAPSHOTS_TEXT =
  'No months recorded yet. Import the workbook for past months, or record this month.';
export const CORRECT_REPLACES =
  'This replaces the stored figures; it does not recalculate from your current data.';
export const CORRECT_DERIVED =
  "Recalculated when you save: gain %, cash change, equity (and next month's cash change)";
export const CORRECT_WORKBOOK =
  'This came from the workbook. Saving a correction counts as an app edit: re-importing the workbook will then be blocked.';
export const CORRECT_AUDIT_NOTE = 'Corrections are kept in the audit trail.';
export const NOT_RECORDED_IMPORTED = 'Not recorded (imported month)';

/** The month after `month`. */
export function nextMonthOf(month: IsoMonth): IsoMonth {
  return isoMonthOf(addMonthsIso(`${month}-01`, 1));
}

/** True when the month's last day is before `asOf` (it can only be recorded late). */
export function monthEnded(month: IsoMonth, asOf: IsoDate): boolean {
  return monthEndOf(month) < asOf;
}

/**
 * The record form's notes for the ticked months (§6.4 item 3), in display order: the gap warning
 * per unticked earlier month, today's values for ended months, months recorded together, and an
 * early record of the current month.
 */
export function recordNotes(
  recordable: readonly IsoMonth[],
  ticked: ReadonlySet<IsoMonth>,
  asOf: IsoDate,
): string[] {
  const chosen = recordable.filter((m) => ticked.has(m));
  if (chosen.length === 0) return [];
  const notes: string[] = [];
  const latest = chosen[chosen.length - 1] ?? '';
  for (const month of recordable) {
    if (!ticked.has(month) && month < latest) {
      notes.push(`Leaving ${monthWords(month)} out makes it a permanent gap.`);
    }
  }
  const ended = chosen.filter((m) => monthEnded(m, asOf));
  if (ended.length > 0) {
    notes.push(
      `${monthsWords(ended)} will be recorded with today's (${formatDate(asOf)}) values and date, not ${ended.length === 1 ? 'its' : 'their'} month-end figures.`,
    );
  }
  if (chosen.length >= 2) {
    notes.push(
      'The months are recorded together; the later ones will show no change (recorded late).',
    );
  }
  const current = chosen.find((m) => !monthEnded(m, asOf) && monthEndOf(m) > asOf);
  if (current) {
    notes.push(
      `Recording before the month ends closes ${monthWords(current)} now; the rest of the month counts toward ${monthWords(nextMonthOf(current))}.`,
    );
  }
  return notes;
}

/** "Recorded Mar 2027" / "Recorded Feb 2027 and Mar 2027". */
export function recordedAnnouncement(months: readonly IsoMonth[]): string {
  return `Recorded ${monthsWords(months)}`;
}

/** Why the Record action is disabled when nothing is recordable (§6.9). */
export function nothingToRecordText(page: HistoryPageResponse): string {
  const latest = page.snapshots[0]?.periodMonth;
  const next = monthWords(page.record.nextMonth);
  return latest
    ? `${monthWords(latest)} is already recorded; the next month to record is ${next}`
    : `The next month to record is ${next}`;
}

/** "Jan 2027 and Feb 2027 are not recorded" (the status card's missing line). */
export function missingText(missing: readonly IsoMonth[]): string {
  return `${monthsWords(missing)} ${isAre(missing.length)} not recorded`;
}

/** "Oct 2026 was never recorded; months before the latest recorded month cannot be filled". */
export function gapsText(gaps: readonly IsoMonth[]): string {
  return `${monthsWords(gaps)} ${gaps.length === 1 ? 'was' : 'were'} never recorded; months before the latest recorded month cannot be filled`;
}

/** The live card's line: when auto-record will record it, or how to record it (§6.4 item 4). */
export function liveNotRecordedText(page: HistoryPageResponse): string {
  const next = serverTimeText(page.recorder.nextRunAt);
  if (page.recorder.autoRecord.enabled && next) return `Not recorded yet: auto-record on ${next}`;
  return 'Record it with Record month';
}

/** The auto-record switch text built from the record hour (D89). */
export function recordHourText(hour: number): string {
  return `Record each month automatically on its last day at ${hourText(hour)}, server time`;
}

/** The `data-cf-action` key of a recorded month's row button (focus returns there). */
export function rowActionKey(action: 'details' | 'correct' | 'delete', month: IsoMonth): string {
  return `history-${action}-${month}`;
}

/** "Delete Feb 2027? It becomes recordable again; the audit trail keeps a copy." */
export function deleteQuestion(month: IsoMonth): string {
  return `Delete ${monthWords(month)}? It becomes recordable again; the audit trail keeps a copy.`;
}

/** The other months recorded on the same run date: "Recorded together with Feb 2027". */
export function sharedRunDateText(
  snapshot: SnapshotDto,
  all: readonly SnapshotDto[],
): string | null {
  if (!snapshot.sharedRunDate) return null;
  const others = all
    .filter((s) => s.runDate === snapshot.runDate && s.periodMonth !== snapshot.periodMonth)
    .map((s) => s.periodMonth)
    .sort();
  return others.length > 0 ? `Recorded together with ${monthsWords(others)}` : null;
}

// ─── Consistency (§6.4 item 7) ──────────────────────────────────────────────────────────────────

/** The headline: derived figures only (the PLAN acceptance); movements never count as failures. */
export function consistencyHeadline(c: HistoryPageResponse['consistency']): string {
  if (c.migratedMonths === 0) return 'No imported months to check.';
  if (c.derivedMatchedMonths === c.migratedMonths) {
    return `Every stored figure reproduces (${c.derivedMatchedMonths} of ${c.migratedMonths} imported months)`;
  }
  return `${c.derivedMatchedMonths} of ${c.migratedMonths} imported months reproduce every stored figure`;
}

/** The movement information line (never a failure). */
export function movementText(months: readonly IsoMonth[]): string | null {
  if (months.length === 0) return null;
  return `${plural(months.length, 'month')}' movements differ from today's trades: a trade dated in that month was edited or corrected after it was recorded. Nothing to do; the recorded figure stands.`.replace(
    /^1 month'/,
    "1 month's",
  );
}

/** A derived difference, which is never expected: "Please report it." */
export function derivedDifferenceText(month: IsoMonth): string {
  return `A stored figure of ${monthWords(month)} does not match its recomputation. Please report it.`;
}

/** A difference's stored or recomputed value in words (money or a percentage). */
export function differenceValue(d: SnapshotDifferenceDto, which: 'stored' | 'recomputed'): string {
  const cents = which === 'stored' ? d.storedCents : d.recomputedCents;
  const ratio = which === 'stored' ? d.storedRatio : d.recomputedRatio;
  if (cents !== null) return formatMoney(cents);
  if (ratio !== null) return percentOf(ratio) ?? ratio;
  return '—';
}

/** Why a figure differs, by kind. */
export function differenceWhy(d: SnapshotDifferenceDto): string {
  return d.kind === 'movement'
    ? 'A trade dated in that month was edited after it was recorded; the recorded figure stands.'
    : 'Please report it: a stored figure should always reproduce.';
}

/** A difference's column in words. */
export function differenceColumn(d: SnapshotDifferenceDto): string {
  return columnLabel(d.column);
}
