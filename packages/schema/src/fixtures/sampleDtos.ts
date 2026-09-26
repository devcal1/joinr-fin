// Typed, generic API response fixtures for UI tests (stage-1.md §2.2, §7.6 phase A).
// No drizzle, no sqlite, no node imports: the web's Vitest (jsdom) imports this module.
// Values are made up and round; symbols are the generic test symbols only. The objects are
// consistent with each other (ids, counts, statuses) and cover every state the pages render.
import type { CheckStatus, MarketDataMode, RunStatus } from '../enums';
import { RECORD_ENTITIES, RECORD_ENTITY_IDS, SNAPSHOT_VALUE_COLUMNS } from '../records';
import type { RecordEntityId } from '../records';
import type { ApiErrorBody } from '../dto/errors';
import type { ImportRunDetail, ImportRunSummary, ImportRunsResponse } from '../dto/import';
import type {
  JobRunSummary,
  MarketQuoteItem,
  MarketSeriesResponse,
  PriceItem,
  PricesResponse,
  RefreshResponse,
} from '../dto/prices';
import type {
  RecordCell,
  RecordEntitySummary,
  RecordRow,
  RecordsIndexResponse,
  RecordsPageResponse,
} from '../dto/records';
import type { ReconciliationCheck, ReconciliationReport } from '../dto/report';
import type { AppStatus } from '../dto/status';

/** The "current time" the fixtures are written against (a Thursday). */
export const FIXTURE_NOW = '2026-09-24T04:32:00.000Z';
export const FIXTURE_WORKBOOK_AS_OF = '2026-08-31';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

// ─── Records ─────────────────────────────────────────────────────────────────────────────────────

type Cells = Record<string, RecordCell>;

// prettier-ignore
const snapshotValues = (step: number): Cells =>
  Object.fromEntries(
    SNAPSHOT_VALUE_COLUMNS.map((c, i) => [
      c.id,
      c.type === 'ratio' ? (i % 7 === 0 ? null : '0.05') : i === 14 ? null : (i + 1) * 10000 + step * 1000,
    ]),
  );

