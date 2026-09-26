// History and net worth constants (stage-5.md §3.2): the snapshot figure shape, the aggregation
// mode per column, the correctable columns, the column labels, the record constants, the chart
// stack order and colour slots. Generic, dependency-free (root export).
import type { NetWorthClass } from './enums';
import type { DecimalString, IsoDate, IsoMonth } from './primitives';
import type { SettingKey } from './settings';

/**
 * One History row (B…AK) plus the Stage 5 extras, camelCase of the `snapshots` table; money in
 * integer cents. The engine's `SnapshotFigures` is the same shape (a type-level test asserts both
 * directions).
 */
export interface SnapshotFiguresShape {
  stocksValueCents: number | null; // B
  stocksGainCents: number | null; // C
  stocksGainRatio: DecimalString | null; // D
  stocksMovementsCents: number | null; // E
  etfValueCents: number | null; // F
  etfGainCents: number | null; // G
  etfGainRatio: DecimalString | null; // H
  etfMovementsCents: number | null; // I
  cryptoValueCents: number | null; // J
  cryptoGainCents: number | null; // K
  cryptoGainRatio: DecimalString | null; // L
  cryptoMovementsCents: number | null; // M
  cashValueCents: number | null; // N
  cashGainCents: number | null; // O
  cashIncreaseRatio: DecimalString | null; // P
  superValueCents: number | null; // Q
  superContribCents: number | null; // R
  superGainCents: number | null; // S
  superGainRatio: DecimalString | null; // T
  liabilitiesBalanceCents: number | null; // U
  liabilitiesPaidCents: number | null; // V
  salaryMonthlyCents: number | null; // W
  propertyValueCents: number | null; // X
  propertyPurchaseCents: number | null; // Y
  propertyEquityCents: number | null; // Z
  propertyGainCents: number | null; // AA
  mortgageBalanceCents: number | null; // AB
  mortgageInterestFeesCents: number | null; // AC
  mortgagePrincipalPaidCents: number | null; // AD
  propertyGainRatio: DecimalString | null; // AE
  mfValueCents: number | null; // AF
  mfGainCents: number | null; // AG
  mfGainRatio: DecimalString | null; // AH
  mfMovementsCents: number | null; // AI
  otherValueCents: number | null; // AJ
  otherGainCents: number | null; // AK
  // Stage 5 extras (migration 0005; null on migrated rows).
  offsetCents: number | null;
  mortgageOffsetCents: number | null;
  cashDebtCents: number | null;
  superMeasuredThrough: IsoDate | null;
}
export type SnapshotFigureKey = keyof SnapshotFiguresShape;

/**
 * Every figure column in History table order (B…AK), then the four extras. (§3.2 calls it
 * `SNAPSHOT_VALUE_COLUMNS`; that name was already the records registry's column list, records.ts.)
 */
export const SNAPSHOT_FIGURE_COLUMNS = [
  'stocksValueCents',
  'stocksGainCents',
  'stocksGainRatio',
  'stocksMovementsCents',
  'etfValueCents',
  'etfGainCents',
  'etfGainRatio',
  'etfMovementsCents',
  'cryptoValueCents',
  'cryptoGainCents',
  'cryptoGainRatio',
  'cryptoMovementsCents',
  'cashValueCents',
  'cashGainCents',
  'cashIncreaseRatio',
  'superValueCents',
  'superContribCents',
  'superGainCents',
  'superGainRatio',
  'liabilitiesBalanceCents',
  'liabilitiesPaidCents',
  'salaryMonthlyCents',
  'propertyValueCents',
  'propertyPurchaseCents',
  'propertyEquityCents',
  'propertyGainCents',
  'mortgageBalanceCents',
  'mortgageInterestFeesCents',
  'mortgagePrincipalPaidCents',
  'propertyGainRatio',
  'mfValueCents',
  'mfGainCents',
  'mfGainRatio',
  'mfMovementsCents',
  'otherValueCents',
  'otherGainCents',
  'offsetCents',
  'mortgageOffsetCents',
  'cashDebtCents',
  'superMeasuredThrough',
] as const satisfies readonly SnapshotFigureKey[];

/**
 * How `aggregateSnapshots` combines a group's rows (§2.7): `end` = the group's last row (values,
 * gains, balances, the cumulative mortgage columns, the extras); `sum` = Σ of the rows (the four
 * movement columns, R, W and the cash change O, §11 fix 4; a sum of nulls is null); `ratio` =
 * recomputed from the group's aggregated cents.
 */
