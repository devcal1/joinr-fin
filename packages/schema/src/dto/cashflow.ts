// Cash flow API (stage-3.md §4.3–4.4, frozen): the request schemas of the Cash, Side Income,
// Budget, Dividends and settings routes, and their response DTOs (`DeletedResponse` is reused from
// dto/investments.ts). Money is integer cents; decimals are normalised strings; dates are IsoDate.
// Every DTO is declared field by field here (`@joinr/schema` cannot import the engine's types; the
// server type-checks the mapping).
import { z } from 'zod';
import { compareDecimals } from '../decimal';
import {
  CASH_ACCOUNT_KINDS,
  type AllocationAggressiveness,
  type BudgetItemKind,
  type CashAccountKind,
  type ChartDateUnit,
  type DividendSuggestionStatus,
  type DrpAdvice,
  type EditableNoteKind,
  type InstrumentKind,
  type KpiTrend,
  type MarketDataMode,
  type Origin,
  type PayFrequency,
  type ReviewFlag,
  type SavingsPeriodStatus,
  type YearBasis,
} from '../enums';
import {
  IsoDateSchema,
  type DecimalString,
  type IsoDate,
  type IsoMonth,
  type IsoTimestamp,
} from '../primitives';
import {
  isEditableSettingKey,
  settingDef,
  settingValueSchema,
  type EditableSettingKey,
  type SettingKey,
  type SettingValue,
} from '../settings';
import { MIN_TRADE_DATE, makeEntryDateSchema, tradeDecimalSchema } from './investments';

// ─── Field schemas ──────────────────────────────────────────────────────────────────────────────

/** The largest money amount a cash-flow body accepts: |x| ≤ $100m, in cents. */
export const CASHFLOW_MONEY_MAX = 10_000_000_000;

/** The latest target date a savings goal accepts. */
export const MAX_GOAL_DATE: IsoDate = '2200-12-31';

/**
 * A dated cash-flow entry (a balance, a deposit, a dividend payment): a real date, ≥ 01/01/1900
 * and ≤ tomorrow (the local calendar date at parse time), as the trade date rule.
 */
export function makeCashflowDateSchema(now: () => Date = () => new Date()): z.ZodType<IsoDate> {
  return makeEntryDateSchema(now);
}

const signedCents = z
  .number()
  .int({ error: 'must be whole cents' })
  .min(-CASHFLOW_MONEY_MAX, { error: 'is too large' })
  .max(CASHFLOW_MONEY_MAX, { error: 'is too large' });
const nonZeroCents = signedCents.refine((v) => v !== 0, { error: 'must not be zero' });
const nonNegativeCents = z
  .number()
  .int({ error: 'must be whole cents' })
  .min(0, { error: 'must not be negative' })
  .max(CASHFLOW_MONEY_MAX, { error: 'is too large' });

/** Required trimmed text of at most `max` characters. */
const name = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: 'is required' })
    .max(max, { error: `must be at most ${max} characters` });

/** Trimmed text; `''` → null (so a blank field never fails or flips `origin`). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `must be at most ${max} characters` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

const positiveId = z.number().int().positive();

/** A date in 1900-01-01 … 2200-12-31 (a savings goal's target date). */
const goalDateSchema = IsoDateSchema.refine((d) => d >= MIN_TRADE_DATE && d <= MAX_GOAL_DATE, {
  error: 'must be between 01/01/1900 and 31/12/2200',
});

/** Adds an issue at `path` for each id that appears more than once. */
function uniqueIds(
  ids: readonly number[],
  ctx: z.core.$RefinementCtx,
  path: string[],
  what: string,
) {
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) {
      ctx.addIssue({ code: 'custom', path, message: `${what} appears twice` });
      return;
    }
    seen.add(id);
  }
}

// ─── Cash (§4.2) ────────────────────────────────────────────────────────────────────────────────

/** `PUT /api/cash/accounts/:id` body. A kind-only change keeps `origin` (§3.4). */
export const cashAccountUpdateSchema = z.strictObject({
  name: name(80),
  kind: z.enum(CASH_ACCOUNT_KINDS),
  isOffset: z.boolean(),
  note: optionalText(200),
});
export type CashAccountUpdate = z.output<typeof cashAccountUpdateSchema>;

