// Other Assets, Super and Property API (stage-4.md §4.3–4.4, frozen): the request schemas and the
// response DTOs. Money is integer cents; units, prices, FX rates, ounces and ratios are normalised
// decimal strings; dates are IsoDate. Every DTO is declared field by field here (`@joinr/schema`
// cannot import the engine's types; the server type-checks the mapping). `DeletedResponse`,
// `PeriodNoteDto`, `PeriodNoteResponse` and `SettingsSliceDto` are reused.
import { z } from 'zod';
import { isOtherAssetCurrency } from '../assets';
import { JoinrDecimal, normaliseDecimal, type DecimalValue } from '../decimal';
import {
  METALS,
  OTHER_ASSET_PRICE_SOURCES,
  PAYMENT_FREQUENCIES,
  SUPER_CONTRIBUTION_TYPES,
  type ChartDateUnit,
  type FxRateSource,
  type LoanEntryFlag,
  type LoanFlag,
  type MarketDataMode,
  type Metal,
  type OtherAssetFlag,
  type OtherAssetPriceSource,
  type Origin,
  type PaymentFrequency,
  type PriceStatus,
  type SavingsPeriodStatus,
  type SuperCapStatus,
  type SuperFlag,
  type UnitOfMeasure,
} from '../enums';
import type { DecimalString, IsoDate, IsoMonth, IsoTimestamp } from '../primitives';
import {
  DECIMAL_INPUT_MAX_SIG,
  ORDER_VALUE_CENTS_MAX,
  TRADE_DECIMAL_MAX_DP,
  withinDecimalInputLimits,
} from '../trading';
import { CASHFLOW_MONEY_MAX, type PeriodNoteDto, type SettingsSliceDto } from './cashflow';
// `optionalText` and `signedCents` (−ASSETS_MONEY_MAX … ASSETS_MONEY_MAX: net rent may be negative,
// §11 fix 9) are shared with dto/history.ts (stage-5.md §3.2).
import { optionalText, signedCents } from './fields';
import type { MarketQuoteStatus } from './prices';
import { makeEntryDateSchema, ratioInputSchema, tradeDecimalSchema } from './investments';

// ─── Field schemas ──────────────────────────────────────────────────────────────────────────────

/** The largest money amount an assets body accepts (cents; = CASHFLOW_MONEY_MAX, $100m). */
export const ASSETS_MONEY_MAX = CASHFLOW_MONEY_MAX;

/** Required trimmed text of at most `max` characters. */
const name = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: 'is required' })
    .max(max, { error: `must be at most ${max} characters` });

/** Integer cents, 0 … ASSETS_MONEY_MAX. */
const cents0 = z
  .number()
  .int({ error: 'must be whole cents' })
  .min(0, { error: 'must not be negative' })
  .max(ASSETS_MONEY_MAX, { error: 'is too large' });

const posInt = z.number().int().positive();

const PLAIN_DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const LIMITS_MESSAGE = `must have at most ${TRADE_DECIMAL_MAX_DP} decimal places and ${DECIMAL_INPUT_MAX_SIG} significant digits`;

/**
 * A decimal ≥ 0 and ≤ `max` (a unit cost or a hand price; 0 is allowed): no sign or exponent,
 * ≤ 18 dp and ≤ 15 significant digits. Output normalised (`"12.50"` → `"12.5"`).
 */
const nonNegativeDecimal = (max: number) =>
  z
    .string()
    .trim()
    .regex(PLAIN_DECIMAL_RE, { error: 'must be a number such as 12.5', abort: true })
    .refine(withinDecimalInputLimits, { error: LIMITS_MESSAGE, abort: true })
    .transform((v) => normaliseDecimal(v))
    .refine((v) => Number(v) <= max, { error: `must be at most ${String(max)}` });

/** A valuation-source link: trimmed, ≤ 500 chars, http:// or https:// only; `''` → null. */
const optionalUrl = z
  .string()
  .trim()
  .max(500, { error: 'must be at most 500 characters' })
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), {
    error: 'must start with http:// or https://',
  })
  .transform((v) => (v === '' ? null : v))
  .nullable();