/** Rows per entity (cells cover every registry column; some nulls on purpose). */
// prettier-ignore
const RECORD_ROWS: Record<RecordEntityId, RecordRow[]> = {
  instruments: [
    { id: '1', cells: { kind: 'stock', symbol: 'ASX:ABC', name: 'ABC Example Ltd', currency: 'AUD', watched: true, heldUnits: '150', targetRatio: '0.5', sector: 'Materials', retirement: false, mgmtFeeRatio: null, location: null, regionUs: null, regionAsia: null, regionAus: null, regionOther: null, dividendFreqMonths: 6, drp: false, defaultFee: null, defaultFeeRate: null, provider: 'yahoo', providerSymbol: 'ABC.AX', origin: 'import' } },
    { id: '2', cells: { kind: 'stock', symbol: 'ASX:OLD', name: null, currency: 'AUD', watched: false, heldUnits: '0', targetRatio: null, sector: null, retirement: false, mgmtFeeRatio: null, location: null, regionUs: null, regionAsia: null, regionAus: null, regionOther: null, dividendFreqMonths: null, drp: null, defaultFee: null, defaultFeeRate: null, provider: 'yahoo', providerSymbol: 'OLD.AX', origin: 'import' } },
    { id: '3', cells: { kind: 'etf', symbol: 'ASX:XYZ', name: 'XYZ Example ETF', currency: 'AUD', watched: true, heldUnits: '30', targetRatio: '0.6', sector: 'Global shares', retirement: false, mgmtFeeRatio: '0.002', location: 'Australia', regionUs: '0.5', regionAsia: '0.1', regionAus: '0.3', regionOther: '0.1', dividendFreqMonths: 3, drp: true, defaultFee: 0, defaultFeeRate: null, provider: 'yahoo', providerSymbol: 'XYZ.AX', origin: 'import' } },
    { id: '7', cells: { kind: 'crypto', symbol: 'BTC', name: null, currency: 'AUD', watched: true, heldUnits: '0.05', targetRatio: '0.7', sector: null, retirement: false, mgmtFeeRatio: null, location: null, regionUs: null, regionAsia: null, regionAus: null, regionOther: null, dividendFreqMonths: null, drp: null, defaultFee: null, defaultFeeRate: '0.001', provider: 'coingecko', providerSymbol: 'bitcoin', origin: 'import' } },
  ],
  trades: [
    { id: '1', cells: { date: '2025-01-15', symbol: 'ASX:ABC', kind: 'stock', units: '100', price: '10', orderValue: 100000, fee: 1000, feeRate: null, seq: 1, flags: [], correction: null, sheetRef: 'Stocks!A23' } },
    { id: '4', cells: { date: '2025-02-03', symbol: 'ASX:OLD', kind: 'stock', units: '-20', price: '6', orderValue: -12000, fee: 1000, feeRate: null, seq: 4, flags: [], correction: 'C1', sheetRef: 'Stocks!A26' } },
    { id: '6', cells: { date: '2025-05-20', symbol: 'ASX:DEF', kind: 'etf', units: '10', price: '50', orderValue: 50000, fee: 1000, feeRate: null, seq: 1, flags: ['out_of_order', 'price_outlier'], correction: null, sheetRef: 'ETFs!A24' } },
    { id: '8', cells: { date: '2024-11-11', symbol: 'BTC', kind: 'crypto', units: '0.05', price: '90000', orderValue: 450000, fee: 2250, feeRate: '0.005', seq: 1, flags: [], correction: null, sheetRef: 'Crypto!A17' } },
  ],
  dividends: [
    { id: '1', cells: { paymentDate: '2025-07-15', ticker: 'XYZ', symbol: 'ASX:XYZ', kind: 'etf', exDate: '2025-06-30', reinvested: false, netAmount: 12000, priceAtEx: '100', flags: [], sheetRef: 'Dividends!A4' } },
    { id: '2', cells: { paymentDate: '2025-08-15', ticker: 'ZZZ', symbol: null, kind: 'etf', exDate: null, reinvested: null, netAmount: 5000, priceAtEx: null, flags: ['unmatched_ticker'], sheetRef: 'Dividends!A5' } },
  ],
  'cash-accounts': [
    { id: '1', cells: { name: 'Example Bank – Everyday', kind: 'bank', currency: 'AUD', balance: 500000, offset: false, balanceAsOf: FIXTURE_WORKBOOK_AS_OF, sheetRef: 'Cash!A2' } },
    { id: '3', cells: { name: 'Example Bank – Offset', kind: 'bank', currency: 'AUD', balance: 1000000, offset: true, balanceAsOf: FIXTURE_WORKBOOK_AS_OF, sheetRef: 'Cash!A4' } },
    { id: '4', cells: { name: 'Example Card', kind: 'bank', currency: 'AUD', balance: -25000, offset: false, balanceAsOf: null, sheetRef: 'Cash!A5' } },
  ],
  'budget-items': [
    { id: '1', cells: { name: 'Rent', kind: 'item', monthly: 200000, category: 'Housing', account: 'Example Bank – Everyday', linkedAccount: 'Example Bank – Everyday', flags: [] } },
    { id: '3', cells: { name: 'Phone', kind: 'item', monthly: 5000, category: 'Bills', account: 'Example Bank – Old', linkedAccount: null, flags: ['unmatched_account'] } },
    { id: '4', cells: { name: 'Yearly Expenses - Automatic', kind: 'auto_yearly', monthly: null, category: null, account: null, linkedAccount: null, flags: [] } },
  ],
  'yearly-expenses': [
    { id: '1', cells: { name: 'Car registration', annual: 80000 } },
    { id: '2', cells: { name: 'Insurance', annual: 120000 } },
  ],
  'income-streams': [
    { id: '1', cells: { name: 'Side income 1', archived: false } },
    { id: '2', cells: { name: 'Side income 2', archived: false } },
  ],
  'side-income': [
    { id: '3', cells: { date: '2026-09-10', stream: 'Side income 1', amount: 20000, note: 'Consulting', sheetRef: null } },
    { id: '2', cells: { date: '2026-07-31', stream: 'Side income 1', amount: 75000, note: null, sheetRef: 'Side Income!G3' } },
    { id: '1', cells: { date: '2026-06-30', stream: 'Side income 2', amount: -5000, note: null, sheetRef: 'Side Income!H2' } },
  ],
  'period-notes': [
    { id: '1', cells: { period: '2026-07', kind: 'spend', note: 'Car service' } },
    { id: '2', cells: { period: '2026-06', kind: 'super_option', note: 'Switched to the balanced option' } },
  ],
  snapshots: [
    { id: '3', cells: { runDate: '2026-07-31', period: '2026-07', source: 'migrated', ...snapshotValues(2) } },
    { id: '2', cells: { runDate: '2026-06-30', period: '2026-06', source: 'migrated', ...snapshotValues(1) } },
    { id: '1', cells: { runDate: '2026-05-31', period: '2026-05', source: 'migrated', ...snapshotValues(0) } },
  ],
  'other-assets': [
    { id: '1', cells: { description: 'Example watch', url: null, purchaseDate: '2023-04-01', units: '1', soldUnits: '0', currency: 'AUD', unitCost: '1500', unitPrice: '1800', priceSource: 'manual', metal: null, unitOfMeasure: 'each', value: 180000, purchaseFxRate: null, purchaseFxSource: null } },
    { id: '2', cells: { description: 'Silver bar', url: 'https://example.com/silver-bar', purchaseDate: '2024-02-01', units: '10', soldUnits: '0', currency: 'AUD', unitCost: '35', unitPrice: '46.15', priceSource: 'bullion', metal: 'silver', unitOfMeasure: 'oz', value: 46150, purchaseFxRate: null, purchaseFxSource: null } },
    { id: '3', cells: { description: 'Example print', url: null, purchaseDate: '2024-05-10', units: '1', soldUnits: '0', currency: 'USD', unitCost: '400', unitPrice: '450', priceSource: 'manual', metal: null, unitOfMeasure: 'each', value: 67500, purchaseFxRate: '1.5', purchaseFxSource: 'market' } },
  ],
  'super-funds': [
    { id: '1', cells: { name: 'Example Super', balance: 5060000, balanceAsOf: FIXTURE_WORKBOOK_AS_OF, receivesSg: true } },
  ],
  'super-entries': [
    { id: '1', cells: { period: '2026-09', kind: 'voluntary_contribution', fund: null, amount: 20000, date: '2026-09-24' } },
    { id: '2', cells: { period: '2026-09', kind: 'reported_gain', fund: 'Example Super', amount: 10000, date: null } },
    { id: '3', cells: { period: '2026-09', kind: 'salary_sacrifice', fund: 'Example Super', amount: 50000, date: '2026-09-15' } },
  ],
  properties: [
    { id: '1', cells: { name: 'Example property', purchaseDate: '2020-03-15', primaryResidence: true, purchaseValue: 50000000, currentValue: 60000000, netRent: 0 } },
  ],
  loans: [
    { id: '1', cells: { name: 'Example property mortgage', property: 'Example property', startDate: '2020-03-15', annualRate: '0.06', periodsPerYear: 12, payment: 250000, startBalance: 45000000, currentBalance: 39800000, paymentsPaid: 5200000, paymentsPaidDerived: true } },
    { id: '2', cells: { name: 'Example car loan', property: null, startDate: '2024-01-10', annualRate: '0.08', periodsPerYear: 12, payment: 50000, startBalance: 2000000, currentBalance: 1500000, paymentsPaid: null, paymentsPaidDerived: false } },
  ],
  settings: [
    { id: 'allocation.etf', valueType: 'ratio', cells: { key: 'allocation.etf', label: 'Target allocation: ETFs', category: 'allocation', value: '0.6', updatedAt: FIXTURE_NOW } },
    { id: 'crypto.feeRate', valueType: 'ratio', cells: { key: 'crypto.feeRate', label: 'Crypto fee', category: 'crypto', value: '0.005', updatedAt: FIXTURE_NOW } },
    { id: 'features.cash', valueType: 'boolean', cells: { key: 'features.cash', label: 'Feature: cash', category: 'features', value: true, updatedAt: FIXTURE_NOW } },
    { id: 'pay.dayOfMonth', valueType: 'integer', cells: { key: 'pay.dayOfMonth', label: 'Day of month paid', category: 'pay', value: 15, updatedAt: FIXTURE_NOW } },
    { id: 'pay.frequency', valueType: 'enum', cells: { key: 'pay.frequency', label: 'Pay frequency', category: 'pay', value: 'fortnightly', updatedAt: FIXTURE_NOW } },
    { id: 'pay.jobStartDate', valueType: 'date', cells: { key: 'pay.jobStartDate', label: 'Job start date', category: 'pay', value: '2020-01-06', updatedAt: FIXTURE_NOW } },
    { id: 'pay.netPayCents', valueType: 'money', cells: { key: 'pay.netPayCents', label: 'Net pay per pay', category: 'pay', value: 300000, updatedAt: FIXTURE_NOW } },
  ],
  // Stage 3 (stage-3.md §3.2).
  'cash-balance-entries': [
    { id: '5', cells: { account: 'Example Bank – Everyday', asOf: '2026-09-20', balance: 520000, note: 'After rent', sheetRef: null } },
    { id: '1', cells: { account: 'Example Bank – Everyday', asOf: FIXTURE_WORKBOOK_AS_OF, balance: 500000, note: null, sheetRef: 'Cash!A2' } },
    { id: '2', cells: { account: 'Example Card', asOf: FIXTURE_WORKBOOK_AS_OF, balance: -25000, note: null, sheetRef: 'Cash!A5' } },
  ],
  'savings-adjustments': [
    { id: '1', cells: { period: '2026-07', amount: 1000000, note: 'Car sold' } },
    { id: '2', cells: { period: '2026-06', amount: -200000, note: 'Loan to a friend' } },
  ],
  'savings-goals': [
    { id: '1', cells: { name: 'Emergency buffer', target: 1000000, targetDate: null, sortOrder: 1, note: null } },
    { id: '2', cells: { name: 'Holiday', target: 500000, targetDate: '2027-06-30', sortOrder: 2, note: 'Two weeks away' } },
  ],
  'dividend-events': [
    { id: '4:2026-09-01', cells: { symbol: 'ASX:DEF', exDate: '2026-09-01', amountPerUnit: '0.45', currency: 'AUD', closeBeforeEx: '52.1', closeDate: '2026-08-31', source: 'fake', fetchedAt: FIXTURE_NOW, dismissed: false } },
    { id: '3:2026-06-30', cells: { symbol: 'ASX:XYZ', exDate: '2026-06-30', amountPerUnit: '1.2', currency: 'AUD', closeBeforeEx: null, closeDate: null, source: 'yahoo', fetchedAt: FIXTURE_NOW, dismissed: true } },
  ],
  // Stage 4 (stage-4.md §3.2).
  'other-asset-prices': [
    { id: '3', cells: { asset: 'Example print', asOf: '2026-09-01', unitPrice: '450', currency: 'USD', note: null, sheetRef: null } },
    { id: '1', cells: { asset: 'Example watch', asOf: FIXTURE_WORKBOOK_AS_OF, unitPrice: '1800', currency: 'AUD', note: null, sheetRef: 'Other Assets!F3' } },
    { id: '2', cells: { asset: 'Example watch', asOf: '2026-03-31', unitPrice: '1700', currency: 'AUD', note: 'Dealer quote', sheetRef: null } },
  ],
  'other-asset-sales': [
    { id: '1', cells: { asset: 'Silver bar', date: '2026-07-15', units: '2', proceeds: 9000, note: 'Sold to a dealer' } },
  ],
  'super-balance-entries': [
    { id: '2', cells: { fund: 'Example Super', asOf: FIXTURE_WORKBOOK_AS_OF, balance: 5060000, transferIn: null, note: null, sheetRef: 'Super!A2' } },
    { id: '1', cells: { fund: 'Example Super', asOf: '2026-06-30', balance: 4900000, transferIn: null, note: 'Statement', sheetRef: null } },
  ],
  'super-sg-overrides': [
    { id: '1', cells: { period: '2026-08', gross: 90000, note: 'From the payslip' } },
  ],
  'property-valuations': [
    { id: '2', cells: { property: 'Example property', asOf: FIXTURE_WORKBOOK_AS_OF, value: 60000000, note: null, sheetRef: 'Property!D19' } },
    { id: '1', cells: { property: 'Example property', asOf: '2025-08-31', value: 58000000, note: 'Bank valuation', sheetRef: null } },
  ],
  'loan-balance-entries': [
    { id: '2', cells: { loan: 'Example property mortgage', asOf: FIXTURE_WORKBOOK_AS_OF, balance: 39800000, repayments: null, note: null, sheetRef: 'Property!D29' } },
    { id: '1', cells: { loan: 'Example property mortgage', asOf: '2026-02-28', balance: 40400000, repayments: 1500000, note: 'From the statement', sheetRef: null } },
  ],
  'loan-offset-links': [
    { id: '5', cells: { account: 'Offset account', loan: 'Example property mortgage' } },
  ],
};

