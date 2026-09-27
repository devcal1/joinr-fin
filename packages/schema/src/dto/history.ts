// History and Net Worth API (stage-5.md §4.3–4.4, frozen): the request schemas of the history and
// net-worth routes and their response DTOs. Money is integer cents; ratios are decimal strings;
// dates are IsoDate, months IsoMonth. Every DTO is declared field by field here (`@joinr/schema`
// cannot import the engine's types; the server type-checks the mapping). `YearWindowDto` and
// `CashChartPointDto` (dto/cashflow.ts), `ConsiderNextRowDto` (dto/investments.ts) and
// `JobRunSummary` (dto/prices.ts) are reused, never redeclared.
import { z } from 'zod';
import {
  CHART_DATE_UNITS,
  type AssetClass,
  type ChartDateUnit,
  type ConsiderReason,
  type MarketDataMode,
  type NetWorthClass,
  type NetWorthLiability,
  type Origin,
  type RecordTrigger,
  type SnapshotAuditAction,
  type SnapshotCheckColumn,
  type SnapshotSource,
  type YearBasis,
} from '../enums';
import {
  CORRECTABLE_SNAPSHOT_COLUMNS,
  RECORD_MONTHS_MAX,
  type CorrectableSnapshotColumn,
} from '../history';
import {
  IsoMonthSchema,
  type DecimalString,
  type IsoDate,
  type IsoMonth,
  type IsoTimestamp,
} from '../primitives';
import type { CashChartPointDto, YearWindowDto } from './cashflow';
import { optionalText, signedCents } from './fields';
import { intQuery } from './fire';
import type { ConsiderNextRowDto } from './investments';
import type { JobRunSummary } from './prices';

// ─── Request schemas (§4.3) ─────────────────────────────────────────────────────────────────────

/** The most groups a `count` query may ask for (= the `charts.unitCount` write bound). */
export const CHART_COUNT_MAX = 240;

/**
 * `GET /api/net-worth` query: a view-only override of the chart settings (nothing is saved).
 * `count` is coerced from the query string.
 */
export const netWorthQuerySchema = z.strictObject({
  unit: z.enum(CHART_DATE_UNITS).optional(),
  count: intQuery(1, CHART_COUNT_MAX).optional(),
});
export type NetWorthQuery = z.output<typeof netWorthQuerySchema>;

/** `GET /api/history/series` query (the aggregation API): the same fields. */
export const historySeriesQuerySchema = netWorthQuerySchema;
export type HistorySeriesQuery = NetWorthQuery;

function localIsoMonth(d: Date): IsoMonth {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * `POST /api/history/record` body, with an injectable clock: 1–RECORD_MONTHS_MAX distinct months,
 * each on or before the local month of `now()` ('periodMonths.N: after this month'). The server
 * also requires every month to be recordable (`recordableMonths`, §4.5). `note`: `''` → null.
 */
export function makeRecordRequestSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      periodMonths: z
        .array(IsoMonthSchema)
        .min(1, { error: 'must list at least one month' })
        .max(RECORD_MONTHS_MAX, { error: `must list at most ${RECORD_MONTHS_MAX} months` }),
      note: optionalText(200),
    })
    .superRefine((body, ctx) => {
      if (new Set(body.periodMonths).size !== body.periodMonths.length) {
        ctx.addIssue({ code: 'custom', path: ['periodMonths'], message: 'a month appears twice' });
      }
      const current = localIsoMonth(now());
      body.periodMonths.forEach((m, i) => {
        if (m > current) {
          ctx.addIssue({ code: 'custom', path: ['periodMonths', i], message: 'after this month' });
        }
      });
    });
}
export const recordRequestSchema = makeRecordRequestSchema();
export type RecordRequest = z.output<typeof recordRequestSchema>;
export type RecordRequestBody = z.input<typeof recordRequestSchema>;

/** The most columns one correction may name (every correctable column). */
export const CORRECTION_COLUMNS_MAX = CORRECTABLE_SNAPSHOT_COLUMNS.length;

/**
 * The stored sign of each bounded correctable column (§4.3): the offsets are ≥ 0, accounts in
 * debit and the mortgage balance ≤ 0 (the web negates the positive "owed" figures it shows).
 */
export const CORRECTION_SIGN_BOUNDS: Readonly<
  Partial<Record<CorrectableSnapshotColumn, 'non_negative' | 'non_positive'>>
