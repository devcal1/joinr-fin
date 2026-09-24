// Trades (spec 03 §1.3) and dividends (spec 02 §4, D28).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { INSTRUMENT_KINDS } from '../../enums';
import { idColumn, provenanceColumns } from './common';
import { instruments } from './instruments';

/**
 * Fee authority (Stage 2 must follow): when `fee_rate` is set, the fee is
 * |fee_rate × units × price| computed in decimal and `fee_cents` is only a rounded display value;
 * when `fee_rate` is null, `fee_cents` is exact.
 */
export const trades = sqliteTable(
  'trades',
  {
    id: idColumn(),
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    tradeDate: text('trade_date').notNull(),
    /** Signed; negative = sell. */
    units: text('units').notNull(),
    /** AUD per unit. */
    price: text('price').notNull(),
    feeCents: integer('fee_cents').notNull().default(0),
    feeRate: text('fee_rate'),
    /** 1-based row order within the tab's ledger (FIFO tie-break). */
    seq: integer('seq').notNull(),
    reviewFlags: text('review_flags'),
    correctionId: text('correction_id'),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [index('trades_instrument_date_seq_idx').on(t.instrumentId, t.tradeDate, t.seq)],
);

export const dividends = sqliteTable(
  'dividends',
  {
    id: idColumn(),
    /** Null = unmatched ticker. */
    instrumentId: integer('instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),
    /** As typed in the sheet. */
    ticker: text('ticker').notNull(),
    holdingKind: text('holding_kind', { enum: INSTRUMENT_KINDS }).notNull(),
    paymentDate: text('payment_date').notNull(),
    exDate: text('ex_date'),
    /** Null = blank. */
    reinvested: integer('reinvested', { mode: 'boolean' }),
    netAmountCents: integer('net_amount_cents').notNull(),
    priceAtEx: text('price_at_ex'),
    priceAtExManual: integer('price_at_ex_manual', { mode: 'boolean' }).notNull().default(false),
    reviewFlags: text('review_flags'),
    correctionId: text('correction_id'),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [
    index('dividends_instrument_idx').on(t.instrumentId),
    index('dividends_payment_date_idx').on(t.paymentDate),
  ],
);
