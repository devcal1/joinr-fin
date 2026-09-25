// Investments API (stage-2.md §4.3–4.4, frozen): request schemas, the instrument helpers shared by
// the server and the web form, and the response DTOs. Money is integer cents; units, prices and
// ratios are normalised decimal strings; dates are IsoDate.
import { z } from 'zod';
import { compareDecimals, normaliseDecimal, sumDecimals } from '../decimal';
import {
  INSTRUMENT_KINDS,
  TRADE_SIDES,
  type AssetClass,
  type CapitalGainTerm,
  type ChartDateUnit,
  type ConsiderReason,
  type DeferredTimingInput,
  type HoldingFlag,
  type HoldingStatus,
  type InstrumentKind,
  type MarketDataMode,
  type Origin,
  type PriceSource,
  type PriceStatus,
  type ReviewFlag,
  type TradeSide,
} from '../enums';
import {
  CentsSchema,
  isIsoDateString,
  PositiveDecimalSchema,
  type DecimalString,
  type IsoDate,
  type IsoMonth,
  type IsoTimestamp,
} from '../primitives';
import {
  DECIMAL_INPUT_MAX_SIG,
  orderValueIssue,
  TRADE_DECIMAL_MAX_DP,
  withinDecimalInputLimits,
  type FeeSpec,
} from '../trading';

export type { FeeSpec } from '../trading';

// ─── Params ─────────────────────────────────────────────────────────────────────────────────────

/** `:kind` of `/api/investments/:kind`. A failure is answered 404, not 400. */
export const investmentKindParamsSchema = z.object({ kind: z.enum(INSTRUMENT_KINDS) });

/** `:id` of the trade and instrument routes: a positive integer path segment (as the prices routes). */
export const idParamsSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d{0,15}$/, { error: 'must be a positive integer' })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: 'must be a positive integer' }),
});

// ─── Field schemas ──────────────────────────────────────────────────────────────────────────────

const LIMITS_MESSAGE = `must have at most ${TRADE_DECIMAL_MAX_DP} decimal places and ${DECIMAL_INPUT_MAX_SIG} significant digits`;

/** A positive units or price input: ≤ 18 dp, ≤ 15 significant digits, ≤ `max`. Output normalised. */
export const tradeDecimalSchema = (max: number) =>
  PositiveDecimalSchema(TRADE_DECIMAL_MAX_DP, max).refine(withinDecimalInputLimits, {
    error: LIMITS_MESSAGE,
  });

const PLAIN_DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A ratio input (`"0.25"`): 0 ≤ r ≤ `max`, no sign or exponent, ≤ 18 dp and ≤ 15 significant
 * digits. Output normalised (`"0.250"` → `"0.25"`).
 */
export const ratioInputSchema = (max = 1) =>
  z
    .string()
    .trim()
    .regex(PLAIN_DECIMAL_RE, { error: 'must be a number such as 0.25', abort: true })
    .refine(withinDecimalInputLimits, { error: LIMITS_MESSAGE, abort: true })
    .transform((v) => normaliseDecimal(v))
    .refine((v) => compareDecimals(v, normaliseDecimal(String(max))) <= 0, {
      error: `must be at most ${String(max)}`,
    });

/** Trimmed text; `''` → null (so a blank field never fails or flips `origin`). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `must be at most ${max} characters` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** A trade fee or a holding's default fee. A `rate` is crypto only (checked per kind). */
export const feeSpecInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('flat'), cents: CentsSchema.min(0).max(100_000_000) }),
  z.strictObject({ kind: z.literal('rate'), rate: ratioInputSchema() }),
]);

/** The earliest trade date accepted. */
export const MIN_TRADE_DATE: IsoDate = '1900-01-01';

function localIsoDate(d: Date): IsoDate {
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}`;
}

/** The local calendar date after `now` (the latest trade date accepted). */
function localTomorrow(now: Date): IsoDate {
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

// ─── Trades ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/trades` and `PUT /api/trades/:id` body, with an injectable clock: the trade date is
 * ≥ 1900-01-01 and ≤ tomorrow (the local calendar date at parse time).
 */