function summaryOf(id: RecordEntityId, count: number): RecordEntitySummary {
  const meta = RECORD_ENTITIES[id];
  return { id, label: meta.label, group: meta.group, count };
}

/** One page per entity, rows as the server would send them (registry columns). */
export const recordsPages: Readonly<Record<RecordEntityId, RecordsPageResponse>> =
  Object.fromEntries(
    RECORD_ENTITY_IDS.map((id) => [
      id,
      {
        entity: summaryOf(id, RECORD_ROWS[id].length),
        columns: RECORD_ENTITIES[id].columns,
        rows: RECORD_ROWS[id],
      } satisfies RecordsPageResponse,
    ]),
  ) as Record<RecordEntityId, RecordsPageResponse>;

/** An entity with no rows. */
export const recordsPageEmpty = {
  entity: summaryOf('trades', 0),
  columns: RECORD_ENTITIES.trades.columns,
  rows: [],
} satisfies RecordsPageResponse;

/** Populated index (counts match `recordsPages`). */
export const recordsIndex = {
  entities: RECORD_ENTITY_IDS.map((id) => summaryOf(id, RECORD_ROWS[id].length)),
} satisfies RecordsIndexResponse;

/** Nothing imported yet: every count is 0. */
export const recordsIndexEmpty = {
  entities: RECORD_ENTITY_IDS.map((id) => summaryOf(id, 0)),
} satisfies RecordsIndexResponse;