/** `POST /api/cash/accounts` body: the editable fields plus the opening balance and its date. */
export function makeCashAccountCreateSchema(now: () => Date = () => new Date()) {
  return cashAccountUpdateSchema.extend({
    openingBalanceCents: signedCents,
    asOf: makeCashflowDateSchema(now),
  });
}
export const cashAccountCreateSchema = makeCashAccountCreateSchema();
export type CashAccountCreate = z.output<typeof cashAccountCreateSchema>;

/**
 * `PUT /api/cash/balances` body (D58): one shared as-of date and the changed accounts' balances.
 * Each account appears at most once.
 */
export function makeCashBalancesInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      asOf: makeCashflowDateSchema(now),
      entries: z
        .array(
          z.strictObject({
            accountId: positiveId,
            balanceCents: signedCents,
            note: optionalText(200).optional(),
          }),
        )
        .min(1, { error: 'must list at least one account' })
        .max(200, { error: 'must list at most 200 accounts' }),
    })
    .superRefine((v, ctx) => {
      uniqueIds(
        v.entries.map((e) => e.accountId),
        ctx,
        ['entries'],
        'an account',
      );
    });
}
export const cashBalancesInputSchema = makeCashBalancesInputSchema();
export type CashBalancesInput = z.output<typeof cashBalancesInputSchema>;

/** `PUT /api/cash/adjustments/:periodMonth` body (D51): a signed, non-zero amount and a note. */
export const savingsAdjustmentInputSchema = z.strictObject({
  amountCents: nonZeroCents,
  note: name(200),
});
export type SavingsAdjustmentInput = z.output<typeof savingsAdjustmentInputSchema>;

/** `PUT /api/period-notes/:kind/:periodMonth` body; `''` deletes the note. */
export const periodNoteInputSchema = z.strictObject({
  note: z.string().trim().max(500, { error: 'must be at most 500 characters' }),
});

/** `POST /api/savings-goals` and `PUT /api/savings-goals/:id` body (D55). */
export const savingsGoalInputSchema = z.strictObject({
  name: name(80),
  targetCents: z
    .number()
    .int({ error: 'must be whole cents' })
    .positive({ error: 'must be greater than zero' })
    .max(CASHFLOW_MONEY_MAX, { error: 'is too large' }),
  targetDate: goalDateSchema.nullable(),
  note: optionalText(200),
});
export type SavingsGoalInput = z.output<typeof savingsGoalInputSchema>;

/** The reorder routes: every id exactly once (the route checks the set). */
export const reorderSchema = z
  .strictObject({
    ids: z
      .array(positiveId)
      .min(1, { error: 'must list at least one id' })
      .max(500, { error: 'must list at most 500 ids' }),
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.ids, ctx, ['ids'], 'an id');
  });

// ─── Side income ────────────────────────────────────────────────────────────────────────────────

/** `POST /api/side-income/deposits` and `PUT …/:id` body (D57). Negative = a reversal. */
export function makeDepositInputSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    streamId: positiveId,
    date: makeCashflowDateSchema(now),
    amountCents: nonZeroCents,
    note: optionalText(200),
  });
}
export const depositInputSchema = makeDepositInputSchema();
export type DepositInput = z.output<typeof depositInputSchema>;

export const incomeStreamInputSchema = z.strictObject({
  name: name(60),
  archived: z.boolean(),
});
export type IncomeStreamInput = z.output<typeof incomeStreamInputSchema>;

// ─── Budget ─────────────────────────────────────────────────────────────────────────────────────

/** `POST /api/budget/items` and `PUT …/:id` (kind `item` rows only). */
export const budgetItemInputSchema = z.strictObject({
  name: name(80),
  monthlyCents: nonNegativeCents,
  category: optionalText(40),
  accountId: positiveId.nullable(),
});
export type BudgetItemInput = z.output<typeof budgetItemInputSchema>;

/**
 * `PUT /api/budget/auto/:kind`: category and account; `manualMonthlyCents` is for the
 * `auto_invest` row only (D54: the typed amount while the automatic split is off; else 400).
 */
export const budgetAutoRowInputSchema = z.strictObject({
  category: optionalText(40),
  accountId: positiveId.nullable(),
  manualMonthlyCents: nonNegativeCents.nullable().optional(),
});
export type BudgetAutoRowInput = z.output<typeof budgetAutoRowInputSchema>;

