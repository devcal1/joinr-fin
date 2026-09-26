// Golden bookkeeping for the Stage 5 history and net-worth goldens (stage-5.md §9.3 rule 12, §9.5):
// every compared, skipped and recomputed cell is counted per area and per reason, and the printed
// line holds counts only. A failure names the template cell and the field, never a value.
import { decimalFromNumber } from '@joinr/schema';
import { ratioMatches } from '../../src/snapshot';

export const HISTORY_SKIP_REASONS = [
  'live_row',
  'first_period',
  'never',
  'label_format',
  'defined_by_decision',
  'fixed_definition',
  'not_rebuilt',
  'broken_total',
  'live_window',
] as const;
export type HistorySkipReason = (typeof HISTORY_SKIP_REASONS)[number];

/**
 * §9.3 rule 12, plus `retirement_tagged` (the Stage 4 rule 16 recomputation of the seam's Q and R
 * when the sheet counts Retirement-tagged lines; 0 when the workbook has none).
 */
export const HISTORY_RECOMPUTE_REASONS = [
  'negative_equity',
  'other_unit',
  'fy_basis',
  'closed_rows',
  'retirement_tagged',
] as const;
export type HistoryRecomputeReason = (typeof HISTORY_RECOMPUTE_REASONS)[number];

/** Cached formula results keep 10 significant digits: max(listed, 1e-9 × |sheet value|) (§9.5). */
function within(diff: number, listed: number, sheetValue: number): boolean {
  return Number.isFinite(diff) && Math.abs(diff) <= Math.max(listed, 1e-9 * Math.abs(sheetValue));
}

/** Sheet dollars → cents, half away from zero. */
export function sheetCents(dollars: number): number {
  const c = Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
  return c === 0 ? 0 : c;
}

/** §9.5: a ratio from unrounded decimals. */
const RATIO_TOLERANCE = 1e-9;

export class HistoryTally {
  compared = 0;
  readonly skipped: Record<HistorySkipReason, number> = Object.fromEntries(
    HISTORY_SKIP_REASONS.map((r) => [r, 0]),
  ) as Record<HistorySkipReason, number>;
  readonly recomputed: Record<HistoryRecomputeReason, number> = Object.fromEntries(
    HISTORY_RECOMPUTE_REASONS.map((r) => [r, 0]),
  ) as Record<HistoryRecomputeReason, number>;
  readonly failures: string[] = [];

  constructor(readonly area: string) {}

  get recomputedTotal(): number {
    return HISTORY_RECOMPUTE_REASONS.reduce((s, r) => s + this.recomputed[r], 0);
  }

  skip(reason: HistorySkipReason, cells = 1): void {
    this.skipped[reason] += cells;
  }

  /** Records one check; a `reason` marks an expectation recomputed by that §9.3 rule. */
  check(ref: string, ok: boolean, reason?: HistoryRecomputeReason): void {
    if (reason === undefined) this.compared += 1;
    else this.recomputed[reason] += 1;
    if (!ok) this.failures.push(ref);
  }

  /** Money: ≤ `tolCents` (default 1) vs the sheet × 100 (§9.5); a blank sheet cell needs null. */
  money(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    reason?: HistoryRecomputeReason,
    tolCents = 1,
  ): void {
    const ok =
      sheet === null
        ? engineCents === null
        : engineCents !== null && within(engineCents - sheetCents(sheet), tolCents, sheet * 100);
    this.check(ref, ok, reason);
  }

  /** A total that is the Σ of n once-rounded parts: ≤ max(1, ⌈n/2⌉) cents (§9.5). */
  sumMoney(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    reason?: HistoryRecomputeReason,
  ): void {
    this.money(ref, sheet, engineCents, reason, Math.max(1, Math.ceil(n / 2)));
  }

  /** A difference of two such totals (growths) or a sum of n rounded cells: ≤ max(1, n) cents. */
  diffMoney(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    reason?: HistoryRecomputeReason,
  ): void {
    this.money(ref, sheet, engineCents, reason, Math.max(1, n));
  }

  /** Ratios from unrounded decimals: max(1e-9, 1e-9 × |v|) (§9.5). */
  ratio(
    ref: string,
    sheet: number | null,
    engine: string | number | null,
    reason?: HistoryRecomputeReason,
  ): void {
    const ok =
      sheet !== null && engine !== null && within(Number(engine) - sheet, RATIO_TOLERANCE, sheet);
    this.check(ref, ok, reason);
  }

  /**
   * A ratio held to the cents it describes (§2.5, §9.5): the sheet's cached ratio `r` reproduces
   * from gain and value cents when `|r × (v − g) − g| ≤ slack + |r| × slack` (slack 1 cent for
   * stored cents; the parts' tolerance for figures the engine recomputes).
   */
  ratioOfCents(
    ref: string,
    sheet: number | null,
    gainCents: number | null,
    valueCents: number | null,
    slackCents = 1,
    reason?: HistoryRecomputeReason,
  ): void {
    let ok: boolean;
    if (sheet === null) ok = false;
    else if (slackCents <= 1) ok = ratioMatches(decimalFromNumber(sheet), gainCents, valueCents);
    else if (gainCents === null || valueCents === null) ok = sheet === 0;
    else {
      const den = valueCents - gainCents;
      ok =
        den === 0
          ? sheet === 0
          : Math.abs(sheet * den - gainCents) <=
            slackCents * (1 + Math.abs(sheet)) + 1e-6 * Math.abs(gainCents);
    }
    this.check(ref, ok, reason);
  }

  /** Savings rates (the Stage 3 golden's rate tolerance): max(1e-6, 1e-5 × |v|). */
  rate(
    ref: string,
    sheet: number | null,
    engine: string | null,
    reason?: HistoryRecomputeReason,
  ): void {
    const ok =
      sheet === null
        ? engine === null
        : engine !== null &&
          within(Number(engine) - sheet, Math.max(1e-6, 1e-5 * Math.abs(sheet)), sheet);
    this.check(ref, ok, reason);
  }

  /** Dates, months, counts and statuses: exact (null never matches). */
  exact(ref: string, sheet: unknown, engine: unknown, reason?: HistoryRecomputeReason): void {
    this.check(ref, sheet !== null && sheet !== undefined && sheet === engine, reason);
  }

  /** The printed line: counts only. */
  line(): string {
    const skipped = HISTORY_SKIP_REASONS.map((r) => `${r}: ${this.skipped[r]}`).join(', ');
    const byReason = HISTORY_RECOMPUTE_REASONS.map((r) => `${r}: ${this.recomputed[r]}`).join(', ');
    return `[golden] ${this.area}: compared: ${this.compared} · skipped: {${skipped}} · recomputed: ${this.recomputedTotal} (by reason: {${byReason}}) · failed: ${this.failures.length}`;
  }
}
