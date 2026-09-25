// Golden bookkeeping (stage-2.md §9.3 rule 14, §9.5): every compared, skipped and adjusted cell is
// counted per area, and the printed line holds counts only. A failure names the template cell and
// the field, never a value.

export const SKIP_REASONS = [
  'unpriced',
  'no_prices',
  'not_held',
  'fy_table_lookup',
  'five_fy_window',
  // A zero-unit ledger row in a Capital Gains block: neither a lot (O) nor a disposal (P/Q/S), so
  // it is counted here rather than dropped (Scaffold note 2026-09-25 — Fixer).
  'zero_units',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const ADJUST_REASONS = ['partial_lot_fee', 'recomputed'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** max(listed tolerance, 1e-9 × |sheet value|) (§9.5). */
function within(diff: number, listed: number, sheetValue: number): boolean {
  return Number.isFinite(diff) && Math.abs(diff) <= Math.max(listed, 1e-9 * Math.abs(sheetValue));
}

/** Sheet dollars → cents, half away from zero. */
export function sheetCents(dollars: number): number {
  const c = Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
  return c === 0 ? 0 : c;
}

export class Tally {
  compared = 0;
  readonly skipped: Record<SkipReason, number> = {
    unpriced: 0,
    no_prices: 0,
    not_held: 0,
    fy_table_lookup: 0,
    five_fy_window: 0,
    zero_units: 0,
  };
  readonly adjusted: Record<AdjustReason, number> = { partial_lot_fee: 0, recomputed: 0 };
  readonly failures: string[] = [];
  /** Extra assertion counts printed with the line (e.g. D28 re-links). */
  readonly notes: Record<string, number> = {};

  constructor(readonly area: string) {}

  skip(reason: SkipReason, cells = 1): void {
    this.skipped[reason] += cells;
  }

  note(name: string, n = 1): void {
    this.notes[name] = (this.notes[name] ?? 0) + n;
  }

  /** Records one compared cell; `adjust` marks an adjusted or recomputed expectation. */
  check(ref: string, ok: boolean, adjust?: AdjustReason): void {
    this.compared += 1;
    if (adjust) this.adjusted[adjust] += 1;
    if (!ok) this.failures.push(ref);
  }

  /** Money per holding, lot or disposal: ≤ `tolCents` (default 1) vs the sheet × 100. */
  money(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    adjust?: AdjustReason,
    tolCents = 1,
  ): void {
    const ok =
      sheet !== null &&
      engineCents !== null &&
      within(engineCents - sheetCents(sheet), tolCents, sheet * 100);
    this.check(ref, ok, adjust);
  }

  /** Money in a summary of n rows: ≤ max(1, ⌈n/2⌉) cents. */
  summaryMoney(
    ref: string,
    sheet: number | null,
    engineCents: number | null,
    n: number,
    adjust?: AdjustReason,
  ): void {
    this.money(ref, sheet, engineCents, adjust, Math.max(1, Math.ceil(n / 2)));
  }

  units(ref: string, sheet: number | null, engine: string | null): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-8, sheet);
    this.check(ref, ok);
  }

  price(ref: string, sheet: number | null, engine: string | null): void {
    const ok =
      sheet !== null &&
      engine !== null &&
      Math.abs(Number(engine) - sheet) <= 1e-9 * Math.max(1, Math.abs(sheet));
    this.check(ref, ok);
  }

  ratio(
    ref: string,
    sheet: number | null,
    engine: string | number | null,
    adjust?: AdjustReason,
  ): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-7, sheet);
    this.check(ref, ok, adjust);
  }

  xirr(
    ref: string,
    sheet: number | null,
    engine: string | number | null,
    adjust?: AdjustReason,
  ): void {
    const ok = sheet !== null && engine !== null && within(Number(engine) - sheet, 1e-6, sheet);
    this.check(ref, ok, adjust);
  }

  exact(ref: string, sheet: unknown, engine: unknown, adjust?: AdjustReason): void {
    this.check(ref, sheet !== null && sheet !== undefined && sheet === engine, adjust);
  }

  /** The printed line: counts only. */
  line(): string {
    const skipped = SKIP_REASONS.map((r) => `${r}: ${this.skipped[r]}`).join(', ');
    const adjusted = ADJUST_REASONS.map((r) => `${r}: ${this.adjusted[r]}`).join(', ');
    const notes = Object.entries(this.notes)
      .map(([k, v]) => ` · ${k}: ${v}`)
      .join('');
    return `[golden] ${this.area}: compared: ${this.compared} · skipped: {${skipped}} · adjusted: {${adjusted}}${notes} · failed: ${this.failures.length}`;
  }
}
