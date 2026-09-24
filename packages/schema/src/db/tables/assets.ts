// Other assets, super and property/loans (spec 04).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  METALS,
  OTHER_ASSET_PRICE_SOURCES,
  PAYMENT_FREQUENCIES,
  SUPER_ENTRY_KINDS,
  UNITS_OF_MEASURE,
} from '../../enums';
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
});

export const superFunds = sqliteTable('super_funds', {
  id: idColumn(),
  name: text('name').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  balanceAsOf: text('balance_as_of'),
  sortOrder: integer('sort_order').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...provenanceColumns(),
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