export function makeTradeInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      instrumentId: z.number().int().positive(),
      side: z.enum(TRADE_SIDES),
      tradeDate: z
        .string()
        .refine(isIsoDateString, { error: 'must be a date written YYYY-MM-DD', abort: true })
        .refine((d) => d >= MIN_TRADE_DATE, {
          error: 'must be on or after 01/01/1900',
          abort: true,
        })
        .refine((d) => d <= localTomorrow(now()), { error: 'must not be after tomorrow' }),
      quantity: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('units'), units: tradeDecimalSchema(1e12) }),
        // D38: units = amount ÷ price, rounded down per kind (unitsFromAmount); the fee is on top.
        z.strictObject({
          mode: z.literal('amount'),
          amountCents: z.number().int().positive().max(1e13),
        }),
      ]),
      /** AUD per unit. */
      price: tradeDecimalSchema(1e9),
      fee: feeSpecInputSchema,
      note: optionalText(200).optional(),
    })
    .superRefine((t, ctx) => {
      // The joint bound (Scaffold note 2026-09-25 — Fixer): units and price are bounded
      // separately, so their product (and a rate fee on it) is capped at ORDER_VALUE_CENTS_MAX,
      // giving a field-path 400 instead of an overflow later. Amount mode: amountCents bounds it.
      if (t.quantity.mode !== 'units') return;
      const issue = orderValueIssue({
        units: t.quantity.units,
        price: t.price,
        feeRate: t.fee.kind === 'rate' ? t.fee.rate : null,
      });
      if (issue === 'order') {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity', 'units'],
          message: 'the order value is too large',
        });
      } else if (issue === 'fee') {
        ctx.addIssue({ code: 'custom', path: ['fee', 'rate'], message: 'the fee is too large' });
      }
    });
}

export const tradeInputSchema = makeTradeInputSchema();
/** The parsed trade body. */
export type TradeInput = z.output<typeof tradeInputSchema>;
/** The trade body as sent (before parsing). */
export type TradeInputBody = z.input<typeof tradeInputSchema>;

// ─── Instruments ────────────────────────────────────────────────────────────────────────────────

const regionRatio = ratioInputSchema().nullable();

/** Regional look-through (ETF and managed fund only); the four shares add up to at most 100 %. */
const regionsInputSchema = z
  .strictObject({ us: regionRatio, asia: regionRatio, aus: regionRatio, other: regionRatio })
  .refine(
    (r) =>
      compareDecimals(
        sumDecimals([r.us, r.asia, r.aus, r.other].filter((v): v is string => v !== null)),
        '1.000000001',
      ) <= 0,
    { error: 'must add up to at most 100%' },
  );

/** The editable instrument fields: the kind-agnostic base (never used alone on a route). */
export const instrumentUpdateSchema = z.strictObject({
  name: optionalText(120),
  quoteCurrency: z
    .string()
    .regex(/^(?:[A-Z]{3}|GBX|GBp)$/, { error: 'must be a currency code such as AUD' })
    .default('AUD'),
  watched: z.boolean(),
  targetRatio: ratioInputSchema().nullable(),
  sector: optionalText(60),
  location: optionalText(60),
  mgmtFeeRatio: ratioInputSchema(0.1).nullable(),
  regions: regionsInputSchema.nullable(),
  dividendFreqMonths: z.number().int().min(1).max(12).nullable(),
  drp: z.boolean().nullable(),
  /** The holding's own default fee (D38); null = use the global default. */
  defaultFee: feeSpecInputSchema.nullable(),
  note: optionalText(200),
});

export type InstrumentEditable = z.output<typeof instrumentUpdateSchema>;
/** The editable fields as sent (before parsing). */
export type InstrumentEditableBody = z.input<typeof instrumentUpdateSchema>;

const KIND_NOUN: Readonly<Record<InstrumentKind, string>> = {
  stock: 'a stock',
  etf: 'an ETF',
  managed_fund: 'a managed fund',
  crypto: 'crypto',
};

