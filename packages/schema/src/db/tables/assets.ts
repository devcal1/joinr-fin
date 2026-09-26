// Other assets, super and property/loans (spec 04), and the Stage 4 logs (stage-4.md §3.1).
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import {
  FX_RATE_SOURCES,
  METALS,
  OTHER_ASSET_PRICE_SOURCES,
  PAYMENT_FREQUENCIES,
  SUPER_ENTRY_KINDS,
  UNITS_OF_MEASURE,
} from '../../enums';
import { cashAccounts } from './cashflow';
import { idColumn, provenanceColumns } from './common';

export const otherAssets = sqliteTable('other_assets', {
  id: idColumn(),
  description: text('description').notNull(),
  /** Cell hyperlink, or the description when it is a URL. */
  url: text('url'),
  purchaseDate: text('purchase_date'),
  units: text('units').notNull(),
  soldUnits: text('sold_units').notNull().default('0'),
  currency: text('currency').notNull().default('AUD'),
  unitCost: text('unit_cost'),
  /** Last known unit price in `currency`. */
  unitPrice: text('unit_price'),
  unitPriceAsOf: text('unit_price_as_of'),
  priceSource: text('price_source', { enum: OTHER_ASSET_PRICE_SOURCES })
    .notNull()
    .default('manual'),
  metal: text('metal', { enum: METALS }),
  unitOfMeasure: text('unit_of_measure', { enum: UNITS_OF_MEASURE }).notNull().default('each'),
  ozPerUnit: text('oz_per_unit'),
  sortOrder: integer('sort_order').notNull(),
  note: text('note'),
  ...provenanceColumns(),
  // Stage 4 (migration 0004, appended). The FX backfill writes these without touching `origin`.
  /** AUD per 1 unit of `currency` at purchase (`GBX`: the per-penny rate); null = unknown. */
  purchaseFxRate: text('purchase_fx_rate'),
  purchaseFxSource: text('purchase_fx_source', { enum: FX_RATE_SOURCES }),
  /** The close date the rate comes from. */
  purchaseFxDate: text('purchase_fx_date'),
});

export const superFunds = sqliteTable('super_funds', {
  id: idColumn(),
  name: text('name').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  balanceAsOf: text('balance_as_of'),
  sortOrder: integer('sort_order').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...provenanceColumns(),
  // Stage 4 (migration 0004, appended): the fund that receives employer SG (at most one, §4.5).
  receivesSg: integer('receives_sg', { mode: 'boolean' }).notNull().default(false),
});

