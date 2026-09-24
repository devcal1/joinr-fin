// Zod insert schemas, one per table (stage-1.md §2.2). Every write boundary (importer, API)
// validates rows with these. Hand-written (no drizzle-zod); test/rows-parity.test.ts proves at
// the type level that each schema's output equals the Drizzle table's `$inferInsert`.
// This module is part of the root export, so it must not import drizzle-orm.
import { z } from 'zod';
import {
  BUDGET_ITEM_KINDS,
  CASH_ACCOUNT_KINDS,
  FETCH_STATUSES,
  IMPORT_TRIGGERS,
  INSTRUMENT_KINDS,
  JOB_STATUSES,
  JOB_TRIGGERS,
  MANUAL_ORIGINS,
  METALS,
  ORIGINS,
  OTHER_ASSET_PRICE_SOURCES,
  PAYMENT_FREQUENCIES,
  PERIOD_NOTE_KINDS,
  PRICE_PROVIDERS,
  PRICE_SOURCES,
  REVIEW_FLAGS,
  RUN_STATUSES,
  SNAPSHOT_SOURCES,
  SUPER_ENTRY_KINDS,
  SYMBOL_ORIGINS,
  UNITS_OF_MEASURE,
  type ReviewFlag,
} from './enums';
import {
  CentsSchema,
  DecimalStringSchema,
  IsoDateSchema,
  IsoMonthSchema,
  IsoTimestampSchema,
} from './primitives';

const idSchema = z.number().int().positive().optional();
const sortOrder = z.number().int();
const text = z.string();
const nonEmpty = z.string().min(1);
const bool = z.boolean();

/** A nullable column: may be omitted or null. */
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const provenance = {
  origin: z.enum(ORIGINS).optional(),
  sheetRef: nullable(text),
};

/** Parses a `review_flags` value: a JSON array of REVIEW_FLAGS codes (null when none). */
export function parseReviewFlags(value: string | null): ReviewFlag[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  return z.array(z.enum(REVIEW_FLAGS)).parse(parsed);
}

/** ReviewFlag[] → the `review_flags` column value (null when empty; order kept, duplicates removed). */
export function serialiseReviewFlags(flags: readonly ReviewFlag[]): string | null {
  const unique = [...new Set(flags)];
  return unique.length === 0 ? null : JSON.stringify(unique);
}

export const ReviewFlagsJsonSchema = z.string().refine(
  (v) => {
    try {
      return parseReviewFlags(v).length > 0;
    } catch {
      return false;
    }
  },
  { error: 'must be a non-empty JSON array of review flag codes' },
);

const jsonText = z.string().refine(
  (v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  },
  { error: 'must be valid JSON' },
);

export const newAppMetaSchema = z.strictObject({
  key: nonEmpty,
  value: text,
  updatedAt: IsoTimestampSchema,
});

export const newSettingSchema = z.strictObject({
  key: nonEmpty,
  valueJson: jsonText,
  updatedAt: IsoTimestampSchema,
  origin: z.enum(ORIGINS),
});

export const newInstrumentSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(INSTRUMENT_KINDS),
  symbol: nonEmpty,
  exchange: nullable(nonEmpty),
  code: nonEmpty,
  name: nullable(text),
  quoteCurrency: nonEmpty.optional(),
  isWatched: bool.optional(),
  sortOrder,
  targetRatio: nullable(DecimalStringSchema),
  sector: nullable(text),
  isRetirement: bool.optional(),
  location: nullable(text),
  mgmtFeeRatio: nullable(DecimalStringSchema),
  regionUsRatio: nullable(DecimalStringSchema),
  regionAsiaRatio: nullable(DecimalStringSchema),
  regionAusRatio: nullable(DecimalStringSchema),
  regionOtherRatio: nullable(DecimalStringSchema),
  dividendFreqMonths: nullable(z.number().int().positive()),
  drp: nullable(bool),
  note: nullable(text),
  ...provenance,
});

export const newPriceSourceSchema = z.strictObject({
  instrumentId: z.number().int().positive(),
  provider: z.enum(PRICE_PROVIDERS),
  providerSymbol: nullable(nonEmpty),
  symbolOrigin: z.enum(SYMBOL_ORIGINS),
  manualPrice: nullable(DecimalStringSchema),
  manualPriceAsOf: nullable(IsoDateSchema),
  manualOrigin: nullable(z.enum(MANUAL_ORIGINS)),
  manualNote: nullable(text),
  updatedAt: IsoTimestampSchema,
});