export const SNAPSHOT_COLUMN_MODES: Readonly<Record<SnapshotFigureKey, 'end' | 'sum' | 'ratio'>> = {
  stocksValueCents: 'end',
  stocksGainCents: 'end',
  stocksGainRatio: 'ratio',
  stocksMovementsCents: 'sum',
  etfValueCents: 'end',
  etfGainCents: 'end',
  etfGainRatio: 'ratio',
  etfMovementsCents: 'sum',
  cryptoValueCents: 'end',
  cryptoGainCents: 'end',
  cryptoGainRatio: 'ratio',
  cryptoMovementsCents: 'sum',
  cashValueCents: 'end',
  cashGainCents: 'sum',
  cashIncreaseRatio: 'ratio',
  superValueCents: 'end',
  superContribCents: 'sum',
  superGainCents: 'end',
  superGainRatio: 'ratio',
  liabilitiesBalanceCents: 'end',
  liabilitiesPaidCents: 'end',
  salaryMonthlyCents: 'sum',
  propertyValueCents: 'end',
  propertyPurchaseCents: 'end',
  propertyEquityCents: 'end',
  propertyGainCents: 'end',
  mortgageBalanceCents: 'end',
  mortgageInterestFeesCents: 'end',
  mortgagePrincipalPaidCents: 'end',
  propertyGainRatio: 'ratio',
  mfValueCents: 'end',
  mfGainCents: 'end',
  mfGainRatio: 'ratio',
  mfMovementsCents: 'sum',
  otherValueCents: 'end',
  otherGainCents: 'end',
  offsetCents: 'end',
  mortgageOffsetCents: 'end',
  cashDebtCents: 'end',
  superMeasuredThrough: 'end',
};

/** The primary figures a correction may set (§4.3, §4.5); derived and movement columns never. */
export const CORRECTABLE_SNAPSHOT_COLUMNS = [
  'stocksValueCents',
  'stocksGainCents',
  'etfValueCents',
  'etfGainCents',
  'cryptoValueCents',
  'cryptoGainCents',
  'cashValueCents',
  'superValueCents',
  'superContribCents',
  'superGainCents',
  'salaryMonthlyCents',
  'propertyValueCents',
  'propertyPurchaseCents',
  'propertyGainCents',
  'mortgageBalanceCents',
  'mortgageInterestFeesCents',
  'mortgagePrincipalPaidCents',
  'mfValueCents',
  'mfGainCents',
  'otherValueCents',
  'otherGainCents',
  'offsetCents',
  'mortgageOffsetCents',
  'cashDebtCents',
] as const satisfies readonly SnapshotFigureKey[];
export type CorrectableSnapshotColumn = (typeof CORRECTABLE_SNAPSHOT_COLUMNS)[number];

/** The extras a correction may set on non-migrated rows only (never null there; §4.3). */
export const SNAPSHOT_OFFSET_EXTRAS = [
  'offsetCents',
  'mortgageOffsetCents',
  'cashDebtCents',
] as const satisfies readonly CorrectableSnapshotColumn[];
export type SnapshotOffsetExtra = (typeof SNAPSHOT_OFFSET_EXTRAS)[number];

/** Plain-word labels per figure column, with the History column letter (null for the extras). */
// prettier-ignore
export const SNAPSHOT_COLUMN_LABELS: Readonly<
  Record<SnapshotFigureKey, { label: string; historyColumn: string | null }>
