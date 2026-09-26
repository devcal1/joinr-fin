// The record-browser registry (stage-1.md §2.6, frozen): the entities the read-only data browser
// lists, their groups and their columns. Plain data, shared by the server and the web.

export const RECORD_ENTITY_IDS = [
  'instruments',
  'trades',
  'dividends',
  'cash-accounts',
  'budget-items',
  'yearly-expenses',
  'income-streams',
  'side-income',
  'period-notes',
  'snapshots',
  'other-assets',
  'super-funds',
  'super-entries',
  'properties',
  'loans',
  'settings',
  // Stage 3 (stage-3.md §3.2).
  'cash-balance-entries',
  'savings-adjustments',
  'savings-goals',
  'dividend-events',
  // Stage 4 (stage-4.md §3.2).
  'other-asset-prices',
  'other-asset-sales',
  'super-balance-entries',
  'super-sg-overrides',
  'property-valuations',
  'loan-balance-entries',
  'loan-offset-links',
] as const;
export type RecordEntityId = (typeof RECORD_ENTITY_IDS)[number];

export type RecordGroupId = 'investments' | 'cashflow' | 'assets' | 'history' | 'settings';
export type RecordColumnType =
  | 'text'
  | 'integer'
  | 'money'
  | 'quantity'
  | 'price'
  | 'ratio'
  | 'date'
  | 'month'
  | 'timestamp'
  | 'boolean'
  | 'flags'
  | 'setting';

export interface RecordColumn {
  id: string;
  label: string;
  type: RecordColumnType;
}

export interface RecordEntityMeta {
  id: RecordEntityId;
  label: string;
  group: RecordGroupId;
  columns: RecordColumn[];
  defaultSort: { columnId: string; desc?: boolean };
}