export const yearlyExpenseInputSchema = z.strictObject({
  name: name(80),
  annualCents: nonNegativeCents,
});
export type YearlyExpenseInput = z.output<typeof yearlyExpenseInputSchema>;

// ─── Dividends ──────────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/dividends` and `PUT /api/dividends/:id` body. The ex-date is on or before the
 * payment date. `priceAtEx` omitted → filled from the events cache (§4.5); given → stored as typed.
 */
export function makeDividendInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      instrumentId: positiveId,
      paymentDate: makeCashflowDateSchema(now),
      exDate: IsoDateSchema.nullable(),
      reinvested: z.boolean().nullable(),
      netAmountCents: nonZeroCents,
      priceAtEx: tradeDecimalSchema(1e9).nullable().optional(),
      note: optionalText(200),
    })
    .superRefine((v, ctx) => {
      if (v.exDate !== null && v.exDate > v.paymentDate) {
        ctx.addIssue({ code: 'custom', path: ['exDate'], message: 'after the payment date' });
      }
    });
}
export const dividendInputSchema = makeDividendInputSchema();
export type DividendInput = z.output<typeof dividendInputSchema>;
export type DividendInputBody = z.input<typeof dividendInputSchema>;

/** A cached Yahoo event: the suggestion dismiss and restore routes. */
export const dividendEventKeySchema = z.strictObject({
  instrumentId: positiveId,
  exDate: IsoDateSchema,
});
export type DividendEventKey = z.output<typeof dividendEventKeySchema>;

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────

/**
 * The most keys one `PATCH /api/settings` body may change (Stage 4: 30, above the 22 editable
 * keys, so one PATCH can hold every editable key; stage-4.md §3.2).
 */
export const SETTINGS_PATCH_MAX_KEYS = 30;

/**
 * The largest whole number an editable integer setting without a registry maximum accepts
 * (`budget.emergencyFundMonths`: 1200 months = 100 years).
 */
export const SETTINGS_INTEGER_MAX = 1200;

/**
 * The write bounds of an editable setting (`PATCH /api/settings` only): a ratio within its
 * registry min..max, money up to CASHFLOW_MONEY_MAX, an integer up to its registry max or
 * SETTINGS_INTEGER_MAX. `settingValueSchema` itself stays lenient, because the importer and the
 * database reader use it for values the workbook holds. Returns the issue message, or null.
 */
function settingWriteBoundIssue(key: EditableSettingKey, value: SettingValue): string | null {
  const def = settingDef(key);
  if (def.type === 'ratio' && typeof value === 'string') {
    const below = def.min !== undefined && compareDecimals(value, String(def.min)) < 0;
    const above = def.max !== undefined && compareDecimals(value, String(def.max)) > 0;
    if (below || above) return `must be between ${def.min ?? 0} and ${def.max ?? 1}`;
  }
  if (def.type === 'money' && typeof value === 'number' && value > CASHFLOW_MONEY_MAX) {
    return 'is too large';
  }
  if (
    def.type === 'integer' &&
    typeof value === 'number' &&
    def.max === undefined &&
    value > SETTINGS_INTEGER_MAX
  ) {
    return `must be at most ${SETTINGS_INTEGER_MAX}`;
  }
  return null;
}

export interface SettingsPatch {
  values: Partial<Record<EditableSettingKey, SettingValue | null>>;
}

/**
 * `PATCH /api/settings` body: 1–SETTINGS_PATCH_MAX_KEYS keys, each in EDITABLE_SETTING_KEYS (else
 * `values.<key>: not editable here`), each value parsed with `settingValueSchema(key)`, or null
 * (stored as JSON null, read as unset). A parsed value must also meet the write bounds: a ratio
 * within the registry's min..max (`values.<key>: must be between 0 and 1`), money up to
 * CASHFLOW_MONEY_MAX (`is too large`), and an integer with no registry maximum up to
 * SETTINGS_INTEGER_MAX (`must be at most 1200`), so no stored setting can break a page.
 */