// ─── Import ──────────────────────────────────────────────────────────────────────────────────────

/** Checks of every CheckStatus and every unit, across several sections. */
// prettier-ignore
const REPORT_CHECKS: ReconciliationCheck[] = [
  { id: 'workbook.template', section: 'workbook', label: 'Template version', sheetRef: 'Net Worth!C46', unit: 'text', expected: '2.15.4', actual: '2.15.4', diff: null, status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'workbook.asOf', section: 'workbook', label: 'Workbook as-of date', sheetRef: 'Net Worth!E52', unit: 'date', expected: FIXTURE_WORKBOOK_AS_OF, actual: FIXTURE_WORKBOOK_AS_OF, diff: null, status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'counts.trades.stock', section: 'counts', label: 'Stock trades', sheetRef: 'Stocks!A22', unit: 'count', expected: 4, actual: 4, diff: 0, status: 'match', reasonCode: null, reason: null, refs: { entity: 'trades' } },
  { id: 'counts.instruments.managed_fund', section: 'counts', label: 'Managed fund instruments', sheetRef: 'Managed Funds!A1', unit: 'count', expected: 4, actual: 2, diff: -2, status: 'explained', reasonCode: 'exclusion_d23', reason: 'Excluded feed rows: exclusion_d23 × 2', refs: { entity: 'instruments', decision: 'D23' } },
  { id: 'holdings.units.stock.ASX:ABC', section: 'holdings', label: 'ASX:ABC units', sheetRef: 'Stocks!G2', unit: 'units', expected: '150', actual: '150', diff: '0', status: 'match', reasonCode: null, reason: null, refs: { entity: 'instruments', recordId: 1 } },
  { id: 'holdings.units.etf.ASX:XYZ', section: 'holdings', label: 'ASX:XYZ units', sheetRef: 'ETFs!F2', unit: 'units', expected: '30', actual: '29.5', diff: '-0.5', status: 'unexplained', reasonCode: null, reason: 'Units differ from the ledger', refs: { entity: 'instruments', recordId: 3 } },
  { id: 'holdings.value.etf', section: 'holdings', label: 'ETF value', sheetRef: 'ETFs!F15', unit: 'cents', expected: 0, actual: 315000, diff: 315000, status: 'explained', reasonCode: 'sheet_error_value', reason: 'A held row has an error price in the sheet; priced by the price service', refs: null },
  { id: 'holdings.gain.stock', section: 'holdings', label: 'Stocks gain', sheetRef: 'Stocks!E17', unit: 'cents', expected: 10000, actual: null, diff: null, status: 'info', reasonCode: 'derived_later_stage', reason: 'Gains need the Stage 2 FIFO engine', refs: null },
  { id: 'ledgers.orderValue.stock', section: 'ledgers', label: 'Stock order value', sheetRef: 'Stocks!G22', unit: 'cents', expected: 208000, actual: 208001, diff: 1, status: 'match', reasonCode: 'rounding', reason: 'Within rounding tolerance', refs: null },
  { id: 'movements.2026-07.etf', section: 'movements', label: 'ETF movements Jul 2026', sheetRef: 'History!I5', unit: 'cents', expected: 0, actual: 0, diff: 0, status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'dividends.link.5', section: 'dividends', label: 'Dividend ticker ZZZ', sheetRef: 'Dividends!A5', unit: 'text', expected: 'ZZZ', actual: null, diff: null, status: 'suspect', reasonCode: 'unmatched_dividend', reason: 'No instrument matches this ticker', refs: { entity: 'dividends', recordId: 2, flags: ['unmatched_ticker'] } },
  { id: 'dividends.link.4', section: 'dividends', label: 'Dividend ticker XYZ', sheetRef: 'Dividends!A4', unit: 'text', expected: 'XYZ', actual: 'ASX:XYZ', diff: null, status: 'explained', reasonCode: 'dividend_rekeyed', reason: 'Linked by code', refs: { entity: 'dividends', recordId: 1, decision: 'D28' } },
  { id: 'cash.total', section: 'cash', label: 'Cash total', sheetRef: 'Cash!C13', unit: 'cents', expected: 2475000, actual: 2475000, diff: 0, status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'snapshots.values.2026-07', section: 'snapshots', label: 'History Jul 2026', sheetRef: 'History!A5', unit: 'none', expected: null, actual: null, diff: null, status: 'match', reasonCode: null, reason: null, refs: { entity: 'snapshots', recordId: 3 } },
  { id: 'snapshots.period.2026-06', section: 'snapshots', label: 'Duplicate month Jun 2026', sheetRef: 'History!A7', unit: 'date', expected: '2026-06-15', actual: '2026-06-30', diff: null, status: 'unexplained', reasonCode: null, reason: 'Two frozen rows in one month; the later run date was kept', refs: null },
  { id: 'netWorth.rolling.2026-07.assets', section: 'net_worth', label: 'Rolling assets Jul 2026', sheetRef: 'Net Worth!L10', unit: 'cents', expected: 4000000, actual: 4000000, diff: 0, status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'settings.sheetOptions.1', section: 'settings', label: 'Personal Gmail', sheetRef: 'SheetOptions!L3', unit: 'none', expected: null, actual: null, diff: null, status: 'explained', reasonCode: 'secret_not_imported', reason: 'Personal contact detail; not imported', refs: { decision: 'D24' } },
  { id: 'settings.sheetOptions.25', section: 'settings', label: 'Market Investment Return', sheetRef: 'SheetOptions!L27', unit: 'ratio', expected: '0.07', actual: '0.07', diff: '0', status: 'match', reasonCode: null, reason: null, refs: null },
  { id: 'settings.budget.emergencyFundOverrideCents', section: 'settings', label: 'Emergency fund override', sheetRef: 'Budget!D3', unit: 'none', expected: null, actual: null, diff: null, status: 'info', reasonCode: 'formula_default', reason: 'Default formula; no override', refs: null },
  { id: 'exclusions.Managed Funds!A8', section: 'exclusions', label: 'Silver futures feed row', sheetRef: 'Managed Funds!A8', unit: 'cents', expected: 4615, actual: null, diff: null, status: 'explained', reasonCode: 'exclusion_d23', reason: 'Bullion feed row; bullion is priced from built-in series', refs: { decision: 'D23' } },
  { id: 'corrections.C1', section: 'corrections', label: 'Correction C1', sheetRef: 'Stocks!A26', unit: 'date', expected: '2025-03-02', actual: '2025-02-03', diff: null, status: 'explained', reasonCode: 'correction', reason: 'Owner-confirmed day/month swap', refs: { correctionId: 'C1', entity: 'trades', recordId: 4 } },
  { id: 'suspects.trades.ETFs!A24', section: 'suspects', label: 'ASX:DEF trade 20/05/2025', sheetRef: 'ETFs!A24', unit: 'none', expected: null, actual: null, diff: null, status: 'suspect', reasonCode: 'suspect_row', reason: 'Out of order; price outlier', refs: { entity: 'trades', recordId: 6, flags: ['out_of_order', 'price_outlier'] } },
  { id: 'budget.skipped.Budget!A15', section: 'budget', label: 'Unnamed budget row', sheetRef: 'Budget!A15', unit: 'none', expected: null, actual: null, diff: null, status: 'info', reasonCode: 'unnamed_row', reason: 'Row has a category but no name', refs: null },
];