/** Record groups in display order. */
export const RECORD_GROUPS: readonly { id: RecordGroupId; label: string }[] = [
  { id: 'investments', label: 'Investments' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'assets', label: 'Assets' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

/** The SQL table behind each entity. */
export const RECORD_ENTITY_TABLES: Readonly<Record<RecordEntityId, string>> = {
  instruments: 'instruments',
  trades: 'trades',
  dividends: 'dividends',
  'cash-accounts': 'cash_accounts',
  'budget-items': 'budget_items',
  'yearly-expenses': 'yearly_expenses',
  'income-streams': 'income_streams',
  'side-income': 'side_income_deposits',
  'period-notes': 'period_notes',
  snapshots: 'snapshots',
  'other-assets': 'other_assets',
  'super-funds': 'super_funds',
  'super-entries': 'super_entries',
  properties: 'properties',
  loans: 'loans',
  settings: 'settings',
  'cash-balance-entries': 'cash_balance_entries',
  'savings-adjustments': 'savings_adjustments',
  'savings-goals': 'savings_goals',
  'dividend-events': 'dividend_events',
  'other-asset-prices': 'other_asset_prices',
  'other-asset-sales': 'other_asset_sales',
  'super-balance-entries': 'super_balance_entries',
  'super-sg-overrides': 'super_sg_overrides',
  'property-valuations': 'property_valuations',
  'loan-balance-entries': 'loan_balance_entries',
  'loan-offset-links': 'loan_offset_links',
};

const col = (id: string, label: string, type: RecordColumnType): RecordColumn => ({
  id,
  label,
  type,
});

/**
 * The 36 History value columns (§2.4) in sheet order B…AK: the DB column, the record column id
 * (camelCase without `_cents`; `_ratio` kept as `Ratio`), the label and the type.
 */
export const SNAPSHOT_VALUE_COLUMNS: readonly {
  historyColumn: string;
  dbColumn: string;
  id: string;
  label: string;
  type: 'money' | 'ratio';
}[] = [
  ['B', 'stocks_value_cents', 'stocksValue', 'Stocks value'],
  ['C', 'stocks_gain_cents', 'stocksGain', 'Stocks gain'],
  ['D', 'stocks_gain_ratio', 'stocksGainRatio', 'Stocks gain %'],
  ['E', 'stocks_movements_cents', 'stocksMovements', 'Stocks movements'],
  ['F', 'etf_value_cents', 'etfValue', 'ETF value'],
  ['G', 'etf_gain_cents', 'etfGain', 'ETF gain'],
  ['H', 'etf_gain_ratio', 'etfGainRatio', 'ETF gain %'],
  ['I', 'etf_movements_cents', 'etfMovements', 'ETF movements'],
  ['J', 'crypto_value_cents', 'cryptoValue', 'Crypto value'],
  ['K', 'crypto_gain_cents', 'cryptoGain', 'Crypto gain'],
  ['L', 'crypto_gain_ratio', 'cryptoGainRatio', 'Crypto gain %'],
  ['M', 'crypto_movements_cents', 'cryptoMovements', 'Crypto movements'],
  ['N', 'cash_value_cents', 'cashValue', 'Cash value'],
  ['O', 'cash_gain_cents', 'cashGain', 'Cash gain'],
  ['P', 'cash_increase_ratio', 'cashIncreaseRatio', 'Cash increase %'],
  ['Q', 'super_value_cents', 'superValue', 'Super value'],
  ['R', 'super_contrib_cents', 'superContrib', 'Super contributions'],
  ['S', 'super_gain_cents', 'superGain', 'Super gain'],
  ['T', 'super_gain_ratio', 'superGainRatio', 'Super gain %'],
  ['U', 'liabilities_balance_cents', 'liabilitiesBalance', 'Liabilities balance'],
  ['V', 'liabilities_paid_cents', 'liabilitiesPaid', 'Liabilities paid'],
  ['W', 'salary_monthly_cents', 'salaryMonthly', 'Monthly salary'],
  ['X', 'property_value_cents', 'propertyValue', 'Property value'],
  ['Y', 'property_purchase_cents', 'propertyPurchase', 'Property purchase'],
  ['Z', 'property_equity_cents', 'propertyEquity', 'Property equity'],
  ['AA', 'property_gain_cents', 'propertyGain', 'Property gain'],
  ['AB', 'mortgage_balance_cents', 'mortgageBalance', 'Mortgage balance'],
  ['AC', 'mortgage_interest_fees_cents', 'mortgageInterestFees', 'Mortgage interest and fees'],
  ['AD', 'mortgage_principal_paid_cents', 'mortgagePrincipalPaid', 'Mortgage principal paid'],
  ['AE', 'property_gain_ratio', 'propertyGainRatio', 'Property gain %'],
  ['AF', 'mf_value_cents', 'mfValue', 'Managed funds value'],
  ['AG', 'mf_gain_cents', 'mfGain', 'Managed funds gain'],
  ['AH', 'mf_gain_ratio', 'mfGainRatio', 'Managed funds gain %'],
  ['AI', 'mf_movements_cents', 'mfMovements', 'Managed funds movements'],
  ['AJ', 'other_value_cents', 'otherValue', 'Other assets value'],
  ['AK', 'other_gain_cents', 'otherGain', 'Other assets gain'],
].map(([historyColumn, dbColumn, id, label]) => ({
  historyColumn: historyColumn!,
  dbColumn: dbColumn!,
  id: id!,
  label: label!,
  type: dbColumn!.endsWith('_ratio') ? ('ratio' as const) : ('money' as const),
}));

export const RECORD_ENTITIES: Readonly<Record<RecordEntityId, RecordEntityMeta>> = {
  instruments: {
    id: 'instruments',
    label: 'Instruments',
    group: 'investments',
    defaultSort: { columnId: 'kind' },
    columns: [
      col('kind', 'Kind', 'text'),
      col('symbol', 'Symbol', 'text'),
      col('name', 'Name', 'text'),
      col('currency', 'Currency', 'text'),
      col('watched', 'Watched', 'boolean'),
      col('heldUnits', 'Held units', 'quantity'),
      col('targetRatio', 'Target', 'ratio'),
      col('sector', 'Sector', 'text'),
      col('retirement', 'Retirement', 'boolean'),
      col('mgmtFeeRatio', 'Management fee', 'ratio'),
      col('location', 'Location', 'text'),
      col('regionUs', 'Region US', 'ratio'),
      col('regionAsia', 'Region Asia', 'ratio'),
      col('regionAus', 'Region Australia', 'ratio'),
      col('regionOther', 'Region other', 'ratio'),
      col('dividendFreqMonths', 'Dividend frequency (months)', 'integer'),
      col('drp', 'DRP', 'boolean'),
      col('defaultFee', 'Default fee', 'money'),
      col('defaultFeeRate', 'Default fee %', 'ratio'),
      col('provider', 'Price provider', 'text'),
      col('providerSymbol', 'Provider symbol', 'text'),
      col('origin', 'Origin', 'text'),
    ],
  },
  trades: {
    id: 'trades',
    label: 'Trades',
    group: 'investments',
    defaultSort: { columnId: 'date', desc: true },
    columns: [
      col('date', 'Date', 'date'),
      col('symbol', 'Symbol', 'text'),
      col('kind', 'Kind', 'text'),
      col('units', 'Units', 'quantity'),
      col('price', 'Price', 'price'),
      col('orderValue', 'Order value', 'money'),
      col('fee', 'Fee', 'money'),
      col('feeRate', 'Fee rate', 'ratio'),
      col('seq', 'Row', 'integer'),
      col('flags', 'Flags', 'flags'),
      col('correction', 'Correction', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  dividends: {
    id: 'dividends',
    label: 'Dividends',
    group: 'cashflow',
    defaultSort: { columnId: 'paymentDate', desc: true },
    columns: [
      col('paymentDate', 'Payment date', 'date'),
      col('ticker', 'Ticker', 'text'),
      col('symbol', 'Linked symbol', 'text'),
      col('kind', 'Kind', 'text'),
      col('exDate', 'Ex date', 'date'),
      col('reinvested', 'Reinvested', 'boolean'),
      col('netAmount', 'Net amount', 'money'),
      col('priceAtEx', 'Price at ex date', 'price'),
      col('flags', 'Flags', 'flags'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'cash-accounts': {
    id: 'cash-accounts',
    label: 'Cash accounts',
    group: 'cashflow',
    defaultSort: { columnId: 'name' },
    columns: [
      col('name', 'Name', 'text'),
      col('kind', 'Kind', 'text'),
      col('currency', 'Currency', 'text'),
      col('balance', 'Balance', 'money'),
      col('offset', 'Offset', 'boolean'),
      col('balanceAsOf', 'Balance as of', 'date'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'budget-items': {
    id: 'budget-items',
    label: 'Budget items',
    group: 'cashflow',
    defaultSort: { columnId: 'name' },
    columns: [
      col('name', 'Name', 'text'),
      col('kind', 'Kind', 'text'),
      col('monthly', 'Monthly', 'money'),
      col('category', 'Category', 'text'),
      col('account', 'Account', 'text'),
      col('linkedAccount', 'Linked account', 'text'),
      col('flags', 'Flags', 'flags'),
    ],
  },
  'yearly-expenses': {
    id: 'yearly-expenses',
    label: 'Yearly expenses',
    group: 'cashflow',
    defaultSort: { columnId: 'name' },
    columns: [col('name', 'Name', 'text'), col('annual', 'Annual', 'money')],
  },
  'income-streams': {
    id: 'income-streams',
    label: 'Income streams',
    group: 'cashflow',
    defaultSort: { columnId: 'name' },
    columns: [col('name', 'Name', 'text'), col('archived', 'Archived', 'boolean')],
  },
  // Stage 3: dated deposits (D57); the Stage 1 period entries are no longer listed.
  'side-income': {
    id: 'side-income',
    label: 'Side income',
    group: 'cashflow',
    defaultSort: { columnId: 'date', desc: true },
    columns: [
      col('date', 'Date', 'date'),
      col('stream', 'Stream', 'text'),
      col('amount', 'Amount', 'money'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'period-notes': {
    id: 'period-notes',
    label: 'Period notes',
    group: 'history',
    defaultSort: { columnId: 'period', desc: true },
    columns: [
      col('period', 'Period', 'month'),
      col('kind', 'Kind', 'text'),
      col('note', 'Note', 'text'),
    ],
  },
  snapshots: {
    id: 'snapshots',
    label: 'Snapshots',
    group: 'history',
    defaultSort: { columnId: 'period', desc: true },
    columns: [
      col('runDate', 'Run date', 'date'),
      col('period', 'Period', 'month'),
      col('source', 'Source', 'text'),
      ...SNAPSHOT_VALUE_COLUMNS.map((c) => col(c.id, c.label, c.type)),
    ],
  },
  'other-assets': {
    id: 'other-assets',
    label: 'Other assets',
    group: 'assets',
    defaultSort: { columnId: 'description' },
    columns: [
      col('description', 'Description', 'text'),
      col('url', 'Link', 'text'),
      col('purchaseDate', 'Purchase date', 'date'),
      col('units', 'Units', 'quantity'),
      col('soldUnits', 'Sold units', 'quantity'),
      col('currency', 'Currency', 'text'),
      col('unitCost', 'Unit cost', 'price'),
      col('unitPrice', 'Unit price', 'price'),
      col('priceSource', 'Price source', 'text'),
      col('metal', 'Metal', 'text'),
      col('unitOfMeasure', 'Unit of measure', 'text'),
      col('value', 'Value', 'money'),
      // Stage 4 (appended).
      col('purchaseFxRate', 'FX rate at purchase', 'price'),
      col('purchaseFxSource', 'FX rate source', 'text'),
    ],
  },
  'super-funds': {
    id: 'super-funds',
    label: 'Super funds',
    group: 'assets',
    defaultSort: { columnId: 'name' },
    columns: [
      col('name', 'Name', 'text'),
      col('balance', 'Balance', 'money'),
      col('balanceAsOf', 'Balance as of', 'date'),
      // Stage 4 (appended).
      col('receivesSg', 'Receives SG', 'boolean'),
    ],
  },
  'super-entries': {
    id: 'super-entries',
    label: 'Super entries',
    group: 'assets',
    defaultSort: { columnId: 'period', desc: true },
    columns: [
      col('period', 'Period', 'month'),
      col('kind', 'Kind', 'text'),
      col('fund', 'Fund', 'text'),
      col('amount', 'Amount', 'money'),
      // Stage 4 (appended).
      col('date', 'Date', 'date'),
    ],
  },
  properties: {
    id: 'properties',
    label: 'Properties',
    group: 'assets',
    defaultSort: { columnId: 'name' },
    columns: [
      col('name', 'Name', 'text'),
      col('purchaseDate', 'Purchase date', 'date'),
      col('primaryResidence', 'Primary residence', 'boolean'),
      col('purchaseValue', 'Purchase value', 'money'),
      col('currentValue', 'Current value', 'money'),
      col('netRent', 'Net rent to date', 'money'),
    ],
  },
  loans: {
    id: 'loans',
    label: 'Loans',
    group: 'assets',
    defaultSort: { columnId: 'name' },
    columns: [
      col('name', 'Name', 'text'),
      col('property', 'Property', 'text'),
      col('startDate', 'Start date', 'date'),
      col('annualRate', 'Annual rate', 'ratio'),
      col('periodsPerYear', 'Periods per year', 'integer'),
      col('payment', 'Payment', 'money'),
      col('startBalance', 'Start balance', 'money'),
      col('currentBalance', 'Current balance', 'money'),
      col('paymentsPaid', 'Payments paid', 'money'),
      col('paymentsPaidDerived', 'Payments paid derived', 'boolean'),
    ],
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    group: 'settings',
    defaultSort: { columnId: 'key' },
    columns: [
      col('key', 'Key', 'text'),
      col('label', 'Label', 'text'),
      col('category', 'Category', 'text'),
      col('value', 'Value', 'setting'),
      col('updatedAt', 'Updated', 'timestamp'),
    ],
  },
  // ─── Stage 3 (stage-3.md §3.2) ───
  'cash-balance-entries': {
    id: 'cash-balance-entries',
    label: 'Cash balance history',
    group: 'cashflow',
    defaultSort: { columnId: 'asOf', desc: true },
    columns: [
      col('account', 'Account', 'text'),
      col('asOf', 'As of', 'date'),
      col('balance', 'Balance', 'money'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'savings-adjustments': {
    id: 'savings-adjustments',
    label: 'Savings adjustments',
    group: 'history',
    defaultSort: { columnId: 'period', desc: true },
    columns: [
      col('period', 'Period', 'month'),
      col('amount', 'Amount', 'money'),
      col('note', 'Note', 'text'),
    ],
  },
  'savings-goals': {
    id: 'savings-goals',
    label: 'Savings goals',
    group: 'cashflow',
    defaultSort: { columnId: 'sortOrder' },
    columns: [
      col('name', 'Name', 'text'),
      col('target', 'Target', 'money'),
      col('targetDate', 'Target date', 'date'),
      col('sortOrder', 'Order', 'integer'),
      col('note', 'Note', 'text'),
    ],
  },
  'dividend-events': {
    id: 'dividend-events',
    label: 'Dividend events (Yahoo)',
    group: 'investments',
    defaultSort: { columnId: 'exDate', desc: true },
    columns: [
      col('symbol', 'Symbol', 'text'),
      col('exDate', 'Ex date', 'date'),
      col('amountPerUnit', 'Per unit', 'price'),
      col('currency', 'Currency', 'text'),
      col('closeBeforeEx', 'Close before ex date', 'price'),
      col('closeDate', 'Close date', 'date'),
      col('source', 'Source', 'text'),
      col('fetchedAt', 'Fetched', 'timestamp'),
      col('dismissed', 'Dismissed', 'boolean'),
    ],
  },
  // ─── Stage 4 (stage-4.md §3.2) ───
  'other-asset-prices': {
    id: 'other-asset-prices',
    label: 'Other asset prices',
    group: 'assets',
    defaultSort: { columnId: 'asOf', desc: true },
    columns: [
      col('asset', 'Asset', 'text'),
      col('asOf', 'As of', 'date'),
      col('unitPrice', 'Unit price', 'price'),
      col('currency', 'Currency', 'text'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'other-asset-sales': {
    id: 'other-asset-sales',
    label: 'Other asset sales',
    group: 'assets',
    defaultSort: { columnId: 'date', desc: true },
    columns: [
      col('asset', 'Asset', 'text'),
      col('date', 'Date', 'date'),
      col('units', 'Units', 'quantity'),
      col('proceeds', 'Proceeds', 'money'),
      col('note', 'Note', 'text'),
    ],
  },
  'super-balance-entries': {
    id: 'super-balance-entries',
    label: 'Super balance history',
    group: 'assets',
    defaultSort: { columnId: 'asOf', desc: true },
    columns: [
      col('fund', 'Fund', 'text'),
      col('asOf', 'As of', 'date'),
      col('balance', 'Balance', 'money'),
      col('transferIn', 'Transfer in', 'money'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'super-sg-overrides': {
    id: 'super-sg-overrides',
    label: 'Super SG statements',
    group: 'assets',
    defaultSort: { columnId: 'period', desc: true },
    columns: [
      col('period', 'Month earned', 'month'),
      col('gross', 'Before tax', 'money'),
      col('note', 'Note', 'text'),
    ],
  },
  'property-valuations': {
    id: 'property-valuations',
    label: 'Property valuations',
    group: 'assets',
    defaultSort: { columnId: 'asOf', desc: true },
    columns: [
      col('property', 'Property', 'text'),
      col('asOf', 'As of', 'date'),
      col('value', 'Value', 'money'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'loan-balance-entries': {
    id: 'loan-balance-entries',
    label: 'Loan balance history',
    group: 'assets',
    defaultSort: { columnId: 'asOf', desc: true },
    columns: [
      col('loan', 'Loan', 'text'),
      col('asOf', 'As of', 'date'),
      col('balance', 'Balance', 'money'),
      col('repayments', 'Repayments', 'money'),
      col('note', 'Note', 'text'),
      col('sheetRef', 'Sheet ref', 'text'),
    ],
  },
  'loan-offset-links': {
    id: 'loan-offset-links',
    label: 'Offset links',
    group: 'assets',
    defaultSort: { columnId: 'account' },
    columns: [col('account', 'Account', 'text'), col('loan', 'Loan', 'text')],
  },
};

export function isRecordEntityId(value: unknown): value is RecordEntityId {
  return typeof value === 'string' && (RECORD_ENTITY_IDS as readonly string[]).includes(value);
}