export const settingsPatchSchema: z.ZodType<SettingsPatch> = z
  .strictObject({ values: z.record(z.string(), z.unknown()) })
  .transform((body, ctx): SettingsPatch => {
    const keys = Object.keys(body.values);
    if (keys.length === 0 || keys.length > SETTINGS_PATCH_MAX_KEYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message: `must hold 1 to ${SETTINGS_PATCH_MAX_KEYS} settings`,
      });
      return z.NEVER;
    }
    const values: SettingsPatch['values'] = {};
    let failed = false;
    for (const key of keys) {
      if (!isEditableSettingKey(key)) {
        ctx.addIssue({ code: 'custom', path: ['values', key], message: 'not editable here' });
        failed = true;
        continue;
      }
      const raw = body.values[key];
      if (raw === null) {
        values[key] = null;
        continue;
      }
      const parsed = settingValueSchema(key).safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['values', key, ...issue.path.map(String)],
            message: issue.message,
          });
        }
        failed = true;
        continue;
      }
      const bound = settingWriteBoundIssue(key, parsed.data);
      if (bound !== null) {
        ctx.addIssue({ code: 'custom', path: ['values', key], message: bound });
        failed = true;
        continue;
      }
      values[key] = parsed.data;
    }
    return failed ? z.NEVER : { values };
  });

// ─── DTOs (§4.4, frozen field lists) ────────────────────────────────────────────────────────────

/** The settings a page edits (the registry's keys; `origins[key]` null = never stored). */
export interface SettingsSliceDto {
  values: Partial<Record<SettingKey, SettingValue | null>>;
  origins: Partial<Record<SettingKey, Origin | null>>;
}

// ─── Cash ───

export interface CashAccountDto {
  id: number;
  name: string;
  kind: CashAccountKind;
  isOffset: boolean;
  currency: string;
  balanceCents: number;
  balanceAsOf: IsoDate | null;
  /** False for offsets. */
  inTotalCash: boolean;
  /** Follows the server's LOANS_COUNT_FOR_EMERGENCY_FUND (D59) and the offsets setting (D56). */
  countsForEmergencyFund: boolean;
  note: string | null;
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
  entryCount: number;
  /** Delete needs budgetRowCount 0. */
  budgetRowCount: number;
  /** Stage 4 (D67, additive): the loan an offset account is linked to; null otherwise. */
  linkedLoan: { id: number; name: string } | null;
}