/** Fields that must be null for each kind (regions with four nulls count as null). */
const NULL_FIELDS: Readonly<
  Record<InstrumentKind, readonly ('sector' | 'location' | 'mgmtFeeRatio' | 'regions')[]>
> = {
  stock: ['location', 'mgmtFeeRatio', 'regions'],
  etf: [],
  managed_fund: [],
  crypto: ['sector', 'location', 'mgmtFeeRatio', 'regions'],
};

function regionsSet(r: InstrumentEditable['regions']): boolean {
  return r !== null && [r.us, r.asia, r.aus, r.other].some((v) => v !== null);
}

/** The per-kind rules as field-path issues (`{ path: 'regions', message }`); `[]` when valid. */
export function instrumentKindIssues(
  kind: InstrumentKind,
  input: InstrumentEditable,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  for (const field of NULL_FIELDS[kind]) {
    const set = field === 'regions' ? regionsSet(input.regions) : input[field] !== null;
    if (set) issues.push({ path: field, message: `must be empty for ${KIND_NOUN[kind]}` });
  }
  if (kind !== 'crypto' && input.defaultFee?.kind === 'rate') {
    issues.push({ path: 'defaultFee', message: 'a percentage fee is for crypto only' });
  }
  return issues;
}

const addIssues = (
  ctx: z.core.$RefinementCtx,
  issues: readonly { path: string; message: string }[],
): void => {
  for (const issue of issues) {
    ctx.addIssue({ code: 'custom', path: issue.path.split('.'), message: issue.message });
  }
};

/** `instrumentUpdateSchema` + the per-kind rules: PUT parses with the STORED kind; the web form too. */
export function makeInstrumentUpdateSchema(kind: InstrumentKind): z.ZodType<InstrumentEditable> {
  return instrumentUpdateSchema.superRefine((v, ctx) => {
    addIssues(ctx, instrumentKindIssues(kind, v));
  });
}

/** Symbol patterns per kind, checked on the normalised symbol (§4.3). */
export const INSTRUMENT_SYMBOL_PATTERNS: Readonly<Record<InstrumentKind, RegExp>> = {
  stock: /^[A-Z]{1,10}:[A-Z0-9][A-Z0-9.-]{0,11}$/,
  etf: /^[A-Z]{1,10}:[A-Z0-9][A-Z0-9.-]{0,11}$/,
  managed_fund: /^[A-Za-z0-9^.=\-_:]{1,32}$/,
  crypto: /^[A-Z0-9]{1,15}$/,
};

const SYMBOL_HINTS: Readonly<Record<InstrumentKind, string>> = {
  stock: 'must be EXCHANGE:CODE, e.g. ASX:ABC',
  etf: 'must be EXCHANGE:CODE, e.g. ASX:ABC',
  managed_fund: 'may contain only letters, digits and ^ . = - _ :',
  crypto: 'must be a coin symbol, e.g. BTC',
};

/** The symbol as stored: trimmed; upper-cased for stocks, ETFs and crypto; managed funds as typed. */
export function normaliseInstrumentSymbol(kind: InstrumentKind, symbol: string): string {
  const s = symbol.trim();
  return kind === 'managed_fund' ? s : s.toUpperCase();
}

/**
 * `POST /api/instruments` body: the editable fields plus `kind` and `symbol`, with the per-kind
 * rules and the symbol rule. The output's `symbol` is normalised (`normaliseInstrumentSymbol`).
 */
export const instrumentCreateSchema = instrumentUpdateSchema
  .extend({
    kind: z.enum(INSTRUMENT_KINDS),
    symbol: z.string().trim().min(1, { error: 'is required' }).max(32),
  })
  .superRefine((v, ctx) => {
    addIssues(ctx, instrumentKindIssues(v.kind, v));
    if (!INSTRUMENT_SYMBOL_PATTERNS[v.kind].test(normaliseInstrumentSymbol(v.kind, v.symbol))) {
      ctx.addIssue({ code: 'custom', path: ['symbol'], message: SYMBOL_HINTS[v.kind] });
    }
  })
  .transform((v) => ({ ...v, symbol: normaliseInstrumentSymbol(v.kind, v.symbol) }));