> = {
  offsetCents: 'non_negative',
  mortgageOffsetCents: 'non_negative',
  cashDebtCents: 'non_positive',
  mortgageBalanceCents: 'non_positive',
};

/**
 * `PUT /api/history/snapshots/:periodMonth` body: 1–24 correctable columns (null clears a cell),
 * the per-column sign bounds, and a required reason. The server adds the row-dependent rules:
 * the offset extras are refused on a migrated row and cannot be null on any other (§4.5).
 */
export const snapshotCorrectionSchema = z
  .strictObject({
    values: z.partialRecord(z.enum(CORRECTABLE_SNAPSHOT_COLUMNS), signedCents.nullable()),
    note: z
      .string()
      .trim()
      .min(1, { error: 'say why' })
      .max(200, { error: 'must be at most 200 characters' }),
  })
  .superRefine((body, ctx) => {
    const entries = Object.entries(body.values) as [CorrectableSnapshotColumn, number | null][];
    if (entries.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'name at least one figure' });
      return;
    }
    for (const [column, value] of entries) {
      if (value === null || value === undefined) continue;
      const bound = CORRECTION_SIGN_BOUNDS[column];
      if (bound === 'non_negative' && value < 0) {
        ctx.addIssue({ code: 'custom', path: ['values', column], message: 'must not be negative' });
      }
      if (bound === 'non_positive' && value > 0) {
        ctx.addIssue({ code: 'custom', path: ['values', column], message: 'must not be positive' });
      }
    }
  });
export type SnapshotCorrection = z.output<typeof snapshotCorrectionSchema>;
export type SnapshotCorrectionBody = z.input<typeof snapshotCorrectionSchema>;

// ─── DTOs (§4.4, frozen field lists) ────────────────────────────────────────────────────────────

// ─── Shared ───

/** = the engine's SnapshotFigures (Cents → number). */
export interface SnapshotFiguresDto {
  stocksValueCents: number | null;
  stocksGainCents: number | null;
  stocksGainRatio: DecimalString | null;
  stocksMovementsCents: number | null;
  etfValueCents: number | null;
  etfGainCents: number | null;
  etfGainRatio: DecimalString | null;
  etfMovementsCents: number | null;
  cryptoValueCents: number | null;
  cryptoGainCents: number | null;
  cryptoGainRatio: DecimalString | null;
  cryptoMovementsCents: number | null;
  cashValueCents: number | null;
  cashGainCents: number | null;
  cashIncreaseRatio: DecimalString | null;
  superValueCents: number | null;
  superContribCents: number | null;
  superGainCents: number | null;
  superGainRatio: DecimalString | null;
  liabilitiesBalanceCents: number | null;
  liabilitiesPaidCents: number | null;
  salaryMonthlyCents: number | null;
  propertyValueCents: number | null;
  propertyPurchaseCents: number | null;
  propertyEquityCents: number | null;
  propertyGainCents: number | null;
  mortgageBalanceCents: number | null;
  mortgageInterestFeesCents: number | null;
  mortgagePrincipalPaidCents: number | null;
  propertyGainRatio: DecimalString | null;
  mfValueCents: number | null;
  mfGainCents: number | null;
  mfGainRatio: DecimalString | null;
  mfMovementsCents: number | null;
  otherValueCents: number | null;
  otherGainCents: number | null;
  offsetCents: number | null;
  mortgageOffsetCents: number | null;
  cashDebtCents: number | null;
  superMeasuredThrough: IsoDate | null;
}

/** = the engine's NetWorthBreakdown (Cents → number). */
export interface NetWorthBreakdownDto {
  liquidCents: number;
  superCents: number;
  propertyCents: number;
  liabilitiesCents: number;
  offsetsCents: number;
  netWorthCents: number;
  /** The value columns (SnapshotFiguresDto keys) that were null and counted 0. */
  missing: string[];
}

export interface SnapshotDto {
  id: number;
  periodMonth: IsoMonth;
  runDate: IsoDate;
  source: SnapshotSource;
  recordedAt: string | null;
  origin: Origin;
  sheetRef: string | null;
  note: string | null;
  revision: number;
  figures: SnapshotFiguresDto;
  netWorth: NetWorthBreakdownDto;
  /** Source 'late' or 'lookback' (the "Recorded late" badge). */
  late: boolean;
  /** Another month has the same run date (§2.9). */
  sharedRunDate: boolean;
  /** The period's adjusted savings rate (the savings engine). */
  savingsRatio: DecimalString | null;
  /** §2.5 for this row. */
  check: { checked: number; differences: SnapshotDifferenceDto[] };
  /** The latest and not migrated. */
  deletable: boolean;
}