function countStatuses(checks: readonly ReconciliationCheck[]): Record<CheckStatus, number> {
  const t: Record<CheckStatus, number> = {
    match: 0,
    explained: 0,
    unexplained: 0,
    suspect: 0,
    info: 0,
  };
  for (const c of checks) t[c.status] += 1;
  return t;
}

/** The committed run's report: every status, every unit, several sections. */
// prettier-ignore
export const sampleReport = {
  version: 1,
  generatedAt: '2026-09-24T03:00:01.000Z',
  workbook: { fileName: 'example-workbook.xlsx', sha256: SHA_A, sizeBytes: 1850000, asOf: FIXTURE_WORKBOOK_AS_OF, templateVersion: '2.15.4' },
  corrections: { name: 'import-corrections.json', sha256: SHA_B, entries: 1, applied: 1 },
  counts: { instruments: 8, trades: 9, dividends: 2, 'cash-accounts': 3, 'budget-items': 6, 'yearly-expenses': 2, 'income-streams': 2, 'side-income': 3, 'period-notes': 3, snapshots: 3, 'other-assets': 2, 'super-funds': 1, 'super-entries': 2, properties: 1, loans: 2, settings: 7 },
  totals: countStatuses(REPORT_CHECKS),
  checks: REPORT_CHECKS,
} satisfies ReconciliationReport;

/** A clean dry-run report (0 unexplained). */
export const sampleDryRunReport = {
  ...sampleReport,
  generatedAt: '2026-09-24T02:00:01.000Z',
  totals: countStatuses(REPORT_CHECKS.filter((c) => c.status !== 'unexplained')),
  checks: REPORT_CHECKS.filter((c) => c.status !== 'unexplained'),
} satisfies ReconciliationReport;

const runBase = {
  trigger: 'upload',
  fileName: 'example-workbook.xlsx',
  fileSha256: SHA_A,
  fileSizeBytes: 1850000,
  correctionsName: 'import-corrections.json',
} as const;

/** Run 4: in progress. */
export const importRunRunning = {
  ...runBase,
  id: 4,
  startedAt: '2026-09-24T04:31:00.000Z',
  finishedAt: null,
  status: 'running',
  dryRun: false,
  workbookAsOf: null,
  totals: null,
  error: null,
  report: null,
} satisfies ImportRunDetail;

/** Run 3: committed, with unexplained and suspect checks. */
export const importRunSucceeded = {
  ...runBase,
  id: 3,
  startedAt: '2026-09-24T03:00:00.000Z',
  finishedAt: '2026-09-24T03:00:01.000Z',
  status: 'succeeded',
  dryRun: false,
  workbookAsOf: FIXTURE_WORKBOOK_AS_OF,
  totals: sampleReport.totals,
  error: null,
  report: sampleReport,
} satisfies ImportRunDetail;

/** Run 2: a dry run (preview), clean. */
export const importRunDryRun = {
  ...runBase,
  id: 2,
  trigger: 'cli',
  startedAt: '2026-09-24T02:00:00.000Z',
  finishedAt: '2026-09-24T02:00:01.000Z',
  status: 'succeeded',
  dryRun: true,
  workbookAsOf: FIXTURE_WORKBOOK_AS_OF,
  totals: sampleDryRunReport.totals,
  error: null,
  report: sampleDryRunReport,
} satisfies ImportRunDetail;

