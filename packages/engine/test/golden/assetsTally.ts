// Golden bookkeeping for the Stage 4 goldens (stage-4.md §9.3 rule 13, §9.5): every compared,
// skipped and recomputed cell is counted per area and per reason, and the printed line holds counts
// only. A failure names the template cell and the field, never a value. A recomputed check (an
// expectation rebuilt from the sheet's own cells by a §9.3 rule) counts under `recomputed` with its
// reason, not under `compared`.

export const ASSETS_SKIP_REASONS = [
  'live_window',
  'current_month_blank',
  'never',
  'defined_by_decision',
  'fixed_definition',
  'first_period',
  'sheet_mode_unavailable',
] as const;
export type AssetsSkipReason = (typeof ASSETS_SKIP_REASONS)[number];

export const ASSETS_RECOMPUTE_REASONS = [
  'no_purchase_date',
  'boundary_purchase',
  'assumed_date',
  'negative_lvr',
  'fx_included',
  'retirement_tagged',
] as const;
export type AssetsRecomputeReason = (typeof ASSETS_RECOMPUTE_REASONS)[number];

/** max(listed tolerance, 1e-9 × |sheet value|) (§9.5). */
function within(diff: number, listed: number, sheetValue: number): boolean {
  return Number.isFinite(diff) && Math.abs(diff) <= Math.max(listed, 1e-9 * Math.abs(sheetValue));
}

/** Sheet dollars → cents, half away from zero. */
export function sheetCents(dollars: number): number {
  const c = Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
  return c === 0 ? 0 : c;
}

/** §9.5: a ratio from unrounded decimals, and one the engine derives from stored cents. */
const RATIO_TOLERANCE = 1e-9;

export class AssetsTally {
  compared = 0;
  readonly skipped: Record<AssetsSkipReason, number> = {
    live_window: 0,
    current_month_blank: 0,
    never: 0,
    defined_by_decision: 0,
    fixed_definition: 0,
    first_period: 0,
    sheet_mode_unavailable: 0,
  };
  readonly recomputed: Record<AssetsRecomputeReason, number> = {
    no_purchase_date: 0,
    boundary_purchase: 0,
    assumed_date: 0,
    negative_lvr: 0,
    fx_included: 0,
    retirement_tagged: 0,
  };
  readonly failures: string[] = [];

  constructor(readonly area: string) {}

  get recomputedTotal(): number {
    return ASSETS_RECOMPUTE_REASONS.reduce((s, r) => s + this.recomputed[r], 0);
  }

  skip(reason: AssetsSkipReason, cells = 1): void {
    this.skipped[reason] += cells;
  }

  /** Records one check; a `reason` marks an expectation recomputed by that §9.3 rule. */
  check(ref: string, ok: boolean, reason?: AssetsRecomputeReason): void {
    if (reason === undefined) this.compared += 1;
    else this.recomputed[reason] += 1;
    if (!ok) this.failures.push(ref);
  }

  /** Money per row, period or KPI: ≤ `tolCents` (default 1) vs the sheet × 100 (§9.5). */
  money(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    reason?: AssetsRecomputeReason,
    tolCents = 1,
  ): void {
    const ok =
      sheet !== null &&
      engineCents !== null &&
      within(engineCents - sheetCents(sheet), tolCents, sheet * 100);
    this.check(ref, ok, reason);
  }

  /** A total that is the Σ of n once-rounded rows: ≤ max(1, ⌈n/2⌉) cents (§9.5). */
  sumMoney(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    reason?: AssetsRecomputeReason,
  ): void {
    this.money(ref, sheet, engineCents, reason, Math.max(1, Math.ceil(n / 2)));
  }

  /** A total of n rows' gains, each the difference of two rounded figures: ≤ max(1, n) cents. */
  sumGains(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    reason?: AssetsRecomputeReason,
  ): void {
    this.money(ref, sheet, engineCents, reason, Math.max(1, n));
  }

  /** Ratios (gain %, CAGR, LVR, returns): max(1e-9, 1e-9 × |v|) (§9.5). */
  ratio(
    ref: string,
    sheet: number | null,
    engine: string | null,
    reason?: AssetsRecomputeReason,
  ): void {
    const ok =
      sheet !== null && engine !== null && within(Number(engine) - sheet, RATIO_TOLERANCE, sheet);
    this.check(ref, ok, reason);
  }

  /**
   * A ratio whose denominator is 0 on the engine's side (§9.3 rules 8 and 15): the sheet shows an
   * error, its IFERROR value or "-", and the engine's null matches it.
   */
  ratioOrZeroDenominator(
    ref: string,
    sheet: number | null,
    engine: string | null,
    denominatorIsZero: boolean,
    reason?: AssetsRecomputeReason,
  ): void {
    if (denominatorIsZero) this.check(ref, engine === null, reason);
    else this.ratio(ref, sheet, engine, reason);
  }

  units(ref: string, sheet: number | null, engine: string | null): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-8, sheet);
    this.check(ref, ok);
  }

  /** Dates, texts, months, counts and statuses: exact (null never matches). */
  exact(ref: string, sheet: unknown, engine: unknown, reason?: AssetsRecomputeReason): void {
    this.check(ref, sheet !== null && sheet !== undefined && sheet === engine, reason);
  }

  /** The printed line: counts only. */
  line(): string {
    const skipped = ASSETS_SKIP_REASONS.map((r) => `${r}: ${this.skipped[r]}`).join(', ');
    const byReason = ASSETS_RECOMPUTE_REASONS.map((r) => `${r}: ${this.recomputed[r]}`).join(', ');
    return `[golden] ${this.area}: compared: ${this.compared} · skipped: {${skipped}} · recomputed: ${this.recomputedTotal} (by reason: {${byReason}}) · failed: ${this.failures.length}`;
  }
}