/** An ISO 4217 code, or `GBX` (UK pence); upper-cased. */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isOtherAssetCurrency, { error: 'must be a 3-letter currency code or GBX' });

/** Adds an issue at `path` when an id appears more than once. */
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

// ─── Other assets (§4.3) ────────────────────────────────────────────────────────────────────────

/**
 * The most ounces a bullion item may hold in all (units × oz per unit; Fixer round 1): with the
 * spot price it keeps the item's value far inside safe-integer cents.
 */
export const OTHER_ASSET_OZ_MAX = 1e7;

/**
 * True when the product of `parts` is above `limit` (Fixer round 1: the joint bounds that keep an
 * item's cost and value inside the engine's safe-integer cents). False when any part is null,
 * missing or not a finite number (the field checks report those).
 */
export function productExceeds(
  parts: readonly (string | number | null | undefined)[],
  limit: number,
): boolean {
  let product = new JoinrDecimal(1);
  for (const part of parts) {
    if (part === null || part === undefined) return false;
    let d: DecimalValue;
    try {
      d = new JoinrDecimal(typeof part === 'string' ? part.trim() : part);
    } catch {
      return false;
    }
    if (!d.isFinite()) return false;
    product = product.times(d.abs());
  }
  return product.greaterThan(limit);
}

/**
 * True when `units × price` (× any further factor, such as a purchase FX rate) is worth more than
 * `ORDER_VALUE_CENTS_MAX` cents (the Stage 2 order-value bound; Fixer round 1).
 */
export function assetValueTooLarge(
  parts: readonly (string | number | null | undefined)[],
): boolean {
  return productExceeds([...parts, 100], ORDER_VALUE_CENTS_MAX);
}

function otherAssetShape(now: () => Date) {
  return {
    description: name(200),
    url: optionalUrl,
    note: optionalText(200),
    purchaseDate: makeEntryDateSchema(now).nullable(),
    units: tradeDecimalSchema(1e9),
    currency,
    unitCost: nonNegativeDecimal(1e9).nullable(),
    /** AUD per 1 unit of the currency at purchase; typed → source 'user'. */
    purchaseFxRate: tradeDecimalSchema(1e6).nullable(),
    priceSource: z.enum(OTHER_ASSET_PRICE_SOURCES),
    metal: z.enum(METALS).nullable(),
    ozPerUnit: tradeDecimalSchema(1e6).nullable(),
  };
}

interface OtherAssetRefineInput {
  units: string;
  unitCost: string | null;
  currency: string;
  purchaseFxRate: string | null;
  priceSource: OtherAssetPriceSource;
  metal: Metal | null;
  ozPerUnit: string | null;
}

/**
 * Bullion → metal and oz per unit required, priced in AUD; manual → no metal or oz per unit; an
 * AUD asset has no FX rate at purchase. Joint bounds (Fixer round 1): units × unit cost × the FX
 * rate at purchase within `ORDER_VALUE_CENTS_MAX` cents, and a bullion item's units × oz per unit
 * within `OTHER_ASSET_OZ_MAX`, so the engine's cents never leave the safe-integer range.
 */
function checkOtherAsset(v: OtherAssetRefineInput, ctx: z.core.$RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.priceSource === 'bullion') {
    if (v.metal === null) issue('metal', 'is required for bullion');
    if (v.ozPerUnit === null) issue('ozPerUnit', 'is required for bullion');
    if (v.currency !== 'AUD') issue('currency', 'bullion is priced in AUD');
  } else {
    if (v.metal !== null) issue('metal', 'only for bullion');
    if (v.ozPerUnit !== null) issue('ozPerUnit', 'only for bullion');
  }
  if (v.currency === 'AUD' && v.purchaseFxRate !== null) {
    issue('purchaseFxRate', 'only for a foreign currency');
  }
  if (
    assetValueTooLarge([
      v.units,
      v.unitCost,
      v.currency === 'AUD' ? '1' : (v.purchaseFxRate ?? '1'),
    ])
  ) {
    issue('unitCost', 'units × unit cost is too large');
  }
  if (v.priceSource === 'bullion' && productExceeds([v.units, v.ozPerUnit], OTHER_ASSET_OZ_MAX)) {
    issue('ozPerUnit', 'units × oz per unit is too large');
  }
}