/** Run 1: failed (not a workbook). */
export const importRunFailed = {
  ...runBase,
  id: 1,
  fileName: 'notes.xlsx',
  fileSha256: SHA_B,
  fileSizeBytes: 2048,
  correctionsName: null,
  startedAt: '2026-09-23T22:15:00.000Z',
  finishedAt: '2026-09-23T22:15:00.200Z',
  status: 'failed',
  dryRun: false,
  workbookAsOf: null,
  totals: null,
  error: { code: 'INVALID_WORKBOOK', message: 'Missing required sheet "History"' },
  report: null,
} satisfies ImportRunDetail;

/** Run details by id. */
export const importRunDetails: Readonly<Record<number, ImportRunDetail>> = {
  1: importRunFailed,
  2: importRunDryRun,
  3: importRunSucceeded,
  4: importRunRunning,
};

function summaryOfRun(run: ImportRunDetail): ImportRunSummary {
  const { report, ...summary } = run;
  void report;
  return summary;
}

/** No runs, nothing imported. */
export const importRunsEmpty = {
  runs: [],
  hasImportedData: false,
  hasAppData: false,
  inProgress: false,
} satisfies ImportRunsResponse;

/** Newest first: committed, dry run, failed. */
export const importRunsPopulated = {
  runs: [importRunSucceeded, importRunDryRun, importRunFailed].map(summaryOfRun),
  hasImportedData: true,
  hasAppData: false,
  inProgress: false,
} satisfies ImportRunsResponse;

/** An import is running (newest first). */
export const importRunsInProgress = {
  runs: [importRunRunning, importRunSucceeded, importRunDryRun, importRunFailed].map(summaryOfRun),
  hasImportedData: true,
  hasAppData: false,
  inProgress: true,
} satisfies ImportRunsResponse;

/** Imported data plus app-entered rows: a non-dry-run upload is refused (D34). */
export const importRunsWithAppData = {
  runs: [importRunSucceeded, importRunDryRun, importRunFailed].map(summaryOfRun),
  hasImportedData: true,
  hasAppData: true,
  inProgress: false,
} satisfies ImportRunsResponse;

// ─── Prices ──────────────────────────────────────────────────────────────────────────────────────

const noFetch = { fetched: null, lastAttemptAt: null, lastError: null, consecutiveFailures: 0 };

/** One item per PriceStatus (plus variants): held first, then kind order, then sort order. */
// prettier-ignore
export const priceItems = [
  {
    instrumentId: 1, kind: 'stock', symbol: 'ASX:ABC', name: 'ABC Example Ltd', watched: true, held: true, heldUnits: '150',
    provider: 'yahoo', providerSymbol: 'ABC.AX', symbolOrigin: 'derived', status: 'fresh', price: '12.5', priceSource: 'yahoo', asOf: '2026-09-24T04:00:00.000Z',
    fetched: { price: '12.5', nativePrice: '12.5', nativeCurrency: 'AUD', fxRate: '1', asOf: '2026-09-24T04:00:00.000Z', fetchedAt: '2026-09-24T04:01:00.000Z', source: 'yahoo' },
    manual: null, lastAttemptAt: '2026-09-24T04:01:00.000Z', lastError: null, consecutiveFailures: 0,
  },
  {
    instrumentId: 3, kind: 'etf', symbol: 'ASX:XYZ', name: 'XYZ Example ETF', watched: true, held: true, heldUnits: '30',
    provider: 'yahoo', providerSymbol: 'XYZ.AX', symbolOrigin: 'derived', status: 'stale', price: '105', priceSource: 'sheet', asOf: `${FIXTURE_WORKBOOK_AS_OF}T00:00:00.000Z`,
    fetched: { price: '105', nativePrice: null, nativeCurrency: null, fxRate: null, asOf: `${FIXTURE_WORKBOOK_AS_OF}T00:00:00.000Z`, fetchedAt: '2026-09-24T03:00:01.000Z', source: 'sheet' },
    manual: null, lastAttemptAt: null, lastError: null, consecutiveFailures: 0,
  },
  {
    instrumentId: 4, kind: 'etf', symbol: 'ASX:DEF', name: 'DEF Example ETF', watched: true, held: true, heldUnits: '10',
    provider: 'yahoo', providerSymbol: 'DEF.AX', symbolOrigin: 'user', status: 'failed', price: null, priceSource: null, asOf: null,
    fetched: null, manual: null, lastAttemptAt: '2026-09-24T04:01:00.000Z', lastError: 'Symbol not found', consecutiveFailures: 3,
  },
  {
    instrumentId: 9, kind: 'etf', symbol: 'NYSE:DEF', name: 'DEF Example US ETF', watched: true, held: true, heldUnits: '5',
    provider: 'yahoo', providerSymbol: 'DEF', symbolOrigin: 'derived', status: 'failed', price: '75', priceSource: 'yahoo', asOf: '2026-09-21T20:00:00.000Z',
    fetched: { price: '75', nativePrice: '48.75', nativeCurrency: 'USD', fxRate: '1.538461538462', asOf: '2026-09-21T20:00:00.000Z', fetchedAt: '2026-09-22T04:01:00.000Z', source: 'yahoo' },
    manual: null, lastAttemptAt: '2026-09-24T04:01:00.000Z', lastError: 'Request timed out', consecutiveFailures: 1,
  },
  {
    instrumentId: 5, kind: 'managed_fund', symbol: 'EXAMPLEFUND', name: 'Example Managed Fund', watched: true, held: true, heldUnits: '1000',
    provider: 'none', providerSymbol: null, symbolOrigin: 'derived', status: 'manual', price: '1.5', priceSource: 'manual', asOf: '2026-09-21',
    manual: { price: '1.5', asOf: '2026-09-21', note: 'Unit price from the fund statement', origin: 'import' }, ...noFetch,
  },
  {
    instrumentId: 7, kind: 'crypto', symbol: 'BTC', name: null, watched: true, held: true, heldUnits: '0.05',
    provider: 'coingecko', providerSymbol: 'bitcoin', symbolOrigin: 'derived', status: 'fresh', price: '100000', priceSource: 'coingecko', asOf: '2026-09-24T04:10:00.000Z',
    fetched: { price: '100000', nativePrice: '100000', nativeCurrency: 'AUD', fxRate: '1', asOf: '2026-09-24T04:10:00.000Z', fetchedAt: '2026-09-24T04:11:00.000Z', source: 'coingecko' },
    manual: null, lastAttemptAt: '2026-09-24T04:11:00.000Z', lastError: null, consecutiveFailures: 0,
  },
  {
    instrumentId: 8, kind: 'crypto', symbol: 'ETH', name: null, watched: true, held: true, heldUnits: '1.25',
    provider: 'coingecko', providerSymbol: 'ethereum', symbolOrigin: 'search', status: 'stale', price: '4000', priceSource: 'coingecko', asOf: '2026-09-22T04:10:00.000Z',
    fetched: { price: '4000', nativePrice: '4000', nativeCurrency: 'AUD', fxRate: '1', asOf: '2026-09-22T04:10:00.000Z', fetchedAt: '2026-09-22T04:11:00.000Z', source: 'coingecko' },
    manual: null, lastAttemptAt: '2026-09-22T04:11:00.000Z', lastError: null, consecutiveFailures: 0,
  },
  {
    instrumentId: 2, kind: 'stock', symbol: 'ASX:OLD', name: null, watched: false, held: false, heldUnits: '0',
    provider: 'yahoo', providerSymbol: 'OLD.AX', symbolOrigin: 'derived', status: 'none', price: null, priceSource: null, asOf: null,
    manual: null, ...noFetch,
  },
  {
    instrumentId: 6, kind: 'managed_fund', symbol: 'EXAMPLEFUND2', name: 'Example Managed Fund 2', watched: true, held: false, heldUnits: '0',
    provider: 'none', providerSymbol: null, symbolOrigin: 'derived', status: 'none', price: null, priceSource: null, asOf: null,
    manual: null, ...noFetch,
  },
  {
    instrumentId: 10, kind: 'managed_fund', symbol: 'EXAMPLEFUND3', name: 'Example Managed Fund 3', watched: true, held: false, heldUnits: '0',
    provider: 'none', providerSymbol: null, symbolOrigin: 'derived', status: 'stale', price: '2', priceSource: 'manual', asOf: '2026-07-01',
    manual: { price: '2', asOf: '2026-07-01', note: null, origin: 'user' }, ...noFetch,
  },
] satisfies PriceItem[];