export type InstrumentCreate = z.output<typeof instrumentCreateSchema>;
export type InstrumentCreateBody = z.input<typeof instrumentCreateSchema>;

const KINDS_WITH_REGIONS: ReadonlySet<InstrumentKind> = new Set(['etf', 'managed_fund']);

/**
 * The one canonical mapping of the editable columns: builds a form body from a DTO and is the
 * comparison basis for the origin rule (§3.3). Regions are null for stocks and crypto, and when
 * all four shares are null.
 */
export function instrumentEditableFromDto(dto: InstrumentDto): InstrumentEditable {
  const r = dto.regions;
  const hasRegions =
    KINDS_WITH_REGIONS.has(dto.kind) && [r.us, r.asia, r.aus, r.other].some((v) => v !== null);
  return {
    name: dto.name,
    quoteCurrency: dto.quoteCurrency,
    watched: dto.watched,
    targetRatio: dto.targetRatio,
    sector: dto.sector,
    location: dto.location,
    mgmtFeeRatio: dto.mgmtFeeRatio,
    regions: hasRegions ? { us: r.us, asia: r.asia, aus: r.aus, other: r.other } : null,
    dividendFreqMonths: dto.dividendFreqMonths,
    drp: dto.drp,
    defaultFee: dto.defaultFee,
    note: dto.note,
  };
}

const normText = (v: string | null): string | null => {
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
};
const normRatio = (v: string | null): string | null => (v === null ? null : normaliseDecimal(v));

/**
 * Canonical form for comparisons: text trimmed and `''` → null, ratios normalised, all-null
 * regions → null, a blank currency → `AUD`, a rate fee normalised. Keys in a fixed order.
 */
export function normaliseInstrumentEditable(v: InstrumentEditable): InstrumentEditable {
  const r = v.regions;
  const regions =
    r === null
      ? null
      : {
          us: normRatio(r.us),
          asia: normRatio(r.asia),
          aus: normRatio(r.aus),
          other: normRatio(r.other),
        };
  const fee = v.defaultFee;
  return {
    name: normText(v.name),
    quoteCurrency: v.quoteCurrency.trim() === '' ? 'AUD' : v.quoteCurrency.trim(),
    watched: v.watched,
    targetRatio: normRatio(v.targetRatio),
    sector: normText(v.sector),
    location: normText(v.location),
    mgmtFeeRatio: normRatio(v.mgmtFeeRatio),
    regions:
      regions === null ||
      [regions.us, regions.asia, regions.aus, regions.other].every((x) => x === null)
        ? null
        : regions,
    dividendFreqMonths: v.dividendFreqMonths,
    drp: v.drp,
    defaultFee:
      fee === null
        ? null
        : fee.kind === 'rate'
          ? { kind: 'rate', rate: normaliseDecimal(fee.rate) }
          : { kind: 'flat', cents: fee.cents },
    note: normText(v.note),
  };
}

// ─── DTOs (§4.4, frozen field lists) ────────────────────────────────────────────────────────────

/** From the price service's `PriceItem`. */
export interface PriceInfoDto {
  price: DecimalString | null;
  status: PriceStatus;
  source: 'manual' | PriceSource | null;
  asOf: string | null;
  lastError: string | null;
}

export interface RegionsDto {
  us: DecimalString | null;
  asia: DecimalString | null;
  aus: DecimalString | null;
  other: DecimalString | null;
}

export interface InstrumentDto {
  id: number;
  kind: InstrumentKind;
  symbol: string;
  exchange: string | null;
  code: string;
  name: string | null;
  quoteCurrency: string;
  watched: boolean;
  sortOrder: number;
  targetRatio: DecimalString | null;
  sector: string | null;
  location: string | null;
  mgmtFeeRatio: DecimalString | null;
  regions: RegionsDto;
  dividendFreqMonths: number | null;
  drp: boolean | null;
  /** The holding's own default; null = use the global default. */
  defaultFee: FeeSpec | null;
  /** What the trade form pre-fills (§2.3). */
  effectiveDefaultFee: FeeSpec;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
  price: PriceInfoDto;
  /** Delete needs both counts to be 0. */
  tradeCount: number;
  dividendCount: number;
}