export const newPriceSchema = z.strictObject({
  instrumentId: z.number().int().positive(),
  price: nullable(DecimalStringSchema),
  nativePrice: nullable(DecimalStringSchema),
  nativeCurrency: nullable(nonEmpty),
  fxRate: nullable(DecimalStringSchema),
  asOf: nullable(IsoTimestampSchema),
  fetchedAt: nullable(IsoTimestampSchema),
  source: nullable(z.enum(PRICE_SOURCES)),
  lastAttemptAt: nullable(IsoTimestampSchema),
  lastStatus: z.enum(FETCH_STATUSES).optional(),
  lastError: nullable(z.string().max(200)),
  consecutiveFailures: z.number().int().min(0).optional(),
});

export const newMarketQuoteSchema = z.strictObject({
  seriesId: nonEmpty,
  value: nullable(DecimalStringSchema),
  unit: nonEmpty,
  asOf: nullable(IsoTimestampSchema),
  fetchedAt: nullable(IsoTimestampSchema),
  source: nullable(text),
  lastAttemptAt: nullable(IsoTimestampSchema),
  lastStatus: z.enum(FETCH_STATUSES).optional(),
  lastError: nullable(z.string().max(200)),
  consecutiveFailures: z.number().int().min(0).optional(),
});

export const newTradeSchema = z.strictObject({
  id: idSchema,
  instrumentId: z.number().int().positive(),
  tradeDate: IsoDateSchema,
  units: DecimalStringSchema,
  price: DecimalStringSchema,
  feeCents: CentsSchema.optional(),
  feeRate: nullable(DecimalStringSchema),
  seq: z.number().int().positive(),
  reviewFlags: nullable(ReviewFlagsJsonSchema),
  correctionId: nullable(nonEmpty),
  note: nullable(text),
  ...provenance,
});

export const newDividendSchema = z.strictObject({
  id: idSchema,
  instrumentId: nullable(z.number().int().positive()),
  ticker: nonEmpty,
  holdingKind: z.enum(INSTRUMENT_KINDS),
  paymentDate: IsoDateSchema,
  exDate: nullable(IsoDateSchema),
  reinvested: nullable(bool),
  netAmountCents: CentsSchema,
  priceAtEx: nullable(DecimalStringSchema),
  priceAtExManual: bool.optional(),
  reviewFlags: nullable(ReviewFlagsJsonSchema),
  correctionId: nullable(nonEmpty),
  note: nullable(text),
  ...provenance,
});

export const newCashAccountSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  kind: z.enum(CASH_ACCOUNT_KINDS).optional(),
  currency: nonEmpty.optional(),
  balanceCents: CentsSchema,
  balanceAsOf: nullable(IsoDateSchema),
  isOffset: bool.optional(),
  archived: bool.optional(),
  sortOrder,
  note: nullable(text),
  ...provenance,
});

export const newBudgetItemSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  kind: z.enum(BUDGET_ITEM_KINDS),
  monthlyCents: nullable(CentsSchema),
  category: nullable(text),
  accountName: nullable(text),
  cashAccountId: nullable(z.number().int().positive()),
  sortOrder,
  reviewFlags: nullable(ReviewFlagsJsonSchema),
  ...provenance,
});

export const newYearlyExpenseSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  annualCents: CentsSchema,
  sortOrder,
  ...provenance,
});

export const newIncomeStreamSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  sortOrder,
  archived: bool.optional(),
  ...provenance,
});

export const newSideIncomeEntrySchema = z.strictObject({
  id: idSchema,
  streamId: z.number().int().positive(),
  periodMonth: IsoMonthSchema,
  periodStart: nullable(IsoDateSchema),
  periodEnd: nullable(IsoDateSchema),
  amountCents: CentsSchema,
  ...provenance,
});

export const newPeriodNoteSchema = z.strictObject({
  id: idSchema,
  periodMonth: IsoMonthSchema,
  kind: z.enum(PERIOD_NOTE_KINDS),
  note: nonEmpty,
  ...provenance,
});

const cents = nullable(CentsSchema);
const ratio = nullable(DecimalStringSchema);

export const newSnapshotSchema = z.strictObject({
  id: idSchema,
  runDate: IsoDateSchema,
  periodMonth: IsoMonthSchema,
  source: z.enum(SNAPSHOT_SOURCES),
  recordedAt: nullable(IsoTimestampSchema),
  ...provenance,
  stocksValueCents: cents,
  stocksGainCents: cents,
  stocksGainRatio: ratio,
  stocksMovementsCents: cents,
  etfValueCents: cents,
  etfGainCents: cents,
  etfGainRatio: ratio,
  etfMovementsCents: cents,
  cryptoValueCents: cents,
  cryptoGainCents: cents,
  cryptoGainRatio: ratio,
  cryptoMovementsCents: cents,
  cashValueCents: cents,
  cashGainCents: cents,
  cashIncreaseRatio: ratio,
  superValueCents: cents,
  superContribCents: cents,
  superGainCents: cents,
  superGainRatio: ratio,
  liabilitiesBalanceCents: cents,
  liabilitiesPaidCents: cents,
  salaryMonthlyCents: cents,
  propertyValueCents: cents,
  propertyPurchaseCents: cents,
  propertyEquityCents: cents,
  propertyGainCents: cents,
  mortgageBalanceCents: cents,
  mortgageInterestFeesCents: cents,
  mortgagePrincipalPaidCents: cents,
  propertyGainRatio: ratio,
  mfValueCents: cents,
  mfGainCents: cents,
  mfGainRatio: ratio,
  mfMovementsCents: cents,
  otherValueCents: cents,
  otherGainCents: cents,
});

