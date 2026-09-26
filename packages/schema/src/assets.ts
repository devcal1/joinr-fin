// Stage 4 constants shared by the engine, the server and the web (stage-4.md §3.2): the statutory
// super tables (public ATO figures, recorded 2026-09-26), the other-asset defaults and the loan
// payment grid (§2.3). Pure: no clock, no I/O; part of the root export.
import { addMonthsIso } from './dates';
import type { PaymentFrequency } from './enums';
import type { IsoDate } from './primitives';

/**
 * The general concessional contributions cap by financial year (the FY start year) in cents. An FY
 * after the table uses its last entry (the page says "check the ATO cap"). ATO figures: $27,500
 * (2021–22 to 2023–24), $30,000 (2024–25, 2025–26), $32,500 from 1 July 2026.
 */
export const SUPER_CONCESSIONAL_CAPS: Readonly<Record<number, number>> = {
  2021: 2_750_000,
  2022: 2_750_000,
  2023: 2_750_000,
  2024: 3_000_000,
  2025: 3_000_000,
  2026: 3_250_000,
};

/**
 * The statutory super guarantee rate by financial year (the FY start year). An FY outside the
 * table uses its nearest entry: 12 % from 1 July 2025 (the last legislated step).
 */
export const SUPER_SG_RATES: Readonly<Record<number, string>> = {
  2021: '0.1',
  2022: '0.105',
  2023: '0.11',
  2024: '0.115',
  2025: '0.12',
};

/** The SG rate from 1 July 2025 (the settings form's placeholder). */
export const SUPER_SG_RATE_DEFAULT = '0.12';

/** Payday Super: SG earned from this date counts in the month earned (§2.5 step 7). */
export const PAYDAY_SUPER_START: IsoDate = '2026-07-01';

/** Before Payday Super, a quarter's SG is due this many days after the quarter ends. */
export const SG_QUARTER_DUE_DAYS = 28;

/** The default contributions tax on concessional contributions (`super.contributionsTaxRate`). */
export const SUPER_CONTRIBUTIONS_TAX_DEFAULT = '0.15';

/** The cap meter says `near` from this share of the cap (projected). */
export const SUPER_CAP_WARNING_RATIO = '0.9';

/** When the statutory figures above were last checked against ato.gov.au. */
export const SUPER_RATES_CHECKED_ON: IsoDate = '2026-09-26';

/** Repayments per year by frequency. */
export const PAYMENTS_PER_YEAR = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
} as const satisfies Record<PaymentFrequency, number>;

/** The loan form's compounding choices (monthly, fortnightly, weekly, daily); the engine takes any integer ≥ 1. */
export const COMPOUNDING_CHOICES = [12, 26, 52, 365] as const;

/** `otherAssets.stalePriceDays` when unset (D77). */
export const OTHER_ASSET_STALE_DAYS_DEFAULT = 90;

/** The web shows "—" for an annualised figure held for fewer days (the Stage 2 rule). */
export const ANNUALISED_MIN_DAYS = 90;

/** An other asset's currency: a 3-letter ISO 4217 code (`GBX`, UK pence, included). */
export function isOtherAssetCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayOf(date: IsoDate, name: string): number {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new RangeError(`paymentDatesBetween: ${name} must be YYYY-MM-DD, got ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

function isoOfDay(day: number): IsoDate {
  const d = new Date(day * MS_PER_DAY);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/**
 * The loan's payment grid dates in `(after, through]`, in date order (stage-4.md §2.3): monthly
 * payments fall on `addMonthsIso(anchor, k)` (EDATE clamping, always from the anchor, never
 * chained), fortnightly on `anchor + 14k` days and weekly on `anchor + 7k` days, for `k ≥ 1`. The
 * anchor itself is never a payment date. Empty when `through ≤ after`. Pure (no clock); the engine
 * counts a balance log's payments with it and the web's repayment placeholder uses the same dates.
 */
export function paymentDatesBetween(
  anchor: IsoDate,
  frequency: PaymentFrequency,
  after: IsoDate,
  through: IsoDate,
): IsoDate[] {
  const a = dayOf(anchor, 'anchor');
  const lo = dayOf(after, 'after');
  const hi = dayOf(through, 'through');
  const dates: IsoDate[] = [];
  if (hi <= lo) return dates;
  if (frequency === 'monthly') {
    // Start a month before `after`'s month offset (never below 1); addMonthsIso clamps month ends.
    const [ay, am] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
    const [ly, lm] = [Number(after.slice(0, 4)), Number(after.slice(5, 7))];
    let k = Math.max(1, (ly - ay) * 12 + (lm - am) - 1);
    for (;;) {
      const date = addMonthsIso(anchor, k);
      const day = dayOf(date, 'grid');
      if (day > hi) break;
      if (day > lo) dates.push(date);
      k += 1;
    }
    return dates;
  }
  const step = frequency === 'fortnightly' ? 14 : 7;
  let k = Math.max(1, Math.floor((lo - a) / step));
  for (;;) {
    const day = a + step * k;
    if (day > hi) break;
    if (day > lo) dates.push(isoOfDay(day));
    k += 1;
  }
  return dates;
}
