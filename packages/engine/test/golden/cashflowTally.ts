// Golden bookkeeping for the cash-flow goldens (stage-3.md §9.3 rule 12, §9.5): every compared,
// skipped and recomputed cell is counted per area, and the printed line holds counts only. A
// failure names the template cell and the field, never a value. A recomputed check (an expectation
// rebuilt from the sheet's own columns) counts under `recomputed`, not `compared`.

export const CASHFLOW_SKIP_REASONS = [
  'first_period',
  'live_window',
  'broken_formula',
  'no_ex_date',
  'replaced_by_goals',
  'never',
] as const;
export type CashflowSkipReason = (typeof CASHFLOW_SKIP_REASONS)[number];

/** max(listed tolerance, 1e-9 × |sheet value|) (§9.5). */
function within(diff: number, listed: number, sheetValue: number): boolean {
  return Number.isFinite(diff) && Math.abs(diff) <= Math.max(listed, 1e-9 * Math.abs(sheetValue));
}

/** Sheet dollars → cents, half away from zero. */
export function sheetCents(dollars: number): number {
  const c = Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
  return c === 0 ? 0 : c;
}

export class CashflowTally {
  compared = 0;
  recomputed = 0;
  readonly skipped: Record<CashflowSkipReason, number> = {
    first_period: 0,
    live_window: 0,
    broken_formula: 0,
    no_ex_date: 0,
    replaced_by_goals: 0,
    never: 0,
  };
  readonly failures: string[] = [];

  constructor(readonly area: string) {}

  skip(reason: CashflowSkipReason, cells = 1): void {
    this.skipped[reason] += cells;
  }

  /** Records one check; `recomputed` marks an expectation rebuilt from the sheet's columns. */
  check(ref: string, ok: boolean, recomputed = false): void {
    if (recomputed) this.recomputed += 1;
    else this.compared += 1;
    if (!ok) this.failures.push(ref);
  }

  /** Money per period, row or KPI: ≤ `tolCents` (default 1) vs the sheet × 100. */
  money(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    recomputed = false,
    tolCents = 1,
  ): void {
    const ok =
      sheet !== null &&
      engineCents !== null &&
      within(engineCents - sheetCents(sheet), tolCents, sheet * 100);
    this.check(ref, ok, recomputed);
  }

  /** Money summed over n periods or rows: ≤ max(1, n) cents. */
  sumMoney(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    recomputed = false,
  ): void {
    this.money(ref, sheet, engineCents, recomputed, Math.max(1, n));
  }

  /** Savings rates, cash gain %, income shares, yields: max(1e-6, 1e-5 × |v|). */
  ratio(
    ref: string,
    sheet: number | null,
    engine: string | number | null,
    recomputed = false,
  ): void {
    const ok =
      sheet !== null &&
      engine !== null &&
      within(Number(engine) - sheet, Math.max(1e-6, 1e-5 * Math.abs(sheet)), sheet);
    this.check(ref, ok, recomputed);
  }

  /** Trend per month and weighted year rates: 1e-6 absolute. */
  rate(
    ref: string,
    sheet: number | null,
    engine: string | number | null,
    recomputed = false,
  ): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-6, sheet);
    this.check(ref, ok, recomputed);
  }

  units(ref: string, sheet: number | null, engine: string | null, recomputed = false): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-8, sheet);
    this.check(ref, ok, recomputed);
  }

  /** Dates, texts, months, counts and statuses: exact (null matches null). */
  exact(ref: string, sheet: unknown, engine: unknown, recomputed = false): void {
    this.check(ref, sheet === engine, recomputed);
  }

  /** The printed line: counts only. */
  line(): string {
    const skipped = CASHFLOW_SKIP_REASONS.map((r) => `${r}: ${this.skipped[r]}`).join(', ');
    return `[golden] ${this.area}: compared: ${this.compared} · skipped: {${skipped}} · recomputed: ${this.recomputed} · failed: ${this.failures.length}`;
  }
}