/** `PUT /api/other-assets/:id` body. */
export function makeOtherAssetUpdateSchema(now: () => Date = () => new Date()) {
  return z.strictObject(otherAssetShape(now)).superRefine(checkOtherAsset);
}
export const otherAssetUpdateSchema = makeOtherAssetUpdateSchema();
export type OtherAssetUpdate = z.output<typeof otherAssetUpdateSchema>;
export type OtherAssetUpdateBody = z.input<typeof otherAssetUpdateSchema>;

/** `POST /api/other-assets` body: the update fields plus a manual asset's first price (or null). */
export function makeOtherAssetCreateSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      ...otherAssetShape(now),
      price: z
        .strictObject({ unitPrice: nonNegativeDecimal(1e9), asOf: makeEntryDateSchema(now) })
        .nullable(),
    })
    .superRefine((v, ctx) => {
      checkOtherAsset(v, ctx);
      if (v.priceSource === 'bullion' && v.price !== null) {
        ctx.addIssue({ code: 'custom', path: ['price'], message: 'bullion is priced from spot' });
      }
      if (v.price !== null && assetValueTooLarge([v.units, v.price.unitPrice])) {
        ctx.addIssue({
          code: 'custom',
          path: ['price', 'unitPrice'],
          message: 'units × price is too large',
        });
      }
    });
}
export const otherAssetCreateSchema = makeOtherAssetCreateSchema();
export type OtherAssetCreate = z.output<typeof otherAssetCreateSchema>;
export type OtherAssetCreateBody = z.input<typeof otherAssetCreateSchema>;

/** `PUT /api/other-assets/prices` body (D72): one shared as-of date and the priced assets. */
export function makeOtherAssetPricesInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      asOf: makeEntryDateSchema(now),
      entries: z
        .array(
          z.strictObject({
            assetId: posInt,
            unitPrice: nonNegativeDecimal(1e9),
            note: optionalText(200).optional(),
          }),
        )
        .min(1, { error: 'must list at least one asset' })
        .max(500, { error: 'must list at most 500 assets' }),
    })
    .superRefine((v, ctx) => {
      uniqueIds(
        v.entries.map((e) => e.assetId),
        ctx,
        ['entries'],
        'an asset',
      );
    });
}
export const otherAssetPricesInputSchema = makeOtherAssetPricesInputSchema();
export type OtherAssetPricesInput = z.output<typeof otherAssetPricesInputSchema>;

/** `POST /api/other-assets/:id/sales` and `PUT /api/other-assets/sales/:id` body (D72). */
export function makeOtherAssetSaleInputSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    saleDate: makeEntryDateSchema(now),
    units: tradeDecimalSchema(1e9),
    proceedsCents: cents0,
    note: optionalText(200),
  });
}
export const otherAssetSaleInputSchema = makeOtherAssetSaleInputSchema();
export type OtherAssetSaleInput = z.output<typeof otherAssetSaleInputSchema>;

// ─── Super ──────────────────────────────────────────────────────────────────────────────────────

/** `PUT /api/super/funds/:id` body. A `receivesSg`-only change keeps `origin` (§3.4). */
export const superFundUpdateSchema = z.strictObject({
  name: name(80),
  receivesSg: z.boolean(),
  archived: z.boolean(),
});
export type SuperFundUpdate = z.output<typeof superFundUpdateSchema>;

/**
 * `POST /api/super/funds` body. `openingIsRollover` false → the opening balance is a transfer in
 * (money you already had, not a gain); true → moved from a fund on the page.
 */
export function makeSuperFundCreateSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    name: name(80),
    receivesSg: z.boolean(),
    openingBalanceCents: cents0,
    asOf: makeEntryDateSchema(now),
    openingIsRollover: z.boolean(),
  });
}
export const superFundCreateSchema = makeSuperFundCreateSchema();
export type SuperFundCreate = z.output<typeof superFundCreateSchema>;

