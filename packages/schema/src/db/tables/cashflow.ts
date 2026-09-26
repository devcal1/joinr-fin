// Cash, budget and income tables (spec 02).
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { BUDGET_ITEM_KINDS, CASH_ACCOUNT_KINDS, PERIOD_NOTE_KINDS } from '../../enums';
import { idColumn, provenanceColumns } from './common';

export const cashAccounts = sqliteTable('cash_accounts', {
  id: idColumn(),
  name: text('name').notNull(),
  /** The importer always writes `bank`; Stage 3 reclassifies. */
  kind: text('kind', { enum: CASH_ACCOUNT_KINDS }).notNull().default('bank'),
  currency: text('currency').notNull().default('AUD'),
  balanceCents: integer('balance_cents').notNull(),
  balanceAsOf: text('balance_as_of'),
  isOffset: integer('is_offset', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull(),
  note: text('note'),
  ...provenanceColumns(),
});

export const budgetItems = sqliteTable(
  'budget_items',
  {
    id: idColumn(),
    name: text('name').notNull(),
    kind: text('kind', { enum: BUDGET_ITEM_KINDS }).notNull(),
    /** Null for `auto_*` rows (Stage 3 derives them). */
    monthlyCents: integer('monthly_cents'),
    category: text('category'),
    /** As typed in the sheet. */
    accountName: text('account_name'),
    cashAccountId: integer('cash_account_id').references(() => cashAccounts.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull(),
    reviewFlags: text('review_flags'),
    ...provenanceColumns(),
  },
  (t) => [index('budget_items_cash_account_idx').on(t.cashAccountId)],
);

export const yearlyExpenses = sqliteTable('yearly_expenses', {
  id: idColumn(),
  name: text('name').notNull(),
  annualCents: integer('annual_cents').notNull(),
  sortOrder: integer('sort_order').notNull(),
  ...provenanceColumns(),
});

export const incomeStreams = sqliteTable('income_streams', {
  id: idColumn(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...provenanceColumns(),
});

export const sideIncomeEntries = sqliteTable(
  'side_income_entries',
  {
    id: idColumn(),
    streamId: integer('stream_id')
      .notNull()
      .references(() => incomeStreams.id, { onDelete: 'cascade' }),
    periodMonth: text('period_month').notNull(),
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    amountCents: integer('amount_cents').notNull(),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.periodMonth, t.streamId)],
);

/** Spend notes (Cash Q), super option notes (Super F), side-income notes (Side Income J). */
export const periodNotes = sqliteTable(
  'period_notes',
  {
    id: idColumn(),
    periodMonth: text('period_month').notNull(),
    kind: text('kind', { enum: PERIOD_NOTE_KINDS }).notNull(),
    note: text('note').notNull(),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.periodMonth, t.kind)],
);

// ─── Stage 3 (migration 0003; stage-3.md §3.1) ──────────────────────────────────────────────────

/**
 * D58: an account's balance history. The account's `balance_cents`/`balance_as_of` are a
 * denormalised copy of its latest entry. The import writes one entry per account (the workbook
 * as-of); a balance save in the app writes or replaces the entry for `(account, as_of)`.
 */
export const cashBalanceEntries = sqliteTable(
  'cash_balance_entries',
  {
    id: idColumn(),
    accountId: integer('account_id')
      .notNull()
      .references(() => cashAccounts.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    balanceCents: integer('balance_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [
    unique().on(t.accountId, t.asOf),
    index('cash_balance_entries_account_idx').on(t.accountId),
  ],
);

/**
 * D57: dated side-income deposits (non-zero amounts), bucketed into snapshot periods by the
 * engine. Replaces `side_income_entries`, which stays (append-only) but is never written again.
 */
export const sideIncomeDeposits = sqliteTable(
  'side_income_deposits',
  {
    id: idColumn(),
    streamId: integer('stream_id')
      .notNull()
      .references(() => incomeStreams.id, { onDelete: 'cascade' }),
    depositDate: text('deposit_date').notNull(),
    /** Non-zero; negative = a reversal. */
    amountCents: integer('amount_cents').notNull(),
    note: text('note'),
    ...provenanceColumns(),
  },
  (t) => [
    index('side_income_deposits_date_idx').on(t.depositDate),
    index('side_income_deposits_stream_idx').on(t.streamId),
  ],
);

/**
 * D51: a one-off inflow (or outflow) taken out of a closed period's savings. An overlay: the
 * import never touches it and it never counts as app data (stage-3.md §3.4).
 */
export const savingsAdjustments = sqliteTable(
  'savings_adjustments',
  {
    id: idColumn(),
    periodMonth: text('period_month').notNull(),
    /** Non-zero, signed. */
    amountCents: integer('amount_cents').notNull(),
    note: text('note').notNull(),
    ...provenanceColumns(),
  },
  (t) => [unique().on(t.periodMonth)],
);

/** D55: savings goals, filled in `sort_order` (a waterfall). An overlay, like the adjustments. */
export const savingsGoals = sqliteTable('savings_goals', {
  id: idColumn(),
  name: text('name').notNull(),
  targetCents: integer('target_cents').notNull(),
  targetDate: text('target_date'),
  sortOrder: integer('sort_order').notNull(),
  note: text('note'),
  ...provenanceColumns(),
});
