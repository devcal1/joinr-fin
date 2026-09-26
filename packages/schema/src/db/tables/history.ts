// Monthly snapshots (spec 01 §2.3, D29): one row per History row, signs exactly as the sheet.
// Money is rounded to integer cents at import; ratios keep 12 significant digits (§2.4 precision).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { RECORD_TRIGGERS, SNAPSHOT_AUDIT_ACTIONS, SNAPSHOT_SOURCES } from '../../enums';
import { idColumn, provenanceColumns } from './common';

export const snapshots = sqliteTable('snapshots', {
  id: idColumn(),
  runDate: text('run_date').notNull(),
  periodMonth: text('period_month').notNull().unique(),
  source: text('source', { enum: SNAPSHOT_SOURCES }).notNull(),
  /** Null for migrated rows. */
  recordedAt: text('recorded_at'),
  ...provenanceColumns(),
  stocksValueCents: integer('stocks_value_cents'), // B
  stocksGainCents: integer('stocks_gain_cents'), // C
  stocksGainRatio: text('stocks_gain_ratio'), // D
  stocksMovementsCents: integer('stocks_movements_cents'), // E
  etfValueCents: integer('etf_value_cents'), // F
  etfGainCents: integer('etf_gain_cents'), // G
  etfGainRatio: text('etf_gain_ratio'), // H
  etfMovementsCents: integer('etf_movements_cents'), // I
  cryptoValueCents: integer('crypto_value_cents'), // J
  cryptoGainCents: integer('crypto_gain_cents'), // K
  cryptoGainRatio: text('crypto_gain_ratio'), // L
  cryptoMovementsCents: integer('crypto_movements_cents'), // M
  cashValueCents: integer('cash_value_cents'), // N
  cashGainCents: integer('cash_gain_cents'), // O
  cashIncreaseRatio: text('cash_increase_ratio'), // P
  superValueCents: integer('super_value_cents'), // Q
  superContribCents: integer('super_contrib_cents'), // R
  superGainCents: integer('super_gain_cents'), // S
  superGainRatio: text('super_gain_ratio'), // T
  liabilitiesBalanceCents: integer('liabilities_balance_cents'), // U
  liabilitiesPaidCents: integer('liabilities_paid_cents'), // V
  salaryMonthlyCents: integer('salary_monthly_cents'), // W
  propertyValueCents: integer('property_value_cents'), // X
  propertyPurchaseCents: integer('property_purchase_cents'), // Y
  propertyEquityCents: integer('property_equity_cents'), // Z
  propertyGainCents: integer('property_gain_cents'), // AA
  mortgageBalanceCents: integer('mortgage_balance_cents'), // AB
  mortgageInterestFeesCents: integer('mortgage_interest_fees_cents'), // AC
  mortgagePrincipalPaidCents: integer('mortgage_principal_paid_cents'), // AD
  propertyGainRatio: text('property_gain_ratio'), // AE
  mfValueCents: integer('mf_value_cents'), // AF
  mfGainCents: integer('mf_gain_cents'), // AG
  mfGainRatio: text('mf_gain_ratio'), // AH
  mfMovementsCents: integer('mf_movements_cents'), // AI
  otherValueCents: integer('other_value_cents'), // AJ
  otherGainCents: integer('other_gain_cents'), // AK
  // Stage 5 (migration 0005, stage-5.md §3.1): null on migrated rows.
  /** D88b: Σ every offset account at the run date. */
  offsetCents: integer('offset_cents'),
  /** The offsets linked to property loans (inside property_equity_cents, D67). */
  mortgageOffsetCents: integer('mortgage_offset_cents'),
  /** Σ non-offset accounts in debit (≤ 0, inside cash_value_cents). */
  cashDebtCents: integer('cash_debt_cents'),
  /** D88a: the D79 cut-off (IsoDate) when the month was recorded. */
  superMeasuredThrough: text('super_measured_through'),
  /** The record note (≤ 200). */
  note: text('note'),
  /** The number of corrections applied. */
  revision: integer('revision').notNull().default(0),
});

/**
 * The snapshot correction log (stage-5.md §3.1): no FK (it outlives a deleted or re-imported
 * month) and no provenance (never app data).
 */
export const snapshotAudit = sqliteTable(
  'snapshot_audit',
  {
    id: idColumn(),
    periodMonth: text('period_month').notNull(),
    /** The row at the time (null after a delete). */
    snapshotId: integer('snapshot_id'),
    action: text('action', { enum: SNAPSHOT_AUDIT_ACTIONS }).notNull(),
    trigger: text('trigger', { enum: RECORD_TRIGGERS }).notNull(),
    /** ISO timestamp (UTC). */
    at: text('at').notNull(),
    changesJson: text('changes_json'),
    snapshotJson: text('snapshot_json'),
    note: text('note'),
    detailJson: text('detail_json'),
  },
  (t) => [index('snapshot_audit_period_idx').on(t.periodMonth)],
);