/** The same items as the fake provider would return them (mode `fake`). */
const fakePriceItems: PriceItem[] = priceItems.map((item) =>
  item.fetched && item.fetched.source !== 'sheet'
    ? { ...item, priceSource: 'fake', fetched: { ...item.fetched, source: 'fake' } }
    : item,
);

/** The built-in series: fresh, derived, stale and failed. */
// prettier-ignore
export const marketSeries = [
  { seriesId: 'AUDUSD', label: 'AUD/USD', value: '0.65', unit: 'USD per AUD', asOf: '2026-09-24T04:00:00.000Z', fetchedAt: '2026-09-24T04:01:00.000Z', source: 'yahoo', status: 'fresh', lastError: null },
  { seriesId: 'SI_USD_OZ', label: 'Silver (USD/oz)', value: '30', unit: 'USD per oz', asOf: '2026-09-24T04:00:00.000Z', fetchedAt: '2026-09-24T04:01:00.000Z', source: 'yahoo', status: 'fresh', lastError: null },
  { seriesId: 'GC_USD_OZ', label: 'Gold (USD/oz)', value: '2600', unit: 'USD per oz', asOf: '2026-09-22T20:00:00.000Z', fetchedAt: '2026-09-23T04:01:00.000Z', source: 'yahoo', status: 'failed', lastError: 'Rate limited' },
  { seriesId: 'XAG_AUD_OZ', label: 'Silver (AUD/oz)', value: '46.153846153846', unit: 'AUD per oz', asOf: '2026-09-24T04:00:00.000Z', fetchedAt: '2026-09-24T04:01:00.000Z', source: 'derived', status: 'fresh', lastError: null },
  { seriesId: 'XAU_AUD_OZ', label: 'Gold (AUD/oz)', value: '4000', unit: 'AUD per oz', asOf: '2026-09-22T20:00:00.000Z', fetchedAt: '2026-09-24T04:01:00.000Z', source: 'derived', status: 'stale', lastError: null },
] satisfies MarketQuoteItem[];

/** Nothing fetched yet. */
export const marketSeriesEmpty: MarketQuoteItem[] = marketSeries.map((s) => ({
  ...s,
  value: null,
  asOf: null,
  fetchedAt: null,
  source: null,
  status: 'none',
  lastError: null,
}));

export const lastPriceRun = {
  id: 12,
  job: 'prices',
  trigger: 'schedule',
  startedAt: '2026-09-24T04:00:55.000Z',
  finishedAt: '2026-09-24T04:01:10.000Z',
  status: 'partial',
  detail: { requested: 8, ok: 6, failed: 2, skipped: 0 },
  error: null,
} satisfies JobRunSummary;

/** Mode `live`, idle, with a last run and a next scheduled run. */
export const pricesLive = {
  mode: 'live',
  refreshIntervalMinutes: 60,
  running: false,
  lastRun: lastPriceRun,
  nextRefreshAt: '2026-09-24T05:01:10.000Z',
  items: priceItems,
  series: marketSeries,
} satisfies PricesResponse;

/** Mode `live` while a refresh runs. */
export const pricesRunning = { ...pricesLive, running: true } satisfies PricesResponse;

/** Mode `fake` (e2e, demos): "Test prices", timer off. */
export const pricesFake = {
  mode: 'fake',
  refreshIntervalMinutes: 0,
  running: false,
  lastRun: { ...lastPriceRun, trigger: 'manual', status: 'succeeded' },
  nextRefreshAt: null,
  items: fakePriceItems,
  series: marketSeries,
} satisfies PricesResponse;