export interface SnapshotDifferenceDto {
  column: SnapshotCheckColumn;
  kind: 'derived' | 'movement';
  storedCents: number | null;
  recomputedCents: number | null;
  storedRatio: DecimalString | null;
  recomputedRatio: DecimalString | null;
}

export interface SnapshotAuditDto {
  id: number;
  periodMonth: IsoMonth;
  action: SnapshotAuditAction;
  trigger: RecordTrigger;
  at: string;
  note: string | null;
  /** key: "column" or "YYYY-MM.column" (the next month's derived follow-ups). */
  changes: { key: string; before: number | string | null; after: number | string | null }[];
  detail: {
    pricesAsOf: string | null;
    marketMode: MarketDataMode | null;
    pricesRefreshed: boolean | null;
  } | null;
}

/** The recorder's status (§4.6; the server's `RecorderStatus` is this type). */
export interface RecorderStatusDto {
  /** env: AUTO_RECORD is set (the switch is locked). */
  autoRecord: { enabled: boolean; source: 'setting' | 'env' };
  /** The date auto-record was last switched on (the catch-up floor, §2.9). */
  since: IsoDate | null;
  /** SNAPSHOT_RECORD_HOUR. */
  recordHour: number;
  /** The next month-end record time (local, ISO with offset); null when off. */
  nextRunAt: string | null;
  running: boolean;
  /** The scheduler's `snapshot` job. */
  lastRun: JobRunSummary | null;
  /** recordingsDue().blocked now (§2.9; D94). */
  blocked: { periodMonth: IsoMonth; missing: IsoMonth[] } | null;
}

// ─── History ───

export interface HistoryPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  hasAppData: boolean;
  /** Newest first (run-date order reversed). */
  snapshots: SnapshotDto[];
  /** Null when asOf ≤ the last run. */
  live: {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    figures: SnapshotFiguresDto;
    netWorth: NetWorthBreakdownDto;
    pricesAsOf: string | null;
    unpricedCount: number;
    stalePriceCount: number;
  } | null;
  record: {
    /** §2.9. */
    nextMonth: IsoMonth;
    recordable: IsoMonth[];
    /** §6.4: the ended months; else the current month. */
    defaultMonths: IsoMonth[];
    /** Recordable months that have ended. */
    missing: IsoMonth[];
    /** Months between the first and the latest snapshot with no snapshot (never recordable). */
    gaps: IsoMonth[];
  };
  recorder: RecorderStatusDto;
  consistency: {
    checked: number;
    matched: number;
    migratedChecked: number;
    migratedMatched: number;
    /** Σ of the rows' checks (cells). */
    movementDifferences: number;
    derivedDifferences: number;
    migratedMonths: number;
    /** Imported months whose stored figures all reproduce (§6.4 item 7). */
    derivedMatchedMonths: number;
    /** Months with a movement difference (information, never a failure). */
    movementMonths: IsoMonth[];
  };
  /** Newest first, at most 200. */
  audit: SnapshotAuditDto[];
  /** The "What you own" chart (§5). */
  charts: { unit: ChartDateUnit; count: number | null; groups: SnapshotGroupDto[] };
}

/** = the engine's SnapshotGroup (Cents → number). */
export interface SnapshotGroupDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  rows: number;
  figures: SnapshotFiguresDto;
  netWorth: NetWorthBreakdownDto;
  growthCents: number | null;
  liquidGrowthCents: number | null;
}

export interface HistorySeriesResponse {
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
  groups: SnapshotGroupDto[];
  modes: Record<string, 'end' | 'sum' | 'ratio'>;
}

/** Ascending month order. */
export interface RecordResponse {
  recorded: SnapshotDto[];
  hasAppData: boolean;
}

export interface CorrectionResponse {
  snapshot: SnapshotDto;
  next: SnapshotDto | null;
  audit: SnapshotAuditDto;
}

export interface DeleteSnapshotResponse {
  periodMonth: IsoMonth;
  audit: SnapshotAuditDto;
  hasAppData: boolean;
}

// ─── Net worth ───