export interface CashBalanceEntryDto {
  id: number;
  accountId: number;
  asOf: IsoDate;
  balanceCents: number;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface CashTotalsDto {
  totalCashCents: number;
  byKind: Record<CashAccountKind, number>;
  offsetCents: number;
  loansCents: number;
  availableCashCents: number;
  emergencyFundTestCents: number;
  emergencyFund: {
    targetCents: number | null;
    covered: boolean | null;
    shortfallCents: number | null;
    offsetsIncluded: boolean;
    /** The §4.5 constant (false: D59). */
    loansIncluded: boolean;
  };
}

export interface SavingsFiguresDto {
  incomeCents: number | null;
  savingsCents: number | null;
  savingsRatio: DecimalString | null;
  spendCents: number | null;
}

export interface SavingsAdjustmentDto {
  periodMonth: IsoMonth;
  amountCents: number;
  note: string;
}

export interface PeriodNoteDto {
  periodMonth: IsoMonth;
  kind: EditableNoteKind;
  note: string;
  origin: Origin;
  sheetRef: string | null;
}

export interface SavingsPeriodDto {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  after: IsoDate | null;
  through: IsoDate;
  status: SavingsPeriodStatus;
  cashCents: number | null;
  cashGainCents: number | null;
  cashGainRatio: DecimalString | null;
  addedInvestmentsCents: number | null;
  added: {
    tradesCents: number;
    otherAssetsCents: number;
    superCents: number;
    mortgagePrincipalCents: number;
    propertyDepositCents: number;
    /** Stage 4 (additive; §11 fix 7): Δ offset balances; 0 unless both sides are known. */
    offsetsCents: number;
  } | null;
  income: {
    salaryCents: number | null;
    sideIncomeCents: number;
    cashDividendsCents: number;
    otherDividendsCents: number;
  } | null;
  adjustment: SavingsAdjustmentDto | null;
  raw: SavingsFiguresDto;
  adjusted: SavingsFiguresDto;
  spendNote: PeriodNoteDto | null;
}

/** = the engine's YearWindow ([start, end); year = the FY start year or the calendar year). */
export interface YearWindowDto {
  basis: YearBasis;
  start: IsoDate;
  end: IsoDate;
  year: number;
}

/** = the engine's CashKpisResult, field for field (Cents → number). */
export interface CashKpisDto {
  anchor: IsoDate | null;
  year: YearWindowDto;
  lastPeriod: {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    cashGainCents: number | null;
    savingsCents: number | null;
    savingsRatio: DecimalString | null;
    rawSavingsRatio: DecimalString | null;
  } | null;
  avgWindow: { from: IsoDate; periods: number } | null;
  avgCashGainCents: number | null;
  avgCashGainAdjustedCents: number | null;
  avgAddedInvestmentsCents: number | null;
  avgSavingsCents: number | null;
  avgSavingsRawCents: number | null;
  predictedCashPerYearCents: number | null;
  yearCashGainCents: number;
  yearSavingsCents: number;
  yearAddedInvestmentsCents: number;
  yearIncomeCents: number;
  yearPeriods: number;
  yearSavingsRatio: DecimalString | null;
  yearSavingsRawRatio: DecimalString | null;
  last3SavingsRatio: DecimalString | null;
  trendPerMonth: DecimalString | null;
  trend: KpiTrend | null;
  monthsToYearEnd: number | null;
  eoyProjectedCashCents: number | null;
  eoyGapPerMonthCents: number | null;
  eoyOnTarget: boolean | null;
  cashTarget: {
    targetCents: number;
    progressRatio: DecimalString;
    monthsToTarget: number | null;
    arrival: IsoDate | null;
    status: 'reached' | 'on_track' | 'no_savings';
  } | null;
  spend6mCents: number | null;
  spend6mRawCents: number | null;
  spend6mPeriods: number;
}

export interface SavingsGoalDto {
  id: number;
  name: string;
  targetCents: number;
  targetDate: IsoDate | null;
  sortOrder: number;
  note: string | null;
  allocatedCents: number;
  remainingCents: number;
  progressRatio: DecimalString;
  reached: boolean;
  monthsToGo: number | null;
  eta: IsoDate | null;
  onTrack: boolean | null;
  requiredPerMonthCents: number | null;
}

/** = the engine's CashflowChartPoint (Cents → number). */
export interface CashChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  cashCents: number | null;
  cashGainCents: number | null;
  addedInvestmentsCents: number | null;
  adjustmentCents: number;
  savingsCents: number | null;
  savingsRawCents: number | null;
  incomeCents: number | null;
  savingsRatio: DecimalString | null;
  savingsRawRatio: DecimalString | null;
  trendRatio: DecimalString | null;
}

export interface CashChartsDto {
  unit: ChartDateUnit;
  count: number | null;
  points: CashChartPointDto[];
}

export interface CashPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  lastRun: IsoDate | null;
  /** Kind order (CASH_ACCOUNT_KINDS), offsets last, then sortOrder. */
  accounts: CashAccountDto[];
  /** Every account's history, asOf desc. */
  entries: CashBalanceEntryDto[];
  totals: CashTotalsDto;
  /** Newest first (the provisional period first). */
  periods: SavingsPeriodDto[];
  /**
   * Months with no closed period: no period at all, the first period, or the provisional month
   * (adjustments attach to closed periods only, §2.3).
   */
  orphanAdjustments: SavingsAdjustmentDto[];
  kpis: CashKpisDto;
  goals: {
    savedCents: number;
    monthlyProgressCents: number | null;
    investmentsValueCents: number;
    /** The §4.5 goals-cash constant ('available': D59). */
    cashBasis: 'total' | 'available';
    /** Σ over the four investment kinds' summaries. */
    unpricedCount: number;
    stalePriceCount: number;
    items: SavingsGoalDto[];
  };
  charts: CashChartsDto;
  /** The Cash page's keys (§3.3). */
  settings: SettingsSliceDto;
  /**
   * Stage 3: other assets / super / mortgage came from the import until Stage 4. Always false from
   * Stage 4 (the live engines feed the provisional period); Stage 5 may drop it.
   */
  staticUntilStage4: boolean;
}

export interface CashAccountMutationResponse {
  account: CashAccountDto;
}

export interface CashBalancesResponse {
  accounts: CashAccountDto[];
}

export interface PeriodNoteResponse {
  note: PeriodNoteDto | null;
}

export interface SavingsGoalMutationResponse {
  goal: SavingsGoalDto;
}

// ─── Side income ───

