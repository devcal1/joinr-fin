// Instruments and their pricing: instruments, price_sources, prices, market_quotes (§2.4).
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import {
  FETCH_STATUSES,
  INSTRUMENT_KINDS,
  MANUAL_ORIGINS,
  PRICE_PROVIDERS,
  PRICE_SOURCES,
  SYMBOL_ORIGINS,
} from '../../enums';
import { idColumn, provenanceColumns } from './common';

/** Watch-table rows plus ledger-only instruments (spec 03). */
export const instruments = sqliteTable(
  'instruments',
  {
    id: idColumn(),
    kind: text('kind', { enum: INSTRUMENT_KINDS }).notNull(),
    /** Exactly as in the sheet: `ASX:ABC`, `EXAMPLEFUND`, `BTC`. */
    symbol: text('symbol').notNull(),
    /** `ASX` from `ASX:ABC`; null otherwise. */
    exchange: text('exchange'),
    /** The part after `:`, else the whole symbol (dividend re-keying, D28). */
    code: text('code').notNull(),
    name: text('name'),
    quoteCurrency: text('quote_currency').notNull().default('AUD'),
    /** False = only in the ledger (e.g. an exited holding). */
    isWatched: integer('is_watched', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
    targetRatio: text('target_ratio'),
    sector: text('sector'),
    isRetirement: integer('is_retirement', { mode: 'boolean' }).notNull().default(false),
    location: text('location'),
    mgmtFeeRatio: text('mgmt_fee_ratio'),
    regionUsRatio: text('region_us_ratio'),
    regionAsiaRatio: text('region_asia_ratio'),
    regionAusRatio: text('region_aus_ratio'),
    regionOtherRatio: text('region_other_ratio'),
    dividendFreqMonths: integer('dividend_freq_months'),
    /** Null = unknown. */
    drp: integer('drp', { mode: 'boolean' }),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.kind, t.symbol), index('instruments_code_idx').on(t.code)],
);

/** Per-instrument pricing configuration (1:1). */
export const priceSources = sqliteTable('price_sources', {
  instrumentId: integer('instrument_id')
    .primaryKey()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: PRICE_PROVIDERS }).notNull(),
  /** `ABC.AX`, `bitcoin`; null = unresolved. */
  providerSymbol: text('provider_symbol'),
  symbolOrigin: text('symbol_origin', { enum: SYMBOL_ORIGINS }).notNull(),
  /** AUD. */
  manualPrice: text('manual_price'),
  manualPriceAsOf: text('manual_price_as_of'),
  manualOrigin: text('manual_origin', { enum: MANUAL_ORIGINS }),
  manualNote: text('manual_note'),
  updatedAt: text('updated_at').notNull(),
});

/** Latest price cache per instrument (1:1). */
export const prices = sqliteTable('prices', {
  instrumentId: integer('instrument_id')
    .primaryKey()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  /** Last good AUD price. */
  price: text('price'),
  nativePrice: text('native_price'),
  nativeCurrency: text('native_currency'),
  /** AUD per native unit applied. */
  fxRate: text('fx_rate'),
  /** Market time of the good price (timestamp). */
  asOf: text('as_of'),
  fetchedAt: text('fetched_at'),
  source: text('source', { enum: PRICE_SOURCES }),
  lastAttemptAt: text('last_attempt_at'),
  lastStatus: text('last_status', { enum: FETCH_STATUSES }).notNull().default('never'),
  /** ≤ 200 chars. */
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

/** Latest value per market series (FX, bullion; D23/D25). */
export const marketQuotes = sqliteTable('market_quotes', {
  /** `AUDUSD`, `SI_USD_OZ`, `GC_USD_OZ`, `XAG_AUD_OZ`, `XAU_AUD_OZ`, dynamic `FX_<CCY>AUD`. */
  seriesId: text('series_id').primaryKey(),
  value: text('value'),
  unit: text('unit').notNull(),
  asOf: text('as_of'),
  fetchedAt: text('fetched_at'),
  source: text('source'),
  lastAttemptAt: text('last_attempt_at'),
  lastStatus: text('last_status', { enum: FETCH_STATUSES }).notNull().default('never'),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});