/** Super contributions and reported gains per period (spec 04 §2.2). */
export const superEntries = sqliteTable(
  'super_entries',
  {
    id: idColumn(),
    periodMonth: text('period_month').notNull(),
    kind: text('kind', { enum: SUPER_ENTRY_KINDS }).notNull(),
    fundId: integer('fund_id').references(() => superFunds.id, { onDelete: 'set null' }),
    entryDate: text('entry_date'),
    amountCents: integer('amount_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [index('super_entries_period_idx').on(t.periodMonth)],
);

export const properties = sqliteTable('properties', {
  id: idColumn(),
  name: text('name').notNull(),
  purchaseDate: text('purchase_date'),
  isPrimaryResidence: integer('is_primary_residence', { mode: 'boolean' }).notNull().default(false),
  purchaseValueCents: integer('purchase_value_cents').notNull().default(0),
  currentValueCents: integer('current_value_cents').notNull().default(0),
  valuationDate: text('valuation_date'),
  netRentToDateCents: integer('net_rent_to_date_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  ...provenanceColumns(),
});

/** Mortgages (Property) and other loans (LiabilitiesDebts). Balances are stored positive. */
export const loans = sqliteTable(
  'loans',
  {
    id: idColumn(),
    propertyId: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    lender: text('lender'),
    startDate: text('start_date'),
    interestPeriodsPerYear: integer('interest_periods_per_year'),
    annualRate: text('annual_rate'),
    paymentCents: integer('payment_cents'),
    paymentFrequency: text('payment_frequency', { enum: PAYMENT_FREQUENCIES })
      .notNull()
      .default('monthly'),
    startBalanceCents: integer('start_balance_cents'),
    currentBalanceCents: integer('current_balance_cents').notNull(),
    balanceAsOf: text('balance_as_of'),
    paymentsPaidCents: integer('payments_paid_cents'),
    /** True when the sheet's "payments paid" cell was a formula (principal reduction only). */
    paymentsPaidDerived: integer('payments_paid_derived', { mode: 'boolean' })
      .notNull()
      .default(false),
    sortOrder: integer('sort_order').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [index('loans_property_idx').on(t.propertyId)],
);

// ─── Stage 4 (migration 0004; stage-4.md §3.1) ──────────────────────────────────────────────────

/**
 * D72: an other asset's hand-priced history (in the asset's currency). A manual asset's
 * `unit_price`/`unit_price_as_of` are a denormalised copy of its latest entry.
 */
export const otherAssetPrices = sqliteTable(
  'other_asset_prices',
  {
    id: idColumn(),
    otherAssetId: integer('other_asset_id')
      .notNull()
      .references(() => otherAssets.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    /** ≥ 0, in the asset's currency. */
    unitPrice: text('unit_price').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [
    unique().on(t.otherAssetId, t.asOf),
    index('other_asset_prices_asset_idx').on(t.otherAssetId),
  ],
);

/** D72: an other asset's sales (a date, the units and the AUD proceeds: a realised gain). */
export const otherAssetSales = sqliteTable(
  'other_asset_sales',
  {
    id: idColumn(),
    otherAssetId: integer('other_asset_id')
      .notNull()
      .references(() => otherAssets.id, { onDelete: 'cascade' }),
    saleDate: text('sale_date').notNull(),
    /** > 0. */
    units: text('units').notNull(),
    /** ≥ 0, AUD received. */
    proceedsCents: integer('proceeds_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [index('other_asset_sales_asset_idx').on(t.otherAssetId)],
);

/**
 * D69: a super fund's balance log. The fund's `balance_cents`/`balance_as_of` are a denormalised
 * copy of its latest entry.
 */
export const superBalanceEntries = sqliteTable(
  'super_balance_entries',
  {
    id: idColumn(),
    fundId: integer('fund_id')
      .notNull()
      .references(() => superFunds.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    /** ≥ 0. */
    balanceCents: integer('balance_cents').notNull(),
    /** Money moved in from outside the tracked funds (not a gain); null = none. */
    transferInCents: integer('transfer_in_cents'),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.fundId, t.asOf), index('super_balance_entries_fund_idx').on(t.fundId)],
);

/**
 * D69: employer SG from a statement, per month earned (before contributions tax). An overlay: the
 * import never touches it and it never counts as app data (§3.4).
 */
export const superSgOverrides = sqliteTable(
  'super_sg_overrides',
  {
    id: idColumn(),
    periodMonth: text('period_month').notNull(),
    /** ≥ 0, before contributions tax. */
    grossCents: integer('gross_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.periodMonth)],
);

/**
 * A property's valuation history. The property's `current_value_cents`/`valuation_date` are a
 * denormalised copy of its latest entry.
 */
export const propertyValuations = sqliteTable(
  'property_valuations',
  {
    id: idColumn(),
    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    /** ≥ 0. */
    valueCents: integer('value_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [
    unique().on(t.propertyId, t.asOf),
    index('property_valuations_property_idx').on(t.propertyId),
  ],
);

/**
 * D66: a loan's balance log. The loan's `current_balance_cents`/`balance_as_of` are a denormalised
 * copy of its latest entry. No start entries: the loan's start fields give the log's start point.
 */
export const loanBalanceEntries = sqliteTable(
  'loan_balance_entries',
  {
    id: idColumn(),
    loanId: integer('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    /** ≥ 0. */
    balanceCents: integer('balance_cents').notNull(),
    /** Repayments typed for the time since the previous entry; null = the default (§2.6). */
    repaymentsCents: integer('repayments_cents'),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.loanId, t.asOf), index('loan_balance_entries_loan_idx').on(t.loanId)],
);

/** D67: an offset account linked to a loan (an account links to at most one loan). */
export const loanOffsetLinks = sqliteTable(
  'loan_offset_links',
  {
    accountId: integer('account_id')
      .primaryKey()
      .references(() => cashAccounts.id, { onDelete: 'cascade' }),
    loanId: integer('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    ...provenanceColumns(),
  },
  (t) => [index('loan_offset_links_loan_idx').on(t.loanId)],
);