export interface IncomeStreamDto {
  id: number;
  name: string;
  sortOrder: number;
  archived: boolean;
  origin: Origin;
  sheetRef: string | null;
  depositCount: number;
  lifetimeCents: number;
}

export interface SideIncomeDepositDto {
  id: number;
  streamId: number;
  streamName: string;
  date: IsoDate;
  amountCents: number;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
  /** Null for a deposit outside every period (before the first, or after the as-of). */
  periodMonth: IsoMonth | null;
  provisional: boolean;
}

export interface SideIncomePeriodDto {
  periodMonth: IsoMonth;
  start: IsoDate;
  end: IsoDate;
  status: 'closed' | 'provisional';
  totalCents: number;
  byStream: { streamId: number; amountCents: number }[];
  note: PeriodNoteDto | null;
}

export interface SideIncomeKpisDto {
  financialYear: number;
  fyStart: IsoDate;
  fyEnd: IsoDate;
  avgPerPeriodThisFyCents: number | null;
  periodsThisFy: number;
  fyToDateCents: number;
  projectedYearCents: number | null;
  avg365Cents: number | null;
  periods365: number;
  lifetimeCents: number;
}

export interface SideIncomeChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  /** Keys = String(streamId). */
  byStream: Record<string, number | null>;
  totalCents: number | null;
}

export interface SideIncomePageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  lastRun: IsoDate | null;
  streams: IncomeStreamDto[];
  /** Newest first. */
  deposits: SideIncomeDepositDto[];
  /** Newest first. */
  periods: SideIncomePeriodDto[];
  outside: { beforeFirstCents: number; afterAsOfCents: number };
  kpis: SideIncomeKpisDto;
  charts: { unit: ChartDateUnit; count: number | null; points: SideIncomeChartPointDto[] };
  /** D53: what the Budget adds. */
  budget: { includeSideIncome: boolean; avg365Cents: number | null };
}

export interface DepositMutationResponse {
  deposit: SideIncomeDepositDto;
}

export interface IncomeStreamMutationResponse {
  stream: IncomeStreamDto;
}

// ─── Budget ───

export interface BudgetRowDto {
  id: number | null;
  kind: BudgetItemKind;
  name: string | null;
  storedMonthlyCents: number | null;
  monthlyCents: number;
  incomeShareRatio: DecimalString | null;
  weeklyCents: number;
  yearlyCents: number;
  category: string | null;
  accountId: number | null;
  accountName: string | null;
  accountLinked: boolean;
  savingsLine: boolean;
  derived: boolean;
  manual: boolean;
  flags: ReviewFlag[];
  sortOrder: number | null;
  origin: Origin | null;
  sheetRef: string | null;
}

export interface YearlyExpenseDto {
  id: number;
  name: string;
  annualCents: number;
  monthlyCents: number;
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
}

export interface BudgetTransferDto {
  accountId: number | null;
  accountName: string | null;
  linked: boolean;
  perPayCents: number;
  monthlyCents: number;
  rows: number;
}

export interface BudgetSummaryDto {
  payFrequency: PayFrequency | null;
  netPayCents: number | null;
  monthlyIncomeCents: number | null;
  annualIncomeCents: number | null;
  sideIncomeIncluded: boolean;
  sideIncomeAvgCents: number | null;
  yearlyFundCents: number;
  plannedSpendCents: number;
  leftoverCents: number | null;
  yearlySavingsCents: number | null;
  emergencyFundCents: number | null;
  emergencyFundBasisCents: number;
  belowEmergencyFund: boolean;
  cashShareRatio: DecimalString | null;
  investShareRatio: DecimalString | null;
  investmentRowCents: number | null;
  cashRowCents: number | null;
  investManual: boolean;
  /** BudgetResult.unallocatedCents. */
  unallocatedCents: number | null;
  plannedSavingsRatio: DecimalString | null;
  /** allocation.cash (read-only here). */
  cashTargetRatio: DecimalString | null;
  /** investing.allocationAggressiveness (read-only). */
  aggressiveness: AllocationAggressiveness | null;
  /** D40, as the investment pages show. */
  monthlyInvestCents: number | null;
  sideIncomeInvestCents: number;
}