/**
 * `PUT /api/super/balances` body (D69): one shared as-of date and the funds' balances (also edits
 * one entry: its fund and date again). `transferInCents` omitted keeps a stored figure; null clears
 * it.
 */
export function makeSuperBalancesInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      asOf: makeEntryDateSchema(now),
      entries: z
        .array(
          z.strictObject({
            fundId: posInt,
            balanceCents: cents0,
            transferInCents: cents0.nullable().optional(),
            note: optionalText(200).optional(),
          }),
        )
        .min(1, { error: 'must list at least one fund' })
        .max(50, { error: 'must list at most 50 funds' }),
    })
    .superRefine((v, ctx) => {
      uniqueIds(
        v.entries.map((e) => e.fundId),
        ctx,
        ['entries'],
        'a fund',
      );
    });
}
export const superBalancesInputSchema = makeSuperBalancesInputSchema();
export type SuperBalancesInput = z.output<typeof superBalancesInputSchema>;

/**
 * `POST /api/super/contributions` and `PUT …/:id` body (D71): typed kinds only; salary sacrifice
 * is the pre-tax amount, after-tax the amount paid from take-home pay.
 */
export function makeSuperContributionInputSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    fundId: posInt.nullable(),
    date: makeEntryDateSchema(now),
    kind: z.enum(SUPER_CONTRIBUTION_TYPES),
    amountCents: z
      .number()
      .int({ error: 'must be whole cents' })
      .positive({ error: 'must be greater than zero' })
      .max(ASSETS_MONEY_MAX, { error: 'is too large' }),
    note: optionalText(200),
  });
}
export const superContributionInputSchema = makeSuperContributionInputSchema();
export type SuperContributionInput = z.output<typeof superContributionInputSchema>;

/** `PUT /api/super/sg/:periodMonth` body: a statement's SG for the month earned (before tax). */
export const sgOverrideInputSchema = z.strictObject({
  grossCents: cents0,
  note: optionalText(200),
});
export type SgOverrideInput = z.output<typeof sgOverrideInputSchema>;

// ─── Property ───────────────────────────────────────────────────────────────────────────────────

function propertyShape(now: () => Date) {
  return {
    name: name(80),
    purchaseDate: makeEntryDateSchema(now).nullable(),
    isPrimaryResidence: z.boolean(),
    purchaseValueCents: cents0,
    /** May be negative (§11 fix 9). */
    netRentToDateCents: signedCents,
    note: optionalText(200),
  };
}

/** `PUT /api/property/properties/:id` body. */
export function makePropertyUpdateSchema(now: () => Date = () => new Date()) {
  return z.strictObject(propertyShape(now));
}
export const propertyUpdateSchema = makePropertyUpdateSchema();
export type PropertyUpdate = z.output<typeof propertyUpdateSchema>;

/** `POST /api/property/properties` body: plus the opening valuation. */
export function makePropertyCreateSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    ...propertyShape(now),
    valueCents: cents0,
    asOf: makeEntryDateSchema(now),
  });
}
export const propertyCreateSchema = makePropertyCreateSchema();
export type PropertyCreate = z.output<typeof propertyCreateSchema>;

/** `PUT /api/property/valuations` body: one shared as-of date and the properties' values. */
export function makeValuationsInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      asOf: makeEntryDateSchema(now),
      entries: z
        .array(
          z.strictObject({
            propertyId: posInt,
            valueCents: cents0,
            note: optionalText(200).optional(),
          }),
        )
        .min(1, { error: 'must list at least one property' })
        .max(50, { error: 'must list at most 50 properties' }),
    })
    .superRefine((v, ctx) => {
      uniqueIds(
        v.entries.map((e) => e.propertyId),
        ctx,
        ['entries'],
        'a property',
      );
    });
}
export const valuationsInputSchema = makeValuationsInputSchema();
export type ValuationsInput = z.output<typeof valuationsInputSchema>;

function loanShape(now: () => Date) {
  return {
    propertyId: posInt,
    name: name(80),
    lender: optionalText(80),
    startDate: makeEntryDateSchema(now).nullable(),
    startBalanceCents: cents0.nullable(),
    annualRate: ratioInputSchema(1).nullable(),
    compoundingPerYear: z
      .number()
      .int({ error: 'must be a whole number' })
      .min(1, { error: 'must be at least 1' })
      .max(365, { error: 'must be at most 365' })
      .nullable(),
    paymentCents: cents0.nullable(),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    note: optionalText(200),
  };
}