export interface HoldingRowDto {
  instrumentId: number;
  kind: InstrumentKind;
  symbol: string;
  name: string | null;
  note: string | null;
  watched: boolean;
  status: HoldingStatus;
  flags: HoldingFlag[];
  /** Open units. */
  units: DecimalString;
  price: PriceInfoDto;
  valueCents: number | null;
  costCents: number;
  unrealisedCents: number | null;
  dividendsCents: number;
  totalReturnCents: number | null;
  totalReturnRatio: DecimalString | null;
  realisedCents: number;
  xirr: DecimalString | null;
  averagePrice: DecimalString | null;
  currentRatio: DecimalString | null;
  targetRatio: DecimalString | null;
  differenceRatio: DecimalString | null;
  dividendYieldRatio: DecimalString | null;
  sector: string | null;
  /** ETF and managed fund only. */
  regions: RegionsDto | null;
  mgmtFeeRatio: DecimalString | null;
  estMgmtFeeCents: number | null;
  lastBuyDate: IsoDate | null;
  lastTradeDate: IsoDate | null;
  effectiveDefaultFee: FeeSpec;
}

/** = the engine's SummaryResult, field for field. */
export interface InvestmentSummaryDto {
  valueCents: number;
  costCents: number;
  unrealisedCents: number;
  dividendsHeldCents: number;
  totalReturnCents: number;
  totalReturnRatio: DecimalString | null;
  realisedCents: number;
  realisedThisFyCents: number;
  xirr: DecimalString | null;
  investmentRatePerMonthCents: number | null;
  dividendsThisFyCents: number;
  dividendsAllTimeCents: number;
  heldCount: number;
  watchingCount: number;
  exitedCount: number;
  unpricedCount: number;
  stalePriceCount: number;
  targetSumRatio: DecimalString;
  targetCount: number;
  estMgmtFeeCents: number | null;
  lastBuyDate: IsoDate | null;
}

export interface AllocationSliceDto {
  key: string;
  label: string;
  currentRatio: DecimalString;
  targetRatio: DecimalString;
}

export interface InvestmentAllocationDto {
  byHolding: AllocationSliceDto[];
  /** Null for crypto. */
  bySector: AllocationSliceDto[] | null;
  /** ETF and managed fund only. */
  byRegion: AllocationSliceDto[] | null;
}

export interface RealisedFyRowDto {
  /** The FY's starting year (FY2025–26 → 2025). */
  financialYear: number;
  shortTermCents: number;
  longTermCents: number;
  totalCents: number;
  disposals: number;
}

export type CountdownDto =
  | { state: 'wait'; days: number; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'invest'; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'cash_first' }
  | { state: 'unavailable' }
  /** D46 (appended): nothing to invest because the budget's automatic investment split is off. */
  | { state: 'split_off' };

export interface ConsiderNextRowDto {
  assetClass: AssetClass;
  valueCents: number;
  currentRatio: DecimalString;
  targetRatio: DecimalString | null;
  deltaRatio: DecimalString | null;
}

export interface InvestmentTimingDto {
  /** D40. */
  monthlyInvestCents: number | null;
  budget: {
    monthlyIncomeCents: number | null;
    plannedSpendCents: number;
    leftoverCents: number | null;
    emergencyFundCents: number | null;
    investShareRatio: DecimalString | null;
    investmentRowCents: number | null;
    sideIncomeInvestCents: number;
    useBudget: boolean | null;
    source: 'imported_budget';
  };
  plan: { months: number; parcelCents: number; optimalParcelCents: number } | null;
  lastPurchaseDate: IsoDate | null;
  countdown: CountdownDto;
  considerNext: {
    assetClass: AssetClass | null;
    reason: ConsiderReason;
    rows: ConsiderNextRowDto[];
  };
  hint: {
    assetClass: AssetClass | null;
    instrumentId: number | null;
    symbol: string | null;
    parcelCents: number | null;
  };
  /** TimingInput values (the engine's); the web shows `settingDef(key).label` for setting keys. */
  missing: string[];
  deferred: DeferredTimingInput[];
}

