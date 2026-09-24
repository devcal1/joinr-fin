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