/** `PUT /api/property/loans/:id` body (a changed start or repayment re-derives the log, §2.6). */
export function makeLoanUpdateSchema(now: () => Date = () => new Date()) {
  return z.strictObject(loanShape(now));
}
export const loanUpdateSchema = makeLoanUpdateSchema();
export type LoanUpdate = z.output<typeof loanUpdateSchema>;

/** `POST /api/property/loans` body: plus the current balance and its date (one stored entry). */
export function makeLoanCreateSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    ...loanShape(now),
    balanceCents: cents0,
    asOf: makeEntryDateSchema(now),
  });
}
export const loanCreateSchema = makeLoanCreateSchema();
export type LoanCreate = z.output<typeof loanCreateSchema>;

/**
 * `PUT /api/property/loan-balances` body (D66): one shared as-of date and the loans' balances.
 * `repaymentsCents` omitted keeps a stored entry's figure; null clears it (back to the default).
 */
export function makeLoanBalancesInputSchema(now: () => Date = () => new Date()) {
  return z
    .strictObject({
      asOf: makeEntryDateSchema(now),
      entries: z
        .array(
          z.strictObject({
            loanId: posInt,
            balanceCents: cents0,
            repaymentsCents: cents0.nullable().optional(),
            note: optionalText(200).optional(),
          }),
        )
        .min(1, { error: 'must list at least one loan' })
        .max(50, { error: 'must list at most 50 loans' }),
    })
    .superRefine((v, ctx) => {
      uniqueIds(
        v.entries.map((e) => e.loanId),
        ctx,
        ['entries'],
        'a loan',
      );
    });
}
export const loanBalancesInputSchema = makeLoanBalancesInputSchema();
export type LoanBalancesInput = z.output<typeof loanBalancesInputSchema>;

/** `PUT /api/property/loan-balance-entries/:id` body: the entry's date is fixed. */
export const loanBalanceEntryUpdateSchema = z.strictObject({
  balanceCents: cents0,
  repaymentsCents: cents0.nullable(),
  note: optionalText(200),
});
export type LoanBalanceEntryUpdate = z.output<typeof loanBalanceEntryUpdateSchema>;

/** `PUT /api/property/loans/:id/offsets` body (D67): the loan's offset accounts, as a set. */
export const loanOffsetsInputSchema = z
  .strictObject({
    accountIds: z.array(posInt).max(20, { error: 'must list at most 20 accounts' }),
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.accountIds, ctx, ['accountIds'], 'an account');
  });
export type LoanOffsetsInput = z.output<typeof loanOffsetsInputSchema>;

// ─── DTOs (§4.4, frozen field lists) ────────────────────────────────────────────────────────────

// ─── Other assets ───

export interface OtherAssetDto {
  id: number;
  description: string;
  url: string | null;
  note: string | null;
  purchaseDate: IsoDate | null;
  effectiveDate: IsoDate | null;
  dateAssumed: boolean;
  heldDays: number | null;
  units: DecimalString;
  legacySoldUnits: DecimalString;
  soldUnits: DecimalString;
  remainingUnits: DecimalString;
  currency: string;
  unitCost: DecimalString | null;
  purchaseFxRate: DecimalString | null;
  purchaseFxSource: FxRateSource | null;
  purchaseFxDate: IsoDate | null;
  priceSource: OtherAssetPriceSource;
  metal: Metal | null;
  ozPerUnit: DecimalString | null;
  unitOfMeasure: UnitOfMeasure;
  /** Manual: the latest entry (asset currency); bullion: null. */
  unitPrice: DecimalString | null;
  priceAsOf: IsoDate | null;
  unitPriceAud: DecimalString | null;
  priceStatus: PriceStatus;
  costCents: number | null;
  valueCents: number | null;
  gainCents: number | null;
  gainRatio: DecimalString | null;
  cagrRatio: DecimalString | null;
  realisedCents: number;
  saleCount: number;
  priceEntryCount: number;
  flags: OtherAssetFlag[];
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
}