export const newOtherAssetSchema = z.strictObject({
  id: idSchema,
  description: nonEmpty,
  url: nullable(text),
  purchaseDate: nullable(IsoDateSchema),
  units: DecimalStringSchema,
  soldUnits: DecimalStringSchema.optional(),
  currency: nonEmpty.optional(),
  unitCost: nullable(DecimalStringSchema),
  unitPrice: nullable(DecimalStringSchema),
  unitPriceAsOf: nullable(IsoDateSchema),
  priceSource: z.enum(OTHER_ASSET_PRICE_SOURCES).optional(),
  metal: nullable(z.enum(METALS)),
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional(),
  ozPerUnit: nullable(DecimalStringSchema),
  sortOrder,
  note: nullable(text),
  ...provenance,
});

export const newSuperFundSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  balanceCents: CentsSchema,
  balanceAsOf: nullable(IsoDateSchema),
  sortOrder,
  archived: bool.optional(),
  ...provenance,
});

export const newSuperEntrySchema = z.strictObject({
  id: idSchema,
  periodMonth: IsoMonthSchema,
  kind: z.enum(SUPER_ENTRY_KINDS),
  fundId: nullable(z.number().int().positive()),
  entryDate: nullable(IsoDateSchema),
  amountCents: CentsSchema,
  note: nullable(text),
  ...provenance,
});

export const newPropertySchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  purchaseDate: nullable(IsoDateSchema),
  isPrimaryResidence: bool.optional(),
  purchaseValueCents: CentsSchema.optional(),
  currentValueCents: CentsSchema.optional(),
  valuationDate: nullable(IsoDateSchema),
  netRentToDateCents: CentsSchema.optional(),
  sortOrder,
  archived: bool.optional(),
  note: nullable(text),
  ...provenance,
});

export const newLoanSchema = z.strictObject({
  id: idSchema,
  propertyId: nullable(z.number().int().positive()),
  name: nonEmpty,
  lender: nullable(text),
  startDate: nullable(IsoDateSchema),
  interestPeriodsPerYear: nullable(z.number().int().positive()),
  annualRate: nullable(DecimalStringSchema),
  paymentCents: nullable(CentsSchema),
  paymentFrequency: z.enum(PAYMENT_FREQUENCIES).optional(),
  startBalanceCents: nullable(CentsSchema.min(0)),
  currentBalanceCents: CentsSchema.min(0),
  balanceAsOf: nullable(IsoDateSchema),
  paymentsPaidCents: nullable(CentsSchema),
  paymentsPaidDerived: bool.optional(),
  sortOrder,
  archived: bool.optional(),
  note: nullable(text),
  ...provenance,
});

export const newImportRunSchema = z.strictObject({
  id: idSchema,
  startedAt: IsoTimestampSchema,
  finishedAt: nullable(IsoTimestampSchema),
  status: z.enum(RUN_STATUSES),
  dryRun: bool.optional(),
  trigger: z.enum(IMPORT_TRIGGERS),
  fileName: nonEmpty,
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fileSize: z.number().int().min(0),
  workbookAsOf: nullable(IsoDateSchema),
  correctionsName: nullable(nonEmpty),
  correctionsSha256: nullable(z.string().regex(/^[0-9a-f]{64}$/)),
  importerVersion: nonEmpty,
  totalsJson: nullable(jsonText),
  reportJson: nullable(jsonText),
  errorCode: nullable(nonEmpty),
  error: nullable(text),
});

export const newJobRunSchema = z.strictObject({
  id: idSchema,
  job: nonEmpty,
  trigger: z.enum(JOB_TRIGGERS),
  startedAt: IsoTimestampSchema,
  finishedAt: nullable(IsoTimestampSchema),
  status: z.enum(JOB_STATUSES),
  detailJson: nullable(jsonText),
  error: nullable(text),
});

export type NewInstrument = z.output<typeof newInstrumentSchema>;
export type NewTrade = z.output<typeof newTradeSchema>;
export type NewDividend = z.output<typeof newDividendSchema>;
export type NewSnapshot = z.output<typeof newSnapshotSchema>;
