// Golden bookkeeping for the Stage 6 FIRE golden (stage-6.md §9.3 rule 7, §9.5): every compared,
// skipped and recomputed cell is counted per area and per reason, and the printed line holds counts
// only. A failure names the template cell, never a value.

export const FIRE_SKIP_REASONS = ['no_formula', 'never'] as const;
export type FireSkipReason = (typeof FIRE_SKIP_REASONS)[number];

export const FIRE_RECOMPUTE_REASONS = ['closed_rows', 'sheet_cells'] as const;
export type FireRecomputeReason = (typeof FIRE_RECOMPUTE_REASONS)[number];

/** Cached formula results keep 10 significant digits: max(listed, 1e-9 × |sheet value|) (§9.5). */
export function within(diff: number, listed: number, sheetValue: number): boolean {
  return Number.isFinite(diff) && Math.abs(diff) <= Math.max(listed, 1e-9 * Math.abs(sheetValue));
}

/** §9.5: sheet mode and the helpers, in dollars. */
export const DOLLAR_TOLERANCE = 1e-6;
/** §9.5: the raw path's yearly figures (cents) against a helper × 100. */
export const RAW_YEARLY_TOLERANCE_CENTS = 12;

export class FireTally {
  compared = 0;
  readonly skipped: Record<FireSkipReason, number> = { no_formula: 0, never: 0 };
  readonly recomputed: Record<FireRecomputeReason, number> = { closed_rows: 0, sheet_cells: 0 };
  readonly failures: string[] = [];

  constructor(readonly area: string) {}

  get recomputedTotal(): number {
    return FIRE_RECOMPUTE_REASONS.reduce((s, r) => s + this.recomputed[r], 0);
  }

  skip(reason: FireSkipReason, cells = 1): void {
    this.skipped[reason] += cells;
  }

  /** One check; a `reason` marks an expectation recomputed by that §9.3 rule. */
  check(ref: string, ok: boolean, reason?: FireRecomputeReason): void {
    if (reason === undefined) this.compared += 1;
    else this.recomputed[reason] += 1;
    if (!ok) this.failures.push(ref);
  }

  /** Dollars within max(listed, 1e-9 × |v|). */
  dollars(
    ref: string,
    sheet: number | null,
    engine: number | null,
    reason?: FireRecomputeReason,
    listed = DOLLAR_TOLERANCE,
  ): void {
    const ok = sheet !== null && engine !== null && within(engine - sheet, listed, sheet);
    this.check(ref, ok, reason);
  }

  /** Counts only (§9.3 rule 7). */
  line(): string {
    const skipped = FIRE_SKIP_REASONS.map((r) => `${r}: ${this.skipped[r]}`).join(', ');
    const by = FIRE_RECOMPUTE_REASONS.map((r) => `${r}: ${this.recomputed[r]}`).join(', ');
    return `[golden] ${this.area}: compared: ${this.compared} · skipped: {${skipped}} · recomputed: ${this.recomputedTotal} (by reason: ${by}) · failed: ${this.failures.length}`;
  }
}