export interface OtherAssetPriceEntryDto {
  id: number;
  assetId: number;
  asOf: IsoDate;
  unitPrice: DecimalString;
  currency: string;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface OtherAssetSaleDto {
  id: number;
  assetId: number;
  saleDate: IsoDate;
  units: DecimalString;
  proceedsCents: number;
  costCents: number | null;
  realisedCents: number | null;
  note: string | null;
  origin: Origin;
}

export interface OtherAssetsTotalsDto {
  valueCents: number;
  costCents: number;
  gainCents: number;
  gainRatio: DecimalString | null;
  realisedCents: number;
  proceedsCents: number;
  unpricedCount: number;
  staleCount: number;
  assumedDateCount: number;
  fxMissingCount: number;
  liveFxMissingCount: number;
}

export interface SpotDto {
  metal: Metal;
  audPerOz: DecimalString | null;
  asOf: string | null;
  status: MarketQuoteStatus;
}

export interface FxRateDto {
  currency: string;
  audPerUnit: DecimalString | null;
  asOf: string | null;
  status: MarketQuoteStatus;
}

export interface OtherAssetsChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  costCents: number | null;
  valueCents: number | null;
  gainCents: number | null;
  gainRatio: DecimalString | null;
}

export interface OtherAssetsPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  /** Sort order. */
  assets: OtherAssetDto[];
  /** asOf desc, then id desc. */
  priceEntries: OtherAssetPriceEntryDto[];
  /** Sale date desc, then id desc. */
  sales: OtherAssetSaleDto[];
  totals: OtherAssetsTotalsDto;
  /** D73. */
  assumedDate: IsoDate | null;
  /** Silver, then gold (always both). */
  spot: SpotDto[];
  /** The foreign currencies the assets use. */
  fx: FxRateDto[];
  /** The metals in use. */
  spotHistory: { metal: Metal; points: { date: IsoDate; audPerOz: DecimalString }[] }[];
  market: { mode: MarketDataMode; lastRefreshAt: string | null };
  charts: { unit: ChartDateUnit; count: number | null; points: OtherAssetsChartPointDto[] };
  /** otherAssets.stalePriceDays. */
  settings: SettingsSliceDto;
}

export interface OtherAssetMutationResponse {
  asset: OtherAssetDto;
}

export interface OtherAssetPricesResponse {
  assets: OtherAssetDto[];
}

// ─── Super ───

export interface SuperFundDto {
  id: number;
  name: string;
  receivesSg: boolean;
  archived: boolean;
  balanceCents: number | null;
  balanceAsOf: IsoDate | null;
  entryCount: number;
  contributionCount: number;
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
}

