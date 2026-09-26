// Australian resident tax tables for the marginal-rate suggestion (stage-5.md §3.2, §3.3; D85).
// Public ATO figures recorded 2026-09-26 from web-search summaries of ato.gov.au ("Tax rates –
// Australian resident", "Medicare levy reduction for low-income earners", "Low income tax offset")
// and adviser pages (the ATO site refuses automated fetches). Check them each July (D85).

/** One tax band: the rate applies to income above `thresholdCents` (up to the next band's). */
export interface TaxBand {
  thresholdCents: number;
  ratio: string;
}

const bands = (secondRatio: string): readonly TaxBand[] => [
  { thresholdCents: 0, ratio: '0' },
  { thresholdCents: 1_820_000, ratio: secondRatio },
  { thresholdCents: 4_500_000, ratio: '0.3' },
  { thresholdCents: 13_500_000, ratio: '0.37' },
  { thresholdCents: 19_000_000, ratio: '0.45' },
];

/**
 * FY start year → the resident bands, ascending. From 1 July 2026 the second band's rate is 15 %,
 * from 1 July 2027 14 % (the thresholds are unchanged).
 */
export const RESIDENT_TAX_TABLES: Readonly<Record<number, readonly TaxBand[]>> = {
  2024: bands('0.16'),
  2025: bands('0.16'),
  2026: bands('0.15'),
  2027: bands('0.14'),
};

/** The full Medicare levy. */
export const MEDICARE_LEVY_RATIO = '0.02';
/** The shade-in rate above the low-income threshold (10 cents per dollar). */
export const MEDICARE_SHADE_IN_RATIO = '0.1';
/** The shade-in ends at threshold × 1.25. */
export const MEDICARE_SHADE_IN_FACTOR = '1.25';
/**
 * FY start year → the singles low-income threshold (cents). The 2026–27 threshold had not been
 * announced when checked, so the suggestion falls back to 2025–26's.
 */
export const MEDICARE_LOW_INCOME_THRESHOLDS: Readonly<Record<number, number>> = {
  2024: 2_722_200,
  2025: 2_801_100,
};

/** The low income tax offset (not built) phases out above this income … */
export const LITO_PHASE_OUT_FROM_CENTS = 3_750_000;
/** … and reaches 0 here (5 cents per dollar to $45,000, then 1.5 cents per dollar). */
export const LITO_PHASE_OUT_TO_CENTS = 6_666_700;

/** When the figures above were checked (the Settings page shows it). */
export const TAX_RATES_CHECKED_ON = '2026-09-26';