/** Mode `off`: no fetching; refresh is unavailable. */
export const pricesOff = {
  mode: 'off',
  refreshIntervalMinutes: 0,
  running: false,
  lastRun: null,
  nextRefreshAt: null,
  items: priceItems,
  series: marketSeriesEmpty,
} satisfies PricesResponse;

/** An empty database: no instruments, no series values, never refreshed. */
export const pricesEmpty = {
  mode: 'live',
  refreshIntervalMinutes: 60,
  running: false,
  lastRun: null,
  nextRefreshAt: '2026-09-24T04:33:00.000Z',
  items: [],
  series: marketSeriesEmpty,
} satisfies PricesResponse;

export const pricesByMode: Readonly<Record<MarketDataMode, PricesResponse>> = {
  live: pricesLive,
  fake: pricesFake,
  off: pricesOff,
};

/** `POST /api/prices/refresh` result: "Refreshed 6 prices; 2 failed." */
export const refreshResponse = {
  summary: { jobRunId: 12, requested: 8, ok: 6, failed: 2, skipped: 0, durationMs: 15000 },
  prices: pricesLive,
} satisfies RefreshResponse;

export const marketSeriesResponse = { series: marketSeries } satisfies MarketSeriesResponse;

/** A manual price just set (the `PUT …/manual` response). */
export const priceItemManualSet = {
  ...(priceItems[0] as PriceItem),
  status: 'manual',
  price: '13',
  priceSource: 'manual',
  asOf: '2026-09-24',
  manual: { price: '13', asOf: '2026-09-24', note: 'Broker quote', origin: 'user' },
} satisfies PriceItem;

// ─── Status ──────────────────────────────────────────────────────────────────────────────────────

/** An empty database: "No prices yet · No snapshots yet". */
export const appStatusEmpty = {
  prices: { mode: 'live', lastRefreshAt: null, running: false },
  snapshots: { count: 0, latestPeriod: null },
  import: { lastRunAt: null, lastStatus: null, hasImportedData: false },
} satisfies AppStatus;

/** Imported data, prices refreshed today, snapshots up to Aug 2026. */
export const appStatusPopulated = {
  prices: { mode: 'live', lastRefreshAt: '2026-09-24T04:01:10.000Z', running: false },
  snapshots: { count: 3, latestPeriod: '2026-08' },
  import: {
    lastRunAt: '2026-09-24T03:00:00.000Z',
    lastStatus: 'succeeded' satisfies RunStatus,
    hasImportedData: true,
  },
} satisfies AppStatus;

// ─── Errors ──────────────────────────────────────────────────────────────────────────────────────

/** Error bodies the pages show. */
// prettier-ignore
export const apiErrors = {
  confirmRequired: { error: { code: 'IMPORT_CONFIRM_REQUIRED', message: 'Imported data exists; confirm to replace it' } },
  inProgress: { error: { code: 'IMPORT_IN_PROGRESS', message: 'An import is already running' } },
  appDataExists: { error: { code: 'IMPORT_APP_DATA_EXISTS', message: 'This app holds data entered in the app; an import would replace it. Import from the command line with --yes --replace-app-data to override.' } },
  invalidWorkbook: { error: { code: 'INVALID_WORKBOOK', message: 'Missing required sheet "History"' } },
  invalidCorrections: { error: { code: 'INVALID_CORRECTIONS', message: 'The corrections file is not valid' } },
  tooLarge: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } },
  validation: { error: { code: 'VALIDATION_ERROR', message: 'price: must be greater than zero' } },
  marketDataDisabled: { error: { code: 'MARKET_DATA_DISABLED', message: 'Market data is switched off' } },
  notFound: { error: { code: 'NOT_FOUND', message: 'No instrument 999' } },
  internal: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } },
  // Stage 2 (stage-2.md §4.1, §4.3)
  tradeOversell: { error: { code: 'TRADE_OVERSELL', message: 'The sell on 15/11/2025 is for 20 units but only 12 are held then.' } },
  instrumentExists: { error: { code: 'INSTRUMENT_EXISTS', message: 'An ETF with the symbol ASX:DEF already exists' } },
  instrumentInUse: { error: { code: 'INSTRUMENT_IN_USE', message: 'This holding has trades or dividends, so it cannot be deleted' } },
  tradeValidation: { error: { code: 'VALIDATION_ERROR', message: 'quantity.units: must be a positive number; price: must be greater than zero' } },
  // Stage 3 (stage-3.md §4.1, §4.3)
  accountInUse: { error: { code: 'ACCOUNT_IN_USE', message: 'This account is used by 2 budget rows; move them first' } },
  streamInUse: { error: { code: 'STREAM_IN_USE', message: 'This stream has 3 deposits' } },
  lastBalanceEntry: { error: { code: 'LAST_BALANCE_ENTRY', message: 'An account keeps at least one balance' } },
  cashValidation: { error: { code: 'VALIDATION_ERROR', message: 'asOf: must not be after tomorrow; entries: an account appears twice' } },
  dividendValidation: { error: { code: 'VALIDATION_ERROR', message: 'exDate: after the payment date; netAmountCents: must not be zero' } },
  // Stage 4 (stage-4.md §4.1, §4.3)
  fundInUse: { error: { code: 'FUND_IN_USE', message: 'This fund has 2 contributions; move or delete them first' } },
  propertyHasLoan: { error: { code: 'PROPERTY_HAS_LOAN', message: 'This property has 1 loans; delete them first' } },
  saleOversell: { error: { code: 'SALE_OVERSELL', message: 'Only 2 units are left to sell' } },
  assetsValidation: { error: { code: 'VALIDATION_ERROR', message: 'currency: bullion is priced in AUD; entries: an asset appears twice' } },
} satisfies Record<string, ApiErrorBody>;