export interface SuperBalanceEntryDto {
  id: number;
  fundId: number;
  asOf: IsoDate;
  balanceCents: number;
  transferInCents: number | null;
  flowsCents: number | null;
  gainCents: number | null;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface SuperContributionDto {
  id: number;
  fundId: number | null;
  fundName: string | null;
  date: IsoDate;
  kind: 'voluntary_contribution' | 'salary_sacrifice' | 'after_tax';
  amountCents: number;
  estimate: boolean;
  preTaxCents: number | null;
  fundReceivesCents: number;
  netPayCostCents: number | null;
  concessional: boolean;
  /** The savings period it falls in. */
  periodMonth: IsoMonth | null;
  provisional: boolean;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface SuperSgMonthDto {
  month: IsoMonth;
  source: 'statement' | 'estimate' | 'none';
  grossCents: number;
  fundReceivesCents: number;
  fundId: number | null;
  capFinancialYear: number;
  /** The statement override's note. */
  note: string | null;
}

export interface SuperFlowsDto {
  sgGrossCents: number;
  sgFundCents: number;
  memberFundCents: number;
  memberNetPayCents: number;
  concessionalCents: number;
  nonConcessionalCents: number;
  transferInCents: number;
}

export interface SuperPeriodDto {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  after: IsoDate | null;
  through: IsoDate;
  status: SavingsPeriodStatus;
  valueCents: number | null;
  notUpdated: boolean;
  flows: SuperFlowsDto | null;
  gainFrom: IsoDate | null;
  changeCents: number | null;
  gainFlows: SuperFlowsDto | null;
  gainCents: number | null;
  gainRatio: DecimalString | null;
  returnRatio: DecimalString | null;
  /** The super_option note of that month. */
  note: PeriodNoteDto | null;
}

export interface SuperCapYearDto {
  financialYear: number;
  start: IsoDate;
  end: IsoDate;
  complete: boolean;
  capCents: number;
  capSource: 'statutory' | 'setting';
  sgGrossCents: number;
  sgFundCents: number;
  sgSource: 'estimate' | 'statement' | 'mixed' | 'none';
  salarySacrificeCents: number;
  importedEstimateCents: number;
  totalCents: number;
  projectedCents: number;
  ratio: DecimalString;
  projectedRatio: DecimalString;
  status: SuperCapStatus;
  nonConcessionalCents: number;
  memberCents: number;
  memberFundCents: number;
  memberNetPayCents: number;
  estimateCount: number;
}

export interface SuperChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  valueCents: number | null;
  gainCents: number | null;
  returnRatio: DecimalString | null;
  memberNetPayCents: number | null;
  memberFundCents: number | null;
  sgFundCents: number | null;
}

export interface SuperPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  lastRun: IsoDate | null;
  totalCents: number;
  /** Sort order, archived last. */
  funds: SuperFundDto[];
  /** asOf desc. */
  balanceEntries: SuperBalanceEntryDto[];
  /** Date desc, then id desc. */
  contributions: SuperContributionDto[];
  /** Month desc. */
  sgMonths: SuperSgMonthDto[];
  /** Newest first (the provisional first). */
  periods: SuperPeriodDto[];
  /** Every super_option note, month desc. */
  notes: PeriodNoteDto[];
  annualised: {
    cumulativeRatio: DecimalString | null;
    returnRatio: DecimalString | null;
    from: IsoDate | null;
    through: IsoDate | null;
    days: number | null;
  };
  /** This FY, then the one before. */
  capYears: SuperCapYearDto[];
  /** §3.3 (shown with its FY). */
  capOverride: { cents: number; financialYear: number } | null;
  statutory: {
    /** The SG rate in use for the as-of month (setting or statutory). */
    sgRatio: DecimalString;
    contributionsTaxRatio: DecimalString;
    checkedOn: IsoDate;
    paydaySuperStart: IsoDate;
    /** The §3.2 tables. */
    caps: { financialYear: number; capCents: number }[];
    sgRates: { financialYear: number; ratio: DecimalString }[];
  };
  flags: SuperFlag[];
  charts: { unit: ChartDateUnit; count: number | null; points: SuperChartPointDto[] };
  /** The Super page's keys (§3.3). */
  settings: SettingsSliceDto;
}

export interface SuperFundMutationResponse {
  fund: SuperFundDto;
}

export interface SuperBalancesResponse {
  funds: SuperFundDto[];
}

export interface SuperContributionMutationResponse {
  contribution: SuperContributionDto;
}

export interface SgOverrideResponse {
  month: SuperSgMonthDto;
}

// ─── Property ───

export interface PropertyDto {
  id: number;
  name: string;
  purchaseDate: IsoDate | null;
  isPrimaryResidence: boolean;
  purchaseValueCents: number;
  valueCents: number;
  valuationDate: IsoDate;
  netRentToDateCents: number;
  gainCents: number;
  gainRatio: DecimalString | null;
  cagrRatio: DecimalString | null;
  heldDays: number | null;
  debtCents: number;
  equityCents: number;
  lvrRatio: DecimalString | null;
  loanIds: number[];
  valuationCount: number;
  note: string | null;
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
}