export interface NetWorthChangeDto {
  base: { periodMonth: IsoMonth; runDate: IsoDate; netWorthCents: number } | null;
  cents: number | null;
  ratio: DecimalString | null;
}

/** = the engine's RollingNetWorthRow (Cents → number; `breakdown` → `netWorth`). */
export interface RollingNetWorthRowDto {
  periodMonth: IsoMonth;
  runDate: IsoDate | null;
  status: 'recorded' | 'live' | 'projected';
  source: SnapshotSource | null;
  netWorth: NetWorthBreakdownDto | null;
  growthCents: number | null;
  liquidGrowthCents: number | null;
  savingsRatio: DecimalString | null;
  rawSavingsRatio: DecimalString | null;
  projectedLiquidCents: number | null;
}

/** = the engine's TrendResult (Cents → number). */
export interface TrendDto {
  fittedCents: (number | null)[];
  slopePerMonthCents: number | null;
  points: number;
}

/** One loan's line under Mortgages on the Net Worth page (display only; §6.3 item 4). */
export interface MortgageLoanLineDto {
  loanId: number;
  name: string;
  propertyName: string | null;
  /** grossCents − offsetCents (the loan's net balance). */
  balanceCents: number;
  /** |the loan's balance|. */
  grossCents: number;
  /** The linked offsets applied to this loan, capped at its balance (§2.6 step 2). */
  offsetCents: number;
}

export interface NetWorthPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  lastRun: IsoDate | null;
  liveMonth: IsoMonth;
  /** The callout choice of §6.3 item 3 (D84). */
  hasAppData: boolean;
  /** recordableMonths (the Record month action shows when non-empty). */
  recordable: IsoMonth[];
  /** No provisional period: `live` is the latest snapshot (§4.5). */
  recordedToday: boolean;
  live: { figures: SnapshotFiguresDto; netWorth: NetWorthBreakdownDto };
  assetsCents: number;
  liabilitiesCents: number;
  assetsExSuperCents: number;
  classes: {
    key: NetWorthClass;
    valueCents: number;
    gainCents: number | null;
    gainRatio: DecimalString | null;
  }[];
  liabilities: {
    key: NetWorthLiability;
    balanceCents: number;
    grossCents: number;
    offsetCents: number;
  }[];
  /**
   * Fixer round 1 (SPEC-1, additive): the per-loan display lines under Mortgages (§6.3 item 4), from
   * the property result: the loans with a property (History AB), in page order. Display only; every
   * table figure stays from `live`. Empty when Σ `grossCents` differs from the `mortgages` row's.
   */
  mortgageLoans?: MortgageLoanLineDto[];
  sinceLastRecord: NetWorthChangeDto;
  thisYear: NetWorthChangeDto & { year: YearWindowDto };
  distribution: {
    values: { key: NetWorthClass; valueCents: number }[];
    /** Up to 8, no fold (D93). */
    slices: { key: NetWorthClass; valueCents: number; ratio: DecimalString }[];
    excluded: { key: NetWorthClass; valueCents: number }[];
    drawnCents: number;
  };
  savingsRate: {
    ratio: DecimalString | null;
    rawRatio: DecimalString | null;
    year: YearWindowDto;
    periods: number;
    targetRatio: DecimalString | null;
  };
  averageSavings: { monthCents: number | null; yearCents: number | null; periods: number };
  allocation: {
    assetClass: AssetClass | null;
    reason: ConsiderReason;
    rows: ConsiderNextRowDto[];
    /** Σ allocation.* (the Settings warning, §6.5). */
    targetSumRatio: DecimalString | null;
  };
  prices: {
    unpricedCount: number;
    stalePriceCount: number;
    lastRefreshAt: string | null;
    mode: MarketDataMode;
  };
  recorder: RecorderStatusDto;
  /** Oldest first: recorded, live, projected (the web shows newest first by default). */
  rolling: RollingNetWorthRowDto[];
  charts: {
    unit: ChartDateUnit;
    count: number | null;
    yearBasis: YearBasis;
    /** Historical net worth, liquid assets and the tracker read these. */
    groups: SnapshotGroupDto[];
    /** compressCashflow (the Stage 3 DTO, reused). */
    savings: CashChartPointDto[];
    /** Fitted per group, in `groups` order. */
    trends: { liquid: TrendDto; tracker: TrendDto };
  };
  /** The spend notes (the rolling table's U). */
  notes: { periodMonth: IsoMonth; text: string }[];
}
