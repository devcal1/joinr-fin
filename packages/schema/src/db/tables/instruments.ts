// Instruments and their pricing: instruments, price_sources, prices, market_quotes (§2.4), the
// Stage 3 dividend-events cache (stage-3.md §3.1, §4.6), the Stage 4 series history
// (stage-4.md §3.1, §4.6) and the Stage 9 day caches (stage-9.md §3.1, §3.1a, §3.2).
import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import {
  DAY_GRANULARITIES,
  DAY_QUOTE_SOURCES,
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
    // Stage 2 (migration 0002, appended; D38). The importer never writes these, so a re-import
    // keeps them. Null = the global default (investing.defaultBrokerageCents / crypto.feeRate).
    /** The holding's flat default trade fee (cents). */
    defaultFeeCents: integer('default_fee_cents'),
    /** Crypto only: the holding's default fee rate (a ratio). */
    defaultFeeRate: text('default_fee_rate'),
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
  // Stage 9 (migration 0006, stage-9.md §3.2): the FX series' own previous close and its session
  // date (`AUDUSD` and `FX_<CCY>AUD` only; the bullion series leave both null).
  previousClose: text('previous_close'),
  previousCloseDate: text('previous_close_date'),
});

/**
 * D50: the Yahoo dividend events cache (ex-date + per-unit amount, and the close before the
 * ex-date). A refresh upserts by `(instrument_id, ex_date)` and never touches `dismissed_at`. No
 * provenance: the import never writes it and it never counts as app data.
 */
export const dividendEvents = sqliteTable(
  'dividend_events',
  {
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    exDate: text('ex_date').notNull(),
    amountPerUnit: text('amount_per_unit').notNull(),
    currency: text('currency').notNull(),
    closeBeforeEx: text('close_before_ex'),
    closeDate: text('close_date'),
    source: text('source', { enum: PRICE_SOURCES }).notNull(),
    fetchedAt: text('fetched_at').notNull(),
    dismissedAt: text('dismissed_at'),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.exDate] })],
);

/**
 * Stage 4 (stage-4.md §4.6): a daily history of the market series (bullion spot, FX), one row per
 * series per server-local day (a later run that day replaces it). A cache: no provenance, never
 * app data, never dumped.
 */
export const marketQuoteHistory = sqliteTable(
  'market_quote_history',
  {
    seriesId: text('series_id').notNull(),
    date: text('date').notNull(),
    value: text('value').notNull(),
    source: text('source').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.date] })],
);

/** The columns `day_quotes` and `series_day_quotes` share (stage-9.md §3.1). */
function dayQuoteColumns() {
  return {
    /** `YYYY-MM-DD` in `time_zone`. */
    sessionDate: text('session_date').notNull(),
    /** IANA zone of the session (crypto and bullion: the server's zone). */
    timeZone: text('time_zone').notNull(),
    granularity: text('granularity', { enum: DAY_GRANULARITIES }).notNull(),
    /** As Yahoo/CoinGecko report it (`AUD`, `USD`, `GBp`). */
    nativeCurrency: text('native_currency').notNull(),
    /** Native decimal; null = unknown. Crypto and bullion: the 00:00 price. */
    previousClose: text('previous_close'),
    /** UTC ISO of the session's regular period (null when unknown). */
    regularStart: text('regular_start'),
    regularEnd: text('regular_end'),
    /** JSON `[[unixSeconds,"price"],…]`, ascending, unique times, ≤ DAY_POINTS_MAX. */
    points: text('points').notNull().default('[]'),
    source: text('source', { enum: DAY_QUOTE_SOURCES }).notNull(),
    /** UTC ISO. */
    fetchedAt: text('fetched_at').notNull(),
  };
}

/**
 * Stage 9 (stage-9.md §3.1): each instrument's latest session (1:1): its date and zone, its
 * previous close and its bars. A cache: no provenance, never app data, not in
 * DOMAIN_TABLES_DELETE_ORDER (a re-import keeps it, like `prices`), never dumped.
 */
export const dayQuotes = sqliteTable('day_quotes', {
  instrumentId: integer('instrument_id')
    .primaryKey()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  ...dayQuoteColumns(),
});

/**
 * Stage 9 (stage-9.md §3.1a, D148, D153): bullion's day since 00:00 Melbourne, by series id: the
 * AUD spots `XAG_AUD_OZ`/`XAU_AUD_OZ` and the futures `SI_USD_OZ`/`GC_USD_OZ` (four rows at most;
 * no foreign key). A cache exactly like `day_quotes`.
 */
export const seriesDayQuotes = sqliteTable('series_day_quotes', {
  seriesId: text('series_id').primaryKey(),
  ...dayQuoteColumns(),
});