export interface InvestmentChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  valueCents: number | null;
  contributionsCents: number | null;
  gainCents: number | null;
  gainRatio: DecimalString | null;
  netPurchasesCents: number | null;
}

export interface InvestmentChartsDto {
  unit: ChartDateUnit;
  count: number | null;
  points: InvestmentChartPointDto[];
}

export interface InvestmentSettingsDto {
  defaultBrokerageCents: number | null;
  cryptoFeeRate: DecimalString | null;
  etfLimit: number | null;
}

export interface InvestmentPageResponse {
  kind: InstrumentKind;
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  summary: InvestmentSummaryDto;
  /** Held, then watching, then exited; each in sortOrder. */
  holdings: HoldingRowDto[];
  allocation: InvestmentAllocationDto;
  realisedByFy: RealisedFyRowDto[];
  timing: InvestmentTimingDto;
  charts: InvestmentChartsDto;
  settings: InvestmentSettingsDto;
}

export interface TradeRowDto {
  id: number;
  instrumentId: number;
  symbol: string;
  kind: InstrumentKind;
  tradeDate: IsoDate;
  side: TradeSide;
  /** Positive. */
  units: DecimalString;
  price: DecimalString;
  /** Positive (D33: the side says buy or sell; body text, never red). */
  orderValueCents: number;
  /** As stored: rate when fee_rate is set, else flat. */
  fee: FeeSpec;
  /** Authority fee, rounded. */
  feeCents: number;
  seq: number;
  origin: Origin;
  sheetRef: string | null;
  note: string | null;
  /** Stored review flags ∪ live 'oversell'. */
  flags: ReviewFlag[];
  correctionId: string | null;
  /** Buys (its lot). */
  remainingUnits: DecimalString | null;
  unrealisedCents: number | null;
  /** Sells. */
  realisedCents: number | null;
  realisedShortCents: number | null;
  realisedLongCents: number | null;
  oversoldUnits: DecimalString | null;
}

export interface InvestmentTradesResponse {
  kind: InstrumentKind;
  asOf: IsoDate;
  /** Newest first: date desc, seq desc, id desc. */
  trades: TradeRowDto[];
}

export interface LotRowDto {
  tradeId: number;
  tradeDate: IsoDate;
  units: DecimalString;
  remainingUnits: DecimalString;
  price: DecimalString;
  feeCents: number;
  remainingCostCents: number;
  unrealisedCents: number | null;
  unrealisedRatio: DecimalString | null;
  heldDays: number;
  termIfSoldToday: CapitalGainTerm;
  status: 'open' | 'closed';
}

export interface DisposalRowDto {
  sellTradeId: number;
  lotTradeId: number;
  sellDate: IsoDate;
  acquiredDate: IsoDate;
  units: DecimalString;
  proceedsCents: number;
  costCents: number;
  gainCents: number;
  term: CapitalGainTerm;
  financialYear: number;
}

export interface HoldingDividendDto {
  id: number;
  paymentDate: IsoDate;
  exDate: IsoDate | null;
  reinvested: boolean | null;
  netAmountCents: number;
  priceAtEx: DecimalString | null;
  /** From the engine's InvestmentsResult.dividends (§2.9). */
  unitsAtEx: DecimalString | null;
  yieldRatio: DecimalString | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface HoldingDetailResponse {
  asOf: IsoDate;
  instrument: InstrumentDto;
  holding: HoldingRowDto;
  lots: LotRowDto[];
  disposals: DisposalRowDto[];
  trades: TradeRowDto[];
  dividends: HoldingDividendDto[];
}

export interface TradeMutationResponse {
  trade: TradeRowDto;
}

export interface DeletedResponse {
  id: number;
}