> = {
  stocksValueCents: { label: 'Stocks value', historyColumn: 'B' },
  stocksGainCents: { label: 'Stocks gain', historyColumn: 'C' },
  stocksGainRatio: { label: 'Stocks gain %', historyColumn: 'D' },
  stocksMovementsCents: { label: 'Stock movements', historyColumn: 'E' },
  etfValueCents: { label: 'ETFs value', historyColumn: 'F' },
  etfGainCents: { label: 'ETFs gain', historyColumn: 'G' },
  etfGainRatio: { label: 'ETFs gain %', historyColumn: 'H' },
  etfMovementsCents: { label: 'ETF movements', historyColumn: 'I' },
  cryptoValueCents: { label: 'Crypto value', historyColumn: 'J' },
  cryptoGainCents: { label: 'Crypto gain', historyColumn: 'K' },
  cryptoGainRatio: { label: 'Crypto gain %', historyColumn: 'L' },
  cryptoMovementsCents: { label: 'Crypto movements', historyColumn: 'M' },
  cashValueCents: { label: 'Cash', historyColumn: 'N' },
  cashGainCents: { label: 'Cash change', historyColumn: 'O' },
  cashIncreaseRatio: { label: 'Cash change %', historyColumn: 'P' },
  superValueCents: { label: 'Super value', historyColumn: 'Q' },
  superContribCents: { label: 'Super contributions (take-home cost)', historyColumn: 'R' },
  superGainCents: { label: 'Super gain', historyColumn: 'S' },
  superGainRatio: { label: 'Super gain %', historyColumn: 'T' },
  liabilitiesBalanceCents: { label: 'Other debts', historyColumn: 'U' },
  liabilitiesPaidCents: { label: 'Other debts paid', historyColumn: 'V' },
  salaryMonthlyCents: { label: 'Monthly salary', historyColumn: 'W' },
  propertyValueCents: { label: 'Property value', historyColumn: 'X' },
  propertyPurchaseCents: { label: 'Property purchase price', historyColumn: 'Y' },
  propertyEquityCents: { label: 'Property equity', historyColumn: 'Z' },
  propertyGainCents: { label: 'Property gain', historyColumn: 'AA' },
  mortgageBalanceCents: { label: 'Mortgage balance', historyColumn: 'AB' },
  mortgageInterestFeesCents: { label: 'Mortgage interest and fees', historyColumn: 'AC' },
  mortgagePrincipalPaidCents: { label: 'Mortgage principal paid', historyColumn: 'AD' },
  propertyGainRatio: { label: 'Property gain %', historyColumn: 'AE' },
  mfValueCents: { label: 'Managed funds value', historyColumn: 'AF' },
  mfGainCents: { label: 'Managed funds gain', historyColumn: 'AG' },
  mfGainRatio: { label: 'Managed funds gain %', historyColumn: 'AH' },
  mfMovementsCents: { label: 'Managed fund movements', historyColumn: 'AI' },
  otherValueCents: { label: 'Other assets value', historyColumn: 'AJ' },
  otherGainCents: { label: 'Other assets gain', historyColumn: 'AK' },
  offsetCents: { label: 'Offset accounts', historyColumn: null },
  mortgageOffsetCents: { label: 'Linked offsets', historyColumn: null },
  cashDebtCents: { label: 'Accounts in debit', historyColumn: null },
  superMeasuredThrough: { label: 'Super measured to', historyColumn: null },
};

/** The most months one record request may name. */
export const RECORD_MONTHS_MAX = 24;

/** The rolling net-worth table's projected rows (§2.6 step 7). */
export const NET_WORTH_PROJECTION_MONTHS = 12;

/** The local hour on a month's last day when auto-record runs (§4.6; D89). */
export const SNAPSHOT_RECORD_HOUR = 23;

/** Every stacked chart, the distribution donut and the legends (§5). */
export const NET_WORTH_STACK_ORDER = [
  'stock',
  'etf',
  'crypto',
  'cash',
  'managed_fund',
  'other_assets',
  'super',
  'property',
] as const satisfies readonly NetWorthClass[];
export type NetWorthStackClass = (typeof NET_WORTH_STACK_ORDER)[number];

/**
 * The CHART_PALETTE slot (1–8) per drawable class (§5): validated for every stack order with one
 * class empty and for the eight-slice donut's ring (D93).
 */
export const NET_WORTH_CLASS_SLOTS = {
  stock: 2,
  etf: 5,
  crypto: 1,
  cash: 4,
  managed_fund: 3,
  other_assets: 8,
  super: 6,
  property: 7,
} as const satisfies Readonly<Record<NetWorthStackClass, number>>;

/** The 11 `features.*` setting keys (the sheet's First Time Setup toggles). */
export type FeatureKey = Extract<SettingKey, `features.${string}`>;

/** The last day of a month (`2027-02` → `2027-02-28`). Throws RangeError for a malformed month. */
export function monthEndOf(month: IsoMonth): IsoDate {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const year = m ? Number(m[1]) : NaN;
  const mon = m ? Number(m[2]) : NaN;
  if (!m || mon < 1 || mon > 12) throw new RangeError(`Invalid month: ${month}`);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mon - 1]!;
  return `${m[1]}-${m[2]}-${String(days)}`;
}