export interface PropertyValuationDto {
  id: number;
  propertyId: number;
  asOf: IsoDate;
  valueCents: number;
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface AmortisationDto {
  periodicRatio: DecimalString;
  firstPaymentDate: IsoDate;
  firstPeriodInterestCents: number;
  payments: number | null;
  payoffDate: IsoDate | null;
  totalInterestCents: number | null;
  points: { date: IsoDate; balanceCents: number; interestCents: number }[];
  flag: 'payment_below_interest' | 'never_repaid' | null;
}

export interface LoanBalanceEntryDto {
  /** Null: the start point (no Edit/Delete). */
  id: number | null;
  start: boolean;
  loanId: number;
  asOf: IsoDate;
  balanceCents: number;
  paymentsCounted: number | null;
  repaymentsCents: number | null;
  repaymentsTyped: boolean;
  principalCents: number | null;
  interestFeesCents: number | null;
  cumulativePrincipalCents: number | null;
  cumulativeInterestFeesCents: number;
  flags: LoanEntryFlag[];
  note: string | null;
  origin: Origin;
  sheetRef: string | null;
}

export interface LoanDto {
  id: number;
  propertyId: number | null;
  propertyName: string | null;
  name: string;
  lender: string | null;
  startDate: IsoDate | null;
  startBalanceCents: number | null;
  annualRate: DecimalString | null;
  compoundingPerYear: number | null;
  paymentCents: number | null;
  paymentFrequency: PaymentFrequency;
  /** The payment grid's anchor (§2.3; the web's estimate placeholder). */
  paymentAnchorDate: IsoDate;
  balanceCents: number;
  balanceAsOf: IsoDate;
  offsetCents: number;
  netBalanceCents: number;
  excessOffsetCents: number;
  offsetAccountIds: number[];
  repaymentsCents: number;
  principalPaidCents: number;
  interestFeesCents: number;
  nextPeriodInterestCents: number | null;
  schedule: AmortisationDto | null;
  scheduleWithoutOffset: AmortisationDto | null;
  interestSavedCents: number | null;
  monthsSaved: number | null;
  /** The workbook's figure (display). */
  imported: { paymentsPaidCents: number | null; paymentsPaidDerived: boolean } | null;
  flags: LoanFlag[];
  entryCount: number;
  note: string | null;
  sortOrder: number;
  origin: Origin;
  sheetRef: string | null;
}

export interface OffsetAccountDto {
  id: number;
  name: string;
  balanceCents: number;
  balanceAsOf: IsoDate | null;
  linkedLoanId: number | null;
}

export interface PropertyTotalsDto {
  purchaseCents: number;
  valueCents: number;
  gainCents: number;
  gainRatio: DecimalString | null;
  mortgageCents: number;
  offsetCents: number;
  netMortgageCents: number;
  principalPaidCents: number;
  interestFeesCents: number;
  repaymentsCents: number;
  startBalanceCents: number;
  lvrRatio: DecimalString | null;
  equityCents: number;
}

export interface PropertyChartPointDto {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  valueCents: number | null;
  purchaseCents: number | null;
  mortgageCents: number | null;
  equityCents: number | null;
  lvrRatio: DecimalString | null;
  interestFeesCents: number | null;
  principalPaidCents: number | null;
}

export interface PropertyPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  lastRun: IsoDate | null;
  /** Sort order. */
  properties: PropertyDto[];
  /** asOf desc. */
  valuations: PropertyValuationDto[];
  /** Mortgages by property order, then loans without a property. */
  loans: LoanDto[];
  /** asOf desc; each loan's start point included (id null). */
  loanEntries: LoanBalanceEntryDto[];
  /** Every account flagged Offset (D56). */
  offsetAccounts: OffsetAccountDto[];
  totals: PropertyTotalsDto;
  charts: { unit: ChartDateUnit; count: number | null; points: PropertyChartPointDto[] };
  /** savings.includeMortgagePrincipal, property.offsetsIncludeEmergencyFund. */
  settings: SettingsSliceDto;
}

export interface PropertyMutationResponse {
  property: PropertyDto;
}

export interface ValuationsResponse {
  properties: PropertyDto[];
}

export interface LoanMutationResponse {
  loan: LoanDto;
}

export interface LoanBalancesResponse {
  loans: LoanDto[];
}

export interface LoanOffsetsResponse {
  loan: LoanDto;
  offsetAccounts: OffsetAccountDto[];
}