export interface BudgetPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  summary: BudgetSummaryDto;
  /** Items and auto rows in display order. */
  rows: BudgetRowDto[];
  yearlyExpenses: YearlyExpenseDto[];
  transfers: BudgetTransferDto[];
  unassigned: { perPayCents: number; monthlyCents: number; rows: number };
  perPayTotalCents: number | null;
  byCategory: { category: string | null; monthlyCents: number }[];
  actual: {
    plannedCents: number;
    actualCents: number | null;
    actualRawCents: number | null;
    periods: number;
  };
  /** Every account (fixes the F8:F29 range). */
  accounts: { id: number; name: string; kind: CashAccountKind }[];
  /** The Budget page's keys (§3.3). */
  settings: SettingsSliceDto;
  /** BudgetInvestResult.missing. */
  missing: string[];
}

export interface BudgetItemMutationResponse {
  row: BudgetRowDto;
}

export interface YearlyExpenseMutationResponse {
  expense: YearlyExpenseDto;
}

// ─── Dividends ───

export interface DividendRowDto {
  id: number;
  instrumentId: number | null;
  symbol: string | null;
  ticker: string;
  holdingKind: InstrumentKind;
  paymentDate: IsoDate;
  exDate: IsoDate | null;
  reinvested: boolean | null;
  netAmountCents: number;
  priceAtEx: DecimalString | null;
  priceAtExManual: boolean;
  unitsAtEx: DecimalString | null;
  yieldRatio: DecimalString | null;
  financialYear: number;
  flags: ReviewFlag[];
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface DividendFyRowDto {
  financialYear: number;
  byKind: Record<InstrumentKind, number>;
  totalCents: number;
}

export interface DividendMonthRowDto {
  month: IsoMonth;
  byKind: Record<InstrumentKind, number>;
  totalCents: number;
}

export interface DividendHoldingFyDto {
  instrumentId: number;
  symbol: string;
  kind: InstrumentKind;
  netThisFyCents: number;
  payments: number;
  frequencyMonths: number | null;
  drp: boolean | null;
  yield365Ratio: DecimalString | null;
  monthsToExtraUnit: number | null;
  advice: DrpAdvice | null;
}

export interface DividendSuggestionDto {
  instrumentId: number;
  symbol: string;
  kind: InstrumentKind;
  exDate: IsoDate;
  amountPerUnit: DecimalString;
  currency: string;
  unitsAtEx: DecimalString;
  estimatedNetCents: number;
  priceAtEx: DecimalString | null;
  yieldRatio: DecimalString | null;
  expectedPaymentDate: IsoDate;
  status: DividendSuggestionStatus;
  /** = the holding's DRP. */
  reinvestedDefault: boolean | null;
}

export interface DividendEventsStatusDto {
  mode: MarketDataMode;
  running: boolean;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  eventCount: number;
  instrumentsCovered: number;
  /** The last run's error text (≤ 200 chars, no URLs). */
  lastError: string | null;
}

/** = the engine's DividendsResult['kpis'], declared here. */
export interface DividendsKpisDto {
  financialYear: number;
  thisFyCents: number;
  lastFyCents: number;
  allTimeCents: number;
  rolling12Cents: number;
  reinvestedThisFyCents: number;
  daysIntoFy: number;
  projectedFyCents: number | null;
}

export interface DividendsPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  /** Payment date desc, then id desc. */
  dividends: DividendRowDto[];
  kpis: DividendsKpisDto;
  byFinancialYear: DividendFyRowDto[];
  rolling12: DividendMonthRowDto[];
  holdingsThisFy: DividendHoldingFyDto[];
  unlinkedThisFyCents: number;
  /** Due, upcoming and dismissed. */
  suggestions: DividendSuggestionDto[];
  events: DividendEventsStatusDto;
  /** The dividend form's holding list. */
  holdings: {
    instrumentId: number;
    symbol: string;
    kind: InstrumentKind;
    drp: boolean | null;
    dividendFreqMonths: number | null;
  }[];
}

export interface DividendMutationResponse {
  dividend: DividendRowDto;
}

export interface DividendEventsRefreshSummary {
  jobRunId: number | null;
  requested: number;
  ok: number;
  failed: number;
  skipped: number;
  events: number;
  durationMs: number;
}

export interface DividendEventsRefreshResponse {
  summary: DividendEventsRefreshSummary;
  events: DividendEventsStatusDto;
}

// ─── Settings ───

export interface SettingsPatchResponse {
  settings: SettingsSliceDto;
  hasAppData: boolean;
}
