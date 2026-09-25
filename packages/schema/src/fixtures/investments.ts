// Typed, generic investment fixtures for UI tests (stage-2.md §3.4, §7.5): one populated page per
// kind, the empty, unpriced, all-unpriced, nulls and timing states, the trade ledgers, holding
// details and instrument DTOs. No drizzle, no sqlite, no node imports (the web's jsdom tests import
// this module). Values are made up and round; symbols are the generic test symbols only.
//
// The figures agree with the engine rules (stage-2.md §2): FIFO lots by date (buys before sells),
// pro-rata fees, the ATO anniversary term, summary money = Σ of the rows it covers, ratios with 12
// significant digits, allocation and the consider-next rows. They were computed once by a scratch
// script and written here as literals; test/investment-fixtures.test.ts re-checks the sums, counts
// and statuses. One knowing exception, in `investmentPageNulls`: its portfolio XIRR is set to
// null to exercise the null tile (the engine would solve one from the fully sold holding's flows).
import type { AssetClass, InstrumentKind } from '../enums';
import type {
  ConsiderNextRowDto,
  DeletedResponse,
  DisposalRowDto,
  HoldingDetailResponse,
  HoldingDividendDto,
  HoldingRowDto,
  InstrumentDto,
  InvestmentAllocationDto,
  InvestmentChartsDto,
  InvestmentPageResponse,
  InvestmentSettingsDto,
  InvestmentSummaryDto,
  InvestmentTimingDto,
  InvestmentTradesResponse,
  LotRowDto,
  RealisedFyRowDto,
  TradeInputBody,
  TradeMutationResponse,
  TradeRowDto,
} from '../dto/investments';
import { FIXTURE_NOW } from './sampleDtos';

/** The investment fixtures' as-of date: FIXTURE_NOW's calendar date in Australia (a Thursday). */
export const INVESTMENT_FIXTURE_AS_OF = '2026-09-24';

/** The financial year of the as-of date (FY2026–27). */
const FY_NOW = 2026;

const PRICES_LIVE = {
  mode: 'live',
  lastRefreshAt: '2026-09-24T04:01:10.000Z',
  running: false,
} satisfies InvestmentPageResponse['prices'];

/** $10 brokerage, a 0.5 % crypto fee, an ETF limit of 3. */
export const investmentSettings = {
  defaultBrokerageCents: 1000,
  cryptoFeeRate: '0.005',
  etfLimit: 3,
} satisfies InvestmentSettingsDto;

// ─── stock ─────────────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const STOCK_HOLDINGS = [
  { instrumentId: 1, kind: 'stock', symbol: 'ASX:ABC', name: 'ABC Example Ltd', note: null, watched: true, status: 'held', flags: [], units: '110', price: { price: '12.5', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, valueCents: 137500, costCents: 121600, unrealisedCents: 15900, dividendsCents: 9800, totalReturnCents: 25700, totalReturnRatio: '0.211348684211', realisedCents: 25600, xirr: '0.194137', averagePrice: '10.9090909091', currentRatio: '0.604395604396', targetRatio: '0.5', differenceRatio: '0.104395604396', dividendYieldRatio: '0.0407413532319', sector: 'Materials', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2025-06-16', lastTradeDate: '2026-08-05', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 11, kind: 'stock', symbol: 'ASX:XYZ', name: 'XYZ Example Ltd', note: null, watched: true, status: 'held', flags: [], units: '200', price: { price: '4.5', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, valueCents: 90000, costCents: 101000, unrealisedCents: -11000, dividendsCents: 0, totalReturnCents: -11000, totalReturnRatio: '-0.108910891089', realisedCents: 0, xirr: '-0.574543', averagePrice: '5', currentRatio: '0.395604395604', targetRatio: '0.3', differenceRatio: '0.0956043956044', dividendYieldRatio: null, sector: 'Energy', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2026-08-10', lastTradeDate: '2026-08-10', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 13, kind: 'stock', symbol: 'ASX:GHI', name: 'GHI Example Ltd', note: 'Watching for a dip', watched: true, status: 'watching', flags: [], units: '0', price: { price: '20', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, valueCents: 0, costCents: 0, unrealisedCents: 0, dividendsCents: 0, totalReturnCents: null, totalReturnRatio: null, realisedCents: 0, xirr: null, averagePrice: null, currentRatio: '0', targetRatio: '0.2', differenceRatio: '-0.2', dividendYieldRatio: null, sector: 'Health care', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: null, lastTradeDate: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 2, kind: 'stock', symbol: 'ASX:OLD', name: null, note: null, watched: false, status: 'exited', flags: ['oversell'], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 0, totalReturnCents: null, totalReturnRatio: null, realisedCents: 3200, xirr: '0.8745', averagePrice: null, currentRatio: null, targetRatio: null, differenceRatio: null, dividendYieldRatio: null, sector: null, regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2024-03-01', lastTradeDate: '2025-02-03', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const STOCK_SUMMARY = {
  valueCents: 227500,
  costCents: 222600,
  unrealisedCents: 4900,
  dividendsHeldCents: 9800,
  totalReturnCents: 14700,
  totalReturnRatio: '0.0660377358491',
  realisedCents: 28800,
  realisedThisFyCents: 25600,
  xirr: '0.188684',
  investmentRatePerMonthCents: 60900,
  dividendsThisFyCents: 3500,
  dividendsAllTimeCents: 11800,
  heldCount: 2,
  watchingCount: 1,
  exitedCount: 1,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 3,
  estMgmtFeeCents: null,
  lastBuyDate: '2026-08-10',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const STOCK_ALLOCATION = {
  byHolding: [
    { key: '1', label: 'ASX:ABC', currentRatio: '0.604395604396', targetRatio: '0.5' },
    { key: '11', label: 'ASX:XYZ', currentRatio: '0.395604395604', targetRatio: '0.3' },
    { key: '13', label: 'ASX:GHI', currentRatio: '0', targetRatio: '0.2' },
  ],
  bySector: [
    { key: 'Materials', label: 'Materials', currentRatio: '0.604395604396', targetRatio: '0.5' },
    { key: 'Energy', label: 'Energy', currentRatio: '0.395604395604', targetRatio: '0.3' },
    { key: 'Health care', label: 'Health care', currentRatio: '0', targetRatio: '0.2' },
  ],
  byRegion: null,
} satisfies InvestmentAllocationDto;

// prettier-ignore
const STOCK_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 25600, totalCents: 25600, disposals: 2 },
  { financialYear: 2024, shortTermCents: 1600, longTermCents: 1600, totalCents: 3200, disposals: 2 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const STOCK_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 210000, contributionsCents: 166000, gainCents: 9000, gainRatio: '0.044776119403', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 214500, contributionsCents: 166000, gainCents: 11500, gainRatio: '0.0566502463054', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 229000, contributionsCents: 182000, gainCents: 12800, gainRatio: '0.059204440333', netPurchasesCents: 16000 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 227500, contributionsCents: 182000, gainCents: 14700, gainRatio: '0.0690789473684', netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// prettier-ignore
const STOCK_TRADES = [
  { id: 108, instrumentId: 11, symbol: 'ASX:XYZ', kind: 'stock', tradeDate: '2026-08-10', side: 'buy', units: '200', price: '5', orderValueCents: 100000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 8, origin: 'import', sheetRef: 'Stocks!A30', note: null, flags: [], correctionId: null, remainingUnits: '200', unrealisedCents: -11000, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 107, instrumentId: 1, symbol: 'ASX:ABC', kind: 'stock', tradeDate: '2026-08-05', side: 'sell', units: '60', price: '14', orderValueCents: 84000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 7, origin: 'import', sheetRef: 'Stocks!A29', note: null, flags: [], correctionId: null, remainingUnits: null, unrealisedCents: null, realisedCents: 25600, realisedShortCents: 0, realisedLongCents: 25600, oversoldUnits: null },
  { id: 106, instrumentId: 1, symbol: 'ASX:ABC', kind: 'stock', tradeDate: '2025-06-16', side: 'buy', units: '50', price: '12', orderValueCents: 60000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 6, origin: 'import', sheetRef: 'Stocks!A28', note: null, flags: [], correctionId: null, remainingUnits: '50', unrealisedCents: 1500, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 105, instrumentId: 2, symbol: 'ASX:OLD', kind: 'stock', tradeDate: '2025-02-03', side: 'sell', units: '25', price: '8', orderValueCents: 20000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 5, origin: 'import', sheetRef: 'Stocks!A27', note: null, flags: ['oversell'], correctionId: null, remainingUnits: null, unrealisedCents: null, realisedCents: 3200, realisedShortCents: 1600, realisedLongCents: 1600, oversoldUnits: '5' },
  { id: 104, instrumentId: 1, symbol: 'ASX:ABC', kind: 'stock', tradeDate: '2025-01-15', side: 'buy', units: '100', price: '10', orderValueCents: 100000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 4, origin: 'import', sheetRef: 'Stocks!A26', note: null, flags: [], correctionId: null, remainingUnits: '60', unrealisedCents: 14400, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 103, instrumentId: 1, symbol: 'ASX:ABC', kind: 'stock', tradeDate: '2024-06-03', side: 'buy', units: '20', price: '8', orderValueCents: 16000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 3, origin: 'import', sheetRef: 'Stocks!A25', note: null, flags: [], correctionId: null, remainingUnits: '0', unrealisedCents: null, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 102, instrumentId: 2, symbol: 'ASX:OLD', kind: 'stock', tradeDate: '2024-03-01', side: 'buy', units: '10', price: '5', orderValueCents: 5000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 2, origin: 'import', sheetRef: 'Stocks!A24', note: null, flags: [], correctionId: null, remainingUnits: '0', unrealisedCents: null, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 101, instrumentId: 2, symbol: 'ASX:OLD', kind: 'stock', tradeDate: '2023-11-01', side: 'buy', units: '10', price: '5', orderValueCents: 5000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 1, origin: 'import', sheetRef: 'Stocks!A23', note: null, flags: [], correctionId: null, remainingUnits: '0', unrealisedCents: null, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
] satisfies TradeRowDto[];

// ─── etf ───────────────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const ETF_HOLDINGS = [
  { instrumentId: 4, kind: 'etf', symbol: 'ASX:DEF', name: 'DEF Example ETF', note: 'Auto-invest', watched: true, status: 'held', flags: [], units: '32', price: { price: '62', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, valueCents: 198400, costCents: 177000, unrealisedCents: 21400, dividendsCents: 5300, totalReturnCents: 26700, totalReturnRatio: '0.150847457627', realisedCents: 0, xirr: '0.249059', averagePrice: '55.3125', currentRatio: '0.375473126419', targetRatio: '0.6', differenceRatio: '-0.224526873581', dividendYieldRatio: '0.0710179363971', sector: 'Global shares', regions: { us: '0.6', asia: '0.1', aus: '0.2', other: '0.1' }, mgmtFeeRatio: '0.0007', estMgmtFeeCents: 139, lastBuyDate: '2026-08-18', lastTradeDate: '2026-08-18', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
  { instrumentId: 12, kind: 'etf', symbol: 'ASX:MNO', name: 'MNO Example ETF', note: null, watched: true, status: 'held', flags: [], units: '30', price: { price: '110', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, valueCents: 330000, costCents: 301000, unrealisedCents: 29000, dividendsCents: 12000, totalReturnCents: 41000, totalReturnRatio: '0.136212624585', realisedCents: 0, xirr: '0.0616712', averagePrice: '100', currentRatio: '0.624526873581', targetRatio: '0.4', differenceRatio: '0.224526873581', dividendYieldRatio: null, sector: 'Australian shares', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: null }, mgmtFeeRatio: '0.002', estMgmtFeeCents: 661, lastBuyDate: '2024-07-01', lastTradeDate: '2024-07-01', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 3, kind: 'etf', symbol: 'ASX:XYZ', name: 'XYZ Example ETF', note: null, watched: false, status: 'exited', flags: [], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 4000, totalReturnCents: null, totalReturnRatio: null, realisedCents: -22000, xirr: '-0.0447796', averagePrice: null, currentRatio: null, targetRatio: null, differenceRatio: null, dividendYieldRatio: null, sector: 'Global shares', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' }, mgmtFeeRatio: '0.002', estMgmtFeeCents: null, lastBuyDate: '2023-08-01', lastTradeDate: '2025-12-01', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const ETF_SUMMARY = {
  valueCents: 528400,
  costCents: 478000,
  unrealisedCents: 50400,
  dividendsHeldCents: 17300,
  totalReturnCents: 67700,
  totalReturnRatio: '0.141631799163',
  realisedCents: -22000,
  realisedThisFyCents: 0,
  xirr: '0.0444129',
  investmentRatePerMonthCents: 13100,
  dividendsThisFyCents: 2800,
  dividendsAllTimeCents: 21300,
  heldCount: 2,
  watchingCount: 0,
  exitedCount: 1,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 2,
  estMgmtFeeCents: 800,
  lastBuyDate: '2026-08-18',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const ETF_ALLOCATION = {
  byHolding: [
    { key: '12', label: 'ASX:MNO', currentRatio: '0.624526873581', targetRatio: '0.4' },
    { key: '4', label: 'ASX:DEF', currentRatio: '0.375473126419', targetRatio: '0.6' },
  ],
  bySector: [
    { key: 'Australian shares', label: 'Australian shares', currentRatio: '0.624526873581', targetRatio: '0.4' },
    { key: 'Global shares', label: 'Global shares', currentRatio: '0.375473126419', targetRatio: '0.6' },
  ],
  byRegion: [
    { key: 'us', label: 'US', currentRatio: '0.537547312642', targetRatio: '0.56' },
    { key: 'aus', label: 'Australia', currentRatio: '0.262452687358', targetRatio: '0.24' },
    { key: 'asia', label: 'Asia', currentRatio: '0.1', targetRatio: '0.1' },
    { key: 'unassigned', label: 'Unassigned', currentRatio: '0.0624526873581', targetRatio: '0.04' },
    { key: 'other', label: 'EU/Other', currentRatio: '0.0375473126419', targetRatio: '0.06' },
  ],
} satisfies InvestmentAllocationDto;

// prettier-ignore
const ETF_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
  { financialYear: 2025, shortTermCents: 0, longTermCents: -22000, totalCents: -22000, disposals: 1 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const ETF_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 470000, contributionsCents: 422500, gainCents: 51000, gainRatio: '0.121718377088', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 492000, contributionsCents: 419700, gainCents: 56000, gainRatio: '0.128440366972', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 541000, contributionsCents: 491700, gainCents: 64800, gainRatio: '0.136077278454', netPurchasesCents: 72000 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 528400, contributionsCents: 491700, gainCents: 67700, gainRatio: '0.146950293032', netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// prettier-ignore
const ETF_TRADES = [
  { id: 116, instrumentId: 4, symbol: 'ASX:DEF', kind: 'etf', tradeDate: '2026-08-18', side: 'buy', units: '12', price: '60', orderValueCents: 72000, fee: { kind: 'flat', cents: 0 }, feeCents: 0, seq: 6, origin: 'app', sheetRef: null, note: 'Auto-invest buy', flags: [], correctionId: null, remainingUnits: '12', unrealisedCents: 2400, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 115, instrumentId: 4, symbol: 'ASX:DEF', kind: 'etf', tradeDate: '2026-02-10', side: 'buy', units: '10', price: '55', orderValueCents: 55000, fee: { kind: 'flat', cents: 0 }, feeCents: 0, seq: 5, origin: 'import', sheetRef: 'ETFs!A27', note: null, flags: [], correctionId: null, remainingUnits: '10', unrealisedCents: 7000, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 114, instrumentId: 3, symbol: 'ASX:XYZ', kind: 'etf', tradeDate: '2025-12-01', side: 'sell', units: '20', price: '70', orderValueCents: 140000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 3, origin: 'import', sheetRef: 'ETFs!A25', note: null, flags: [], correctionId: null, remainingUnits: null, unrealisedCents: null, realisedCents: -22000, realisedShortCents: 0, realisedLongCents: -22000, oversoldUnits: null },
  { id: 113, instrumentId: 4, symbol: 'ASX:DEF', kind: 'etf', tradeDate: '2025-05-20', side: 'buy', units: '10', price: '50', orderValueCents: 50000, fee: { kind: 'flat', cents: 0 }, feeCents: 0, seq: 4, origin: 'import', sheetRef: 'ETFs!A26', note: null, flags: ['out_of_order'], correctionId: null, remainingUnits: '10', unrealisedCents: 12000, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 112, instrumentId: 12, symbol: 'ASX:MNO', kind: 'etf', tradeDate: '2024-07-01', side: 'buy', units: '30', price: '100', orderValueCents: 300000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 2, origin: 'import', sheetRef: 'ETFs!A24', note: null, flags: [], correctionId: null, remainingUnits: '30', unrealisedCents: 29000, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 111, instrumentId: 3, symbol: 'ASX:XYZ', kind: 'etf', tradeDate: '2023-08-01', side: 'buy', units: '20', price: '80', orderValueCents: 160000, fee: { kind: 'flat', cents: 1000 }, feeCents: 1000, seq: 1, origin: 'import', sheetRef: 'ETFs!A23', note: null, flags: [], correctionId: null, remainingUnits: '0', unrealisedCents: null, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
] satisfies TradeRowDto[];

// ─── managed_fund ──────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const FUND_HOLDINGS = [
  { instrumentId: 5, kind: 'managed_fund', symbol: 'EXAMPLEFUND', name: 'Example Managed Fund', note: null, watched: true, status: 'held', flags: [], units: '1500.123456', price: { price: '1.5', status: 'manual', source: 'manual', asOf: '2026-09-21', lastError: null }, valueCents: 225019, costCents: 212518, unrealisedCents: 12501, dividendsCents: 10500, totalReturnCents: 23001, totalReturnRatio: '0.108229081686', realisedCents: 0, xirr: '0.06439', averagePrice: '1.41666940991', currentRatio: '1', targetRatio: '1', differenceRatio: '0', dividendYieldRatio: '0.0293574718114', sector: 'Diversified', regions: { us: '0.4', asia: '0.1', aus: '0.4', other: '0.1' }, mgmtFeeRatio: '0.008', estMgmtFeeCents: 1807, lastBuyDate: '2025-10-10', lastTradeDate: '2025-10-10', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
  { instrumentId: 6, kind: 'managed_fund', symbol: 'EXAMPLEFUND2', name: 'Example Managed Fund 2', note: null, watched: true, status: 'watching', flags: [], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 0, totalReturnCents: null, totalReturnRatio: null, realisedCents: 0, xirr: null, averagePrice: null, currentRatio: '0', targetRatio: null, differenceRatio: null, dividendYieldRatio: null, sector: null, regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: null, lastTradeDate: null, effectiveDefaultFee: { kind: 'flat', cents: 0 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const FUND_SUMMARY = {
  valueCents: 225019,
  costCents: 212518,
  unrealisedCents: 12501,
  dividendsHeldCents: 10500,
  totalReturnCents: 23001,
  totalReturnRatio: '0.108229081686',
  realisedCents: 0,
  realisedThisFyCents: 0,
  xirr: '0.06439',
  investmentRatePerMonthCents: 6400,
  dividendsThisFyCents: 6000,
  dividendsAllTimeCents: 10500,
  heldCount: 1,
  watchingCount: 1,
  exitedCount: 0,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 1,
  estMgmtFeeCents: 1807,
  lastBuyDate: '2025-10-10',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const FUND_ALLOCATION = {
  byHolding: [
    { key: '5', label: 'EXAMPLEFUND', currentRatio: '1', targetRatio: '1' },
  ],
  bySector: [
    { key: 'Diversified', label: 'Diversified', currentRatio: '1', targetRatio: '1' },
  ],
  byRegion: [
    { key: 'aus', label: 'Australia', currentRatio: '0.4', targetRatio: '0.4' },
    { key: 'us', label: 'US', currentRatio: '0.4', targetRatio: '0.4' },
    { key: 'asia', label: 'Asia', currentRatio: '0.1', targetRatio: '0.1' },
    { key: 'other', label: 'EU/Other', currentRatio: '0.1', targetRatio: '0.1' },
    { key: 'unassigned', label: 'Unassigned', currentRatio: '0', targetRatio: '0' },
  ],
} satisfies InvestmentAllocationDto;

// prettier-ignore
const FUND_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const FUND_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 212000, contributionsCents: 212518, gainCents: 9500, gainRatio: '0.0469135802469', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 216500, contributionsCents: 212518, gainCents: 13000, gainRatio: '0.0638820638821', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 219800, contributionsCents: 212518, gainCents: 17600, gainRatio: '0.0870425321464', netPurchasesCents: 0 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 225019, contributionsCents: 212518, gainCents: 23001, gainRatio: '0.113856191032', netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// prettier-ignore
const FUND_TRADES = [
  { id: 122, instrumentId: 5, symbol: 'EXAMPLEFUND', kind: 'managed_fund', tradeDate: '2025-10-10', side: 'buy', units: '500.123456', price: '1.45', orderValueCents: 72518, fee: { kind: 'flat', cents: 0 }, feeCents: 0, seq: 2, origin: 'import', sheetRef: 'Managed Funds!A24', note: null, flags: [], correctionId: null, remainingUnits: '500.123456', unrealisedCents: 2501, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 121, instrumentId: 5, symbol: 'EXAMPLEFUND', kind: 'managed_fund', tradeDate: '2024-09-10', side: 'buy', units: '1000', price: '1.4', orderValueCents: 140000, fee: { kind: 'flat', cents: 0 }, feeCents: 0, seq: 1, origin: 'import', sheetRef: 'Managed Funds!A23', note: null, flags: [], correctionId: null, remainingUnits: '1000', unrealisedCents: 10000, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
] satisfies TradeRowDto[];

// ─── crypto ────────────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const CRYPTO_HOLDINGS = [
  { instrumentId: 7, kind: 'crypto', symbol: 'BTC', name: null, note: null, watched: true, status: 'held', flags: [], units: '0.06234567', price: { price: '160000', status: 'fresh', source: 'coingecko', asOf: '2026-09-24T04:10:00.000Z', lastError: null }, valueCents: 997531, costCents: 638361, unrealisedCents: 359170, dividendsCents: 0, totalReturnCents: 359170, totalReturnRatio: '0.562643643135', realisedCents: 0, xirr: '0.301011', averagePrice: '101881.181163', currentRatio: '0.713780889196', targetRatio: '0.7', differenceRatio: '0.0137808891958', dividendYieldRatio: null, sector: null, regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2025-06-01', lastTradeDate: '2025-06-01', effectiveDefaultFee: { kind: 'rate', rate: '0.0025' } },
  { instrumentId: 8, kind: 'crypto', symbol: 'ETH', name: null, note: null, watched: true, status: 'held', flags: [], units: '1', price: { price: '4000', status: 'fresh', source: 'coingecko', asOf: '2026-09-24T04:10:00.000Z', lastError: null }, valueCents: 400000, costCents: 301500, unrealisedCents: 98500, dividendsCents: 2700, totalReturnCents: 101200, totalReturnRatio: '0.335655058043', realisedCents: 29125, xirr: '0.230148', averagePrice: '3000', currentRatio: '0.286219110804', targetRatio: '0.3', differenceRatio: '-0.0137808891958', dividendYieldRatio: '0.0203189493433', sector: null, regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2025-03-03', lastTradeDate: '2026-04-10', effectiveDefaultFee: { kind: 'rate', rate: '0.005' } },
] satisfies HoldingRowDto[];

// prettier-ignore
const CRYPTO_SUMMARY = {
  valueCents: 1397531,
  costCents: 939861,
  unrealisedCents: 457670,
  dividendsHeldCents: 2700,
  totalReturnCents: 460370,
  totalReturnRatio: '0.489827492441',
  realisedCents: 29125,
  realisedThisFyCents: 0,
  xirr: '0.278221',
  investmentRatePerMonthCents: 0,
  dividendsThisFyCents: 1500,
  dividendsAllTimeCents: 2700,
  heldCount: 2,
  watchingCount: 0,
  exitedCount: 0,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 2,
  estMgmtFeeCents: null,
  lastBuyDate: '2025-06-01',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const CRYPTO_ALLOCATION = {
  byHolding: [
    { key: '7', label: 'BTC', currentRatio: '0.713780889196', targetRatio: '0.7' },
    { key: '8', label: 'ETH', currentRatio: '0.286219110804', targetRatio: '0.3' },
  ],
  bySector: null,
  byRegion: null,
} satisfies InvestmentAllocationDto;

// prettier-ignore
const CRYPTO_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
  { financialYear: 2025, shortTermCents: 0, longTermCents: 29125, totalCents: 29125, disposals: 1 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const CRYPTO_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 1310000, contributionsCents: 905185, gainCents: 372000, gainRatio: '0.396588486141', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 1285000, contributionsCents: 905185, gainCents: 348000, gainRatio: '0.371398078975', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 1352000, contributionsCents: 905185, gainCents: 414000, gainRatio: '0.441364605544', netPurchasesCents: 0 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 1397531, contributionsCents: 905185, gainCents: 460370, gainRatio: '0.491238965343', netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// prettier-ignore
const CRYPTO_TRADES = [
  { id: 134, instrumentId: 8, symbol: 'ETH', kind: 'crypto', tradeDate: '2026-04-10', side: 'sell', units: '0.25', price: '4200', orderValueCents: 105000, fee: { kind: 'flat', cents: 500 }, feeCents: 500, seq: 4, origin: 'import', sheetRef: 'Crypto!A20', note: null, flags: [], correctionId: null, remainingUnits: null, unrealisedCents: null, realisedCents: 29125, realisedShortCents: 0, realisedLongCents: 29125, oversoldUnits: null },
  { id: 133, instrumentId: 7, symbol: 'BTC', kind: 'crypto', tradeDate: '2025-06-01', side: 'buy', units: '0.01234567', price: '150000', orderValueCents: 185185, fee: { kind: 'rate', rate: '0.005' }, feeCents: 926, seq: 3, origin: 'import', sheetRef: 'Crypto!A19', note: null, flags: [], correctionId: null, remainingUnits: '0.01234567', unrealisedCents: 11420, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 132, instrumentId: 8, symbol: 'ETH', kind: 'crypto', tradeDate: '2025-03-03', side: 'buy', units: '1.25', price: '3000', orderValueCents: 375000, fee: { kind: 'rate', rate: '0.005' }, feeCents: 1875, seq: 2, origin: 'import', sheetRef: 'Crypto!A18', note: null, flags: [], correctionId: null, remainingUnits: '1', unrealisedCents: 98500, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
  { id: 131, instrumentId: 7, symbol: 'BTC', kind: 'crypto', tradeDate: '2024-11-11', side: 'buy', units: '0.05', price: '90000', orderValueCents: 450000, fee: { kind: 'rate', rate: '0.005' }, feeCents: 2250, seq: 1, origin: 'import', sheetRef: 'Crypto!A17', note: null, flags: [], correctionId: null, remainingUnits: '0.05', unrealisedCents: 347750, realisedCents: null, realisedShortCents: null, realisedLongCents: null, oversoldUnits: null },
] satisfies TradeRowDto[];

// ─── etfUnpriced ───────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const ETF_UNPRICED_HOLDINGS = [
  { instrumentId: 4, kind: 'etf', symbol: 'ASX:DEF', name: 'DEF Example ETF', note: 'Auto-invest', watched: true, status: 'held', flags: ['unpriced'], units: '32', price: { price: null, status: 'failed', source: null, asOf: null, lastError: 'Symbol not found' }, valueCents: null, costCents: 177000, unrealisedCents: null, dividendsCents: 5300, totalReturnCents: null, totalReturnRatio: null, realisedCents: 0, xirr: null, averagePrice: '55.3125', currentRatio: null, targetRatio: '0.6', differenceRatio: null, dividendYieldRatio: '0.0710179363971', sector: 'Global shares', regions: { us: '0.6', asia: '0.1', aus: '0.2', other: '0.1' }, mgmtFeeRatio: '0.0007', estMgmtFeeCents: null, lastBuyDate: '2026-08-18', lastTradeDate: '2026-08-18', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
  { instrumentId: 12, kind: 'etf', symbol: 'ASX:MNO', name: 'MNO Example ETF', note: null, watched: true, status: 'held', flags: ['stale_price'], units: '30', price: { price: '110', status: 'stale', source: 'sheet', asOf: '2026-08-31T00:00:00.000Z', lastError: null }, valueCents: 330000, costCents: 301000, unrealisedCents: 29000, dividendsCents: 12000, totalReturnCents: 41000, totalReturnRatio: '0.136212624585', realisedCents: 0, xirr: '0.0616712', averagePrice: '100', currentRatio: '1', targetRatio: '0.4', differenceRatio: '0.6', dividendYieldRatio: null, sector: 'Australian shares', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: null }, mgmtFeeRatio: '0.002', estMgmtFeeCents: 661, lastBuyDate: '2024-07-01', lastTradeDate: '2024-07-01', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 3, kind: 'etf', symbol: 'ASX:XYZ', name: 'XYZ Example ETF', note: null, watched: false, status: 'exited', flags: [], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 4000, totalReturnCents: null, totalReturnRatio: null, realisedCents: -22000, xirr: '-0.0447796', averagePrice: null, currentRatio: null, targetRatio: null, differenceRatio: null, dividendYieldRatio: null, sector: 'Global shares', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' }, mgmtFeeRatio: '0.002', estMgmtFeeCents: null, lastBuyDate: '2023-08-01', lastTradeDate: '2025-12-01', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const ETF_UNPRICED_SUMMARY = {
  valueCents: 330000,
  costCents: 301000,
  unrealisedCents: 29000,
  dividendsHeldCents: 12000,
  totalReturnCents: 41000,
  totalReturnRatio: '0.136212624585',
  realisedCents: -22000,
  realisedThisFyCents: 0,
  xirr: '0.0245146',
  investmentRatePerMonthCents: 13100,
  dividendsThisFyCents: 2800,
  dividendsAllTimeCents: 21300,
  heldCount: 2,
  watchingCount: 0,
  exitedCount: 1,
  unpricedCount: 1,
  stalePriceCount: 1,
  targetSumRatio: '1',
  targetCount: 2,
  estMgmtFeeCents: 661,
  lastBuyDate: '2026-08-18',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const ETF_UNPRICED_ALLOCATION = {
  byHolding: [
    { key: '12', label: 'ASX:MNO', currentRatio: '1', targetRatio: '0.4' },
    { key: '4', label: 'ASX:DEF', currentRatio: '0', targetRatio: '0.6' },
  ],
  bySector: [
    { key: 'Australian shares', label: 'Australian shares', currentRatio: '1', targetRatio: '0.4' },
    { key: 'Global shares', label: 'Global shares', currentRatio: '0', targetRatio: '0.6' },
  ],
  byRegion: [
    { key: 'us', label: 'US', currentRatio: '0.5', targetRatio: '0.56' },
    { key: 'aus', label: 'Australia', currentRatio: '0.3', targetRatio: '0.24' },
    { key: 'asia', label: 'Asia', currentRatio: '0.1', targetRatio: '0.1' },
    { key: 'unassigned', label: 'Unassigned', currentRatio: '0.1', targetRatio: '0.04' },
    { key: 'other', label: 'EU/Other', currentRatio: '0', targetRatio: '0.06' },
  ],
} satisfies InvestmentAllocationDto;

// prettier-ignore
const ETF_UNPRICED_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
  { financialYear: 2025, shortTermCents: 0, longTermCents: -22000, totalCents: -22000, disposals: 1 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const ETF_UNPRICED_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 470000, contributionsCents: 422500, gainCents: 51000, gainRatio: '0.121718377088', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 492000, contributionsCents: 419700, gainCents: 56000, gainRatio: '0.128440366972', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 541000, contributionsCents: 491700, gainCents: 64800, gainRatio: '0.136077278454', netPurchasesCents: 72000 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 330000, contributionsCents: 491700, gainCents: 41000, gainRatio: '0.141868512111', netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// ─── stockAllUnpriced ──────────────────────────────────────────────────────────────────────────

// prettier-ignore
const STOCK_ALL_UNPRICED_HOLDINGS = [
  { instrumentId: 1, kind: 'stock', symbol: 'ASX:ABC', name: 'ABC Example Ltd', note: null, watched: true, status: 'held', flags: ['unpriced'], units: '110', price: { price: null, status: 'failed', source: null, asOf: null, lastError: 'Request timed out' }, valueCents: null, costCents: 121600, unrealisedCents: null, dividendsCents: 9800, totalReturnCents: null, totalReturnRatio: null, realisedCents: 25600, xirr: null, averagePrice: '10.9090909091', currentRatio: null, targetRatio: '0.5', differenceRatio: null, dividendYieldRatio: '0.0407413532319', sector: 'Materials', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2025-06-16', lastTradeDate: '2026-08-05', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 11, kind: 'stock', symbol: 'ASX:XYZ', name: 'XYZ Example Ltd', note: null, watched: true, status: 'held', flags: ['unpriced'], units: '200', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 101000, unrealisedCents: null, dividendsCents: 0, totalReturnCents: null, totalReturnRatio: null, realisedCents: 0, xirr: null, averagePrice: '5', currentRatio: null, targetRatio: '0.3', differenceRatio: null, dividendYieldRatio: null, sector: 'Energy', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2026-08-10', lastTradeDate: '2026-08-10', effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
  { instrumentId: 13, kind: 'stock', symbol: 'ASX:GHI', name: 'GHI Example Ltd', note: 'Watching for a dip', watched: true, status: 'watching', flags: [], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 0, totalReturnCents: null, totalReturnRatio: null, realisedCents: 0, xirr: null, averagePrice: null, currentRatio: '0', targetRatio: '0.2', differenceRatio: '-0.2', dividendYieldRatio: null, sector: 'Health care', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: null, lastTradeDate: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const STOCK_ALL_UNPRICED_SUMMARY = {
  valueCents: 0,
  costCents: 0,
  unrealisedCents: 0,
  dividendsHeldCents: 0,
  totalReturnCents: 0,
  totalReturnRatio: null,
  realisedCents: 25600,
  realisedThisFyCents: 25600,
  xirr: null,
  investmentRatePerMonthCents: 60900,
  dividendsThisFyCents: 3500,
  dividendsAllTimeCents: 11800,
  heldCount: 2,
  watchingCount: 1,
  exitedCount: 0,
  unpricedCount: 2,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 3,
  estMgmtFeeCents: null,
  lastBuyDate: '2026-08-10',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const STOCK_ALL_UNPRICED_ALLOCATION = {
  byHolding: [
    { key: '1', label: 'ASX:ABC', currentRatio: '0', targetRatio: '0.5' },
    { key: '11', label: 'ASX:XYZ', currentRatio: '0', targetRatio: '0.3' },
    { key: '13', label: 'ASX:GHI', currentRatio: '0', targetRatio: '0.2' },
  ],
  bySector: [
    { key: 'Materials', label: 'Materials', currentRatio: '0', targetRatio: '0.5' },
    { key: 'Energy', label: 'Energy', currentRatio: '0', targetRatio: '0.3' },
    { key: 'Health care', label: 'Health care', currentRatio: '0', targetRatio: '0.2' },
  ],
  byRegion: null,
} satisfies InvestmentAllocationDto;

// prettier-ignore
const STOCK_ALL_UNPRICED_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 25600, totalCents: 25600, disposals: 2 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const STOCK_ALL_UNPRICED_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 165000, contributionsCents: 176000, gainCents: 4000, gainRatio: '0.0248447204969', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 168000, contributionsCents: 176000, gainCents: 6000, gainRatio: '0.037037037037', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 118000, contributionsCents: 192000, gainCents: 3000, gainRatio: '0.0260869565217', netPurchasesCents: 16000 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 0, contributionsCents: 192000, gainCents: 0, gainRatio: null, netPurchasesCents: 0 },
  ],
} satisfies InvestmentChartsDto;

// ─── mfNulls ───────────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const FUND_NULLS_HOLDINGS = [
  { instrumentId: 5, kind: 'managed_fund', symbol: 'EXAMPLEFUND', name: 'Example Managed Fund', note: null, watched: true, status: 'held', flags: [], units: '1000', price: { price: '1.5', status: 'manual', source: 'manual', asOf: '2026-09-21', lastError: null }, valueCents: 150000, costCents: 150000, unrealisedCents: 0, dividendsCents: 0, totalReturnCents: 0, totalReturnRatio: '0', realisedCents: 0, xirr: null, averagePrice: '1.5', currentRatio: '0.773195876289', targetRatio: '0.5', differenceRatio: '0.273195876289', dividendYieldRatio: null, sector: 'Diversified', regions: { us: '0.4', asia: '0.1', aus: '0.4', other: '0.1' }, mgmtFeeRatio: '0.008', estMgmtFeeCents: 1205, lastBuyDate: '2026-09-24', lastTradeDate: '2026-09-24', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
  { instrumentId: 10, kind: 'managed_fund', symbol: 'EXAMPLEFUND3', name: 'Example Managed Fund 3', note: null, watched: false, status: 'held', flags: ['unwatched_held'], units: '200', price: { price: '2.2', status: 'manual', source: 'manual', asOf: '2026-09-01', lastError: null }, valueCents: 44000, costCents: 40000, unrealisedCents: 4000, dividendsCents: 0, totalReturnCents: 4000, totalReturnRatio: '0.1', realisedCents: 0, xirr: '0.035838', averagePrice: '2', currentRatio: '0.226804123711', targetRatio: null, differenceRatio: null, dividendYieldRatio: null, sector: null, regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2024-01-10', lastTradeDate: '2024-01-10', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
  { instrumentId: 6, kind: 'managed_fund', symbol: 'EXAMPLEFUND2', name: 'Example Managed Fund 2', note: null, watched: true, status: 'watching', flags: [], units: '0', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, valueCents: null, costCents: 0, unrealisedCents: null, dividendsCents: 5000, totalReturnCents: null, totalReturnRatio: null, realisedCents: 20000, xirr: '0.110718', averagePrice: null, currentRatio: '0', targetRatio: '0.5', differenceRatio: '-0.5', dividendYieldRatio: null, sector: 'Diversified', regions: null, mgmtFeeRatio: null, estMgmtFeeCents: null, lastBuyDate: '2023-05-01', lastTradeDate: '2025-06-30', effectiveDefaultFee: { kind: 'flat', cents: 0 } },
] satisfies HoldingRowDto[];

// prettier-ignore
const FUND_NULLS_SUMMARY = {
  valueCents: 194000,
  costCents: 190000,
  unrealisedCents: 4000,
  dividendsHeldCents: 0,
  totalReturnCents: 4000,
  totalReturnRatio: '0.0210526315789',
  realisedCents: 20000,
  realisedThisFyCents: 0,
  xirr: null,
  investmentRatePerMonthCents: null,
  dividendsThisFyCents: 0,
  dividendsAllTimeCents: 5000,
  heldCount: 2,
  watchingCount: 1,
  exitedCount: 0,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '1',
  targetCount: 3,
  estMgmtFeeCents: 1205,
  lastBuyDate: '2026-09-24',
} satisfies InvestmentSummaryDto;

// prettier-ignore
const FUND_NULLS_ALLOCATION = {
  byHolding: [
    { key: '5', label: 'EXAMPLEFUND', currentRatio: '0.773195876289', targetRatio: '0.5' },
    { key: '10', label: 'EXAMPLEFUND3', currentRatio: '0.226804123711', targetRatio: '0' },
    { key: '6', label: 'EXAMPLEFUND2', currentRatio: '0', targetRatio: '0.5' },
  ],
  bySector: [
    { key: 'Diversified', label: 'Diversified', currentRatio: '0.773195876289', targetRatio: '1' },
    { key: 'unassigned', label: 'Unassigned', currentRatio: '0.226804123711', targetRatio: '0' },
  ],
  byRegion: [
    { key: 'aus', label: 'Australia', currentRatio: '0.309278350515', targetRatio: '0.2' },
    { key: 'us', label: 'US', currentRatio: '0.309278350515', targetRatio: '0.2' },
    { key: 'unassigned', label: 'Unassigned', currentRatio: '0.226804123711', targetRatio: '0.5' },
    { key: 'asia', label: 'Asia', currentRatio: '0.0773195876289', targetRatio: '0.05' },
    { key: 'other', label: 'EU/Other', currentRatio: '0.0773195876289', targetRatio: '0.05' },
  ],
} satisfies InvestmentAllocationDto;

// prettier-ignore
const FUND_NULLS_REALISED_BY_FY = [
  { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
  { financialYear: 2024, shortTermCents: 0, longTermCents: 20000, totalCents: 20000, disposals: 1 },
] satisfies RealisedFyRowDto[];

// prettier-ignore
const FUND_NULLS_CHARTS = {
  unit: 'monthly',
  count: null,
  points: [
    { label: 'Jun 2026', period: '2026-06', date: '2026-06-30', live: false, valueCents: 43000, contributionsCents: 20000, gainCents: 3000, gainRatio: '0.075', netPurchasesCents: 0 },
    { label: 'Jul 2026', period: '2026-07', date: '2026-07-31', live: false, valueCents: 43500, contributionsCents: 20000, gainCents: 3500, gainRatio: '0.0875', netPurchasesCents: 0 },
    { label: 'Aug 2026', period: '2026-08', date: '2026-08-31', live: false, valueCents: 44000, contributionsCents: 20000, gainCents: 4000, gainRatio: '0.1', netPurchasesCents: 0 },
    { label: 'Sep 2026', period: '2026-09', date: '2026-09-24', live: true, valueCents: 194000, contributionsCents: 170000, gainCents: 4000, gainRatio: '0.0210526315789', netPurchasesCents: 150000 },
  ],
} satisfies InvestmentChartsDto;

// ─── Timing (the Budget chain, parcel plan, countdown and consider next; §2.12) ───────────────
// Class values: the four kinds' summary values, cash $25,000 (non-offset accounts) and other
// assets $2,261.50. Class targets: ETFs 60 %, stocks 10 %, crypto 10 %, cash 15 %, managed funds 5 %.

// prettier-ignore
const CLASS_ROWS = [
  { assetClass: 'etf', valueCents: 528400, currentRatio: '0.103514477138', targetRatio: '0.6', deltaRatio: '-0.496485522862' },
  { assetClass: 'stock', valueCents: 227500, currentRatio: '0.0445676448693', targetRatio: '0.1', deltaRatio: '-0.0554323551307' },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.27377874858', targetRatio: '0.1', deltaRatio: '0.17377874858' },
  { assetClass: 'cash', valueCents: 2500000, currentRatio: '0.489754339223', targetRatio: '0.15', deltaRatio: '0.339754339223' },
  { assetClass: 'managed_fund', valueCents: 225019, currentRatio: '0.0440816126631', targetRatio: '0.05', deltaRatio: '-0.00591838733691' },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0443031775262', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

// prettier-ignore
const CLASS_ROWS_ETF_UNPRICED = [
  { assetClass: 'etf', valueCents: 330000, currentRatio: '0.0672618319677', targetRatio: '0.6', deltaRatio: '-0.532738168032' },
  { assetClass: 'stock', valueCents: 227500, currentRatio: '0.0463698993111', targetRatio: '0.1', deltaRatio: '-0.0536301006889' },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.284849985732', targetRatio: '0.1', deltaRatio: '0.184849985732' },
  { assetClass: 'cash', valueCents: 2500000, currentRatio: '0.509559333089', targetRatio: '0.15', deltaRatio: '0.359559333089' },
  { assetClass: 'managed_fund', valueCents: 225019, currentRatio: '0.0458642126289', targetRatio: '0.05', deltaRatio: '-0.00413578737108' },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0460947372712', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

// prettier-ignore
const CLASS_ROWS_STOCK_ALL_UNPRICED = [
  { assetClass: 'etf', valueCents: 528400, currentRatio: '0.108343072728', targetRatio: '0.6', deltaRatio: '-0.491656927272' },
  { assetClass: 'stock', valueCents: 0, currentRatio: '0', targetRatio: '0.1', deltaRatio: '-0.1' },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.286549588895', targetRatio: '0.1', deltaRatio: '0.186549588895' },
  { assetClass: 'cash', valueCents: 2500000, currentRatio: '0.512599700642', targetRatio: '0.15', deltaRatio: '0.362599700642' },
  { assetClass: 'managed_fund', valueCents: 225019, currentRatio: '0.0461378688155', targetRatio: '0.05', deltaRatio: '-0.00386213118452' },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0463697689201', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

// prettier-ignore
const CLASS_ROWS_FUND_NULLS = [
  { assetClass: 'etf', valueCents: 528400, currentRatio: '0.104147346815', targetRatio: '0.6', deltaRatio: '-0.495852653185' },
  { assetClass: 'stock', valueCents: 227500, currentRatio: '0.0448401237706', targetRatio: '0.1', deltaRatio: '-0.0551598762294' },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.275452584673', targetRatio: '0.1', deltaRatio: '0.175452584673' },
  { assetClass: 'cash', valueCents: 2500000, currentRatio: '0.492748612863', targetRatio: '0.15', deltaRatio: '0.342748612863' },
  { assetClass: 'managed_fund', valueCents: 194000, currentRatio: '0.0382372923582', targetRatio: '0.05', deltaRatio: '-0.0117627076418' },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0445740395196', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

// prettier-ignore
const CLASS_ROWS_BELOW_EMERGENCY_FUND = [
  { assetClass: 'etf', valueCents: 528400, currentRatio: '0.155201785819', targetRatio: '0.6', deltaRatio: '-0.444798214181' },
  { assetClass: 'stock', valueCents: 227500, currentRatio: '0.0668213593374', targetRatio: '0.1', deltaRatio: '-0.0331786406626' },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.410483169829', targetRatio: '0.1', deltaRatio: '0.310483169829' },
  { assetClass: 'cash', valueCents: 800000, currentRatio: '0.234976208659', targetRatio: '0.15', deltaRatio: '0.0849762086589' },
  { assetClass: 'managed_fund', valueCents: 225019, currentRatio: '0.0660926393703', targetRatio: '0.05', deltaRatio: '0.0160926393703' },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0664248369853', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

// prettier-ignore
const CLASS_ROWS_NO_TARGETS = [
  { assetClass: 'etf', valueCents: 528400, currentRatio: '0.103514477138', targetRatio: null, deltaRatio: null },
  { assetClass: 'stock', valueCents: 227500, currentRatio: '0.0445676448693', targetRatio: null, deltaRatio: null },
  { assetClass: 'crypto', valueCents: 1397531, currentRatio: '0.27377874858', targetRatio: null, deltaRatio: null },
  { assetClass: 'cash', valueCents: 2500000, currentRatio: '0.489754339223', targetRatio: null, deltaRatio: null },
  { assetClass: 'managed_fund', valueCents: 225019, currentRatio: '0.0440816126631', targetRatio: null, deltaRatio: null },
  { assetClass: 'other_assets', valueCents: 226150, currentRatio: '0.0443031775262', targetRatio: null, deltaRatio: null },
] satisfies ConsiderNextRowDto[];

const BUDGET = {
  monthlyIncomeCents: 650000,
  plannedSpendCents: 350000,
  leftoverCents: 300000,
  emergencyFundCents: 2100000,
  investShareRatio: '0.5',
  investmentRowCents: 150000,
  sideIncomeInvestCents: 12000,
  useBudget: true,
  source: 'imported_budget',
} satisfies InvestmentTimingDto['budget'];

/**
 * The ETFs page's timing (state `wait`): $1,620/month to invest ($1,500 budget row + $120 side
 * income); the optimiser's plan is every 3 months ($4,860; optimal $3,943.60). Last ETF or stock
 * buy 18/08/2026, pay day 15 → 17/08/2026 + 90 days = Sun 15/11/2026 → Thu 19/11/2026: 56 days.
 * The most underweight class is ETFs; the hint is ASX:DEF (the most negative difference).
 */
const TIMING = {
  monthlyInvestCents: 162000,
  budget: BUDGET,
  plan: { months: 3, parcelCents: 486000, optimalParcelCents: 394360 },
  lastPurchaseDate: '2026-08-18',
  countdown: { state: 'wait', days: 56, nextPurchaseDate: '2026-11-19', periodDays: 90 },
  considerNext: { assetClass: 'etf', reason: 'most_underweight', rows: CLASS_ROWS },
  hint: { assetClass: 'etf', instrumentId: 4, symbol: 'ASX:DEF', parcelCents: 486000 },
  missing: [],
  deferred: [],
} satisfies InvestmentTimingDto;

/** The same timing on another kind's page: the suggested class is not this kind, so no holding. */
function classOnlyHint(t: InvestmentTimingDto): InvestmentTimingDto {
  return {
    ...t,
    hint: {
      assetClass: t.considerNext.assetClass,
      instrumentId: null,
      symbol: null,
      parcelCents: null,
    },
  };
}

/** ETFs page with every held ETF unpriced but ASX:MNO: the hint skips the unpriced ASX:DEF. */
const TIMING_ETF_UNPRICED = {
  ...TIMING,
  considerNext: { assetClass: 'etf', reason: 'most_underweight', rows: CLASS_ROWS_ETF_UNPRICED },
  hint: { assetClass: 'etf', instrumentId: 12, symbol: 'ASX:MNO', parcelCents: 486000 },
} satisfies InvestmentTimingDto;

/** No emergency-fund months set: the emergency fund is null and the cash-first rules are off. */
const TIMING_NO_EMERGENCY_FUND = {
  ...TIMING,
  budget: { ...BUDGET, emergencyFundCents: null },
  considerNext: { assetClass: 'etf', reason: 'most_underweight', rows: CLASS_ROWS_FUND_NULLS },
  hint: { assetClass: 'etf', instrumentId: null, symbol: null, parcelCents: null },
  missing: ['budget.emergencyFundMonths'],
} satisfies InvestmentTimingDto;

/**
 * `invest`: the budget switch is off, so the amount is monthly income × the invest share + side
 * income: $19,500 × 50 % + $250 = $10,000. The plan is monthly (optimal $9,797.96); 17/08/2026 +
 * 30 days = Wed 16/09/2026 → Thu 17/09/2026, on or before today: consider investing (37 days since
 * the last buy).
 */
const TIMING_INVEST = {
  ...TIMING,
  monthlyInvestCents: 1000000,
  budget: {
    ...BUDGET,
    monthlyIncomeCents: 1950000,
    leftoverCents: 1600000,
    investmentRowCents: 800000,
    sideIncomeInvestCents: 25000,
    useBudget: false,
  },
  plan: { months: 1, parcelCents: 1000000, optimalParcelCents: 979796 },
  countdown: { state: 'invest', nextPurchaseDate: '2026-09-17', periodDays: 30 },
  hint: { assetClass: 'etf', instrumentId: 4, symbol: 'ASX:DEF', parcelCents: 1000000 },
} satisfies InvestmentTimingDto;

/** `cash_first`: planned spending exceeds income, so the investment row is negative. */
const TIMING_CASH_FIRST = {
  ...TIMING,
  monthlyInvestCents: -100000,
  budget: {
    ...BUDGET,
    monthlyIncomeCents: 380000,
    plannedSpendCents: 400000,
    leftoverCents: -20000,
    emergencyFundCents: 2400000,
    investmentRowCents: -100000,
    sideIncomeInvestCents: 0,
  },
  plan: null,
  countdown: { state: 'cash_first' },
  hint: { assetClass: 'etf', instrumentId: 4, symbol: 'ASX:DEF', parcelCents: null },
} satisfies InvestmentTimingDto;

/**
 * `split_off` (D46): the budget drives the amount and its automatic investment split is off, so the
 * investment row is $0 and the whole leftover ($3,000) goes to the cash row. With no side income
 * since the last buy there is nothing to invest, and no plan.
 */
const TIMING_SPLIT_OFF = {
  ...TIMING,
  monthlyInvestCents: 0,
  budget: { ...BUDGET, investmentRowCents: 0, sideIncomeInvestCents: 0 },
  plan: null,
  countdown: { state: 'split_off' },
  hint: { assetClass: 'etf', instrumentId: 4, symbol: 'ASX:DEF', parcelCents: null },
} satisfies InvestmentTimingDto;

/** `unavailable`: net pay, the emergency-fund months, budget items and snapshots are missing. */
const TIMING_UNAVAILABLE = {
  ...TIMING,
  monthlyInvestCents: null,
  budget: {
    ...BUDGET,
    monthlyIncomeCents: null,
    plannedSpendCents: 0,
    leftoverCents: null,
    emergencyFundCents: null,
    investmentRowCents: null,
    sideIncomeInvestCents: 0,
  },
  plan: null,
  countdown: { state: 'unavailable' },
  hint: { assetClass: 'etf', instrumentId: 4, symbol: 'ASX:DEF', parcelCents: null },
  missing: ['pay.netPayCents', 'budget.emergencyFundMonths', 'budget.items', 'snapshots'],
} satisfies InvestmentTimingDto;

/**
 * `below_emergency_fund`: cash ($8,000) is below the emergency fund ($21,000). The budget then puts
 * everything in cash (invest share 0), so there is nothing to invest (`cash_first`), and the
 * cash-deficit wait is deferred to Stage 3.
 */
const TIMING_BELOW_EMERGENCY_FUND = {
  ...TIMING,
  monthlyInvestCents: 0,
  budget: { ...BUDGET, investShareRatio: '0', investmentRowCents: 0, sideIncomeInvestCents: 0 },
  plan: null,
  countdown: { state: 'cash_first' },
  considerNext: {
    assetClass: 'cash',
    reason: 'below_emergency_fund',
    rows: CLASS_ROWS_BELOW_EMERGENCY_FUND,
  },
  hint: { assetClass: 'cash', instrumentId: null, symbol: null, parcelCents: null },
  deferred: ['cash_deficit_period'],
} satisfies InvestmentTimingDto;

/** `no_targets`: no class targets are set, so there is no suggestion and no invest amount. */
const TIMING_NO_TARGETS = {
  ...TIMING,
  monthlyInvestCents: null,
  budget: { ...BUDGET, investShareRatio: null, investmentRowCents: null, sideIncomeInvestCents: 0 },
  plan: null,
  countdown: { state: 'unavailable' },
  considerNext: { assetClass: null, reason: 'no_targets', rows: CLASS_ROWS_NO_TARGETS },
  hint: { assetClass: null, instrumentId: null, symbol: null, parcelCents: null },
  missing: [
    'allocation.etf',
    'allocation.stock',
    'allocation.crypto',
    'allocation.cash',
    'allocation.managedFund',
    'allocation.otherAssets',
  ],
} satisfies InvestmentTimingDto;

/** Nothing of this kind: no budget items, snapshots or buys yet, and no targets. */
const TIMING_EMPTY = {
  monthlyInvestCents: null,
  budget: {
    monthlyIncomeCents: null,
    plannedSpendCents: 0,
    leftoverCents: null,
    emergencyFundCents: null,
    investShareRatio: null,
    investmentRowCents: null,
    sideIncomeInvestCents: 0,
    useBudget: null,
    source: 'imported_budget',
  },
  plan: null,
  lastPurchaseDate: null,
  countdown: { state: 'unavailable' },
  considerNext: {
    assetClass: null,
    reason: 'no_targets',
    rows: (['etf', 'stock', 'crypto', 'cash', 'managed_fund', 'other_assets'] as const).map(
      (assetClass: AssetClass) => ({
        assetClass,
        valueCents: 0,
        currentRatio: '0',
        targetRatio: null,
        deltaRatio: null,
      }),
    ),
  },
  hint: { assetClass: null, instrumentId: null, symbol: null, parcelCents: null },
  missing: [
    'pay.netPayCents',
    'pay.frequency',
    'budget.useForInvestAmount',
    'budget.autoInvestSplit',
    'budget.emergencyFundMonths',
    'allocation.cash',
    'budget.items',
    'snapshots',
    'investments.lastPurchaseDate',
  ],
  deferred: [],
} satisfies InvestmentTimingDto;

// ─── Pages ──────────────────────────────────────────────────────────────────────────────────────

type PageParts = Omit<
  InvestmentPageResponse,
  'kind' | 'asOf' | 'generatedAt' | 'prices' | 'settings'
>;

function page(kind: InstrumentKind, parts: PageParts): InvestmentPageResponse {
  return {
    kind,
    asOf: INVESTMENT_FIXTURE_AS_OF,
    generatedAt: FIXTURE_NOW,
    prices: PRICES_LIVE,
    ...parts,
    settings: investmentSettings,
  };
}

/**
 * One populated page per kind:
 * - stock: ASX:ABC (held; a partly sold parcel), ASX:XYZ (held, first bought 45 days ago),
 *   ASX:GHI (watching, created in the app) and the exited ASX:OLD (a realised gain; its sell was
 *   larger than the parcels, so it is flagged oversold).
 * - etf: ASX:DEF ($0 default fee, auto-invest buys), ASX:MNO (regions add up to 90 %) and the
 *   exited ASX:XYZ (a realised loss). The full timing card lives here.
 * - managed_fund: EXAMPLEFUND (manual price, management fee, units with 6 dp) and the watched,
 *   never-bought EXAMPLEFUND2.
 * - crypto: BTC (rate fees; a rate default fee) and ETH (a flat-fee sell, staking rewards).
 */
export const investmentPages: Readonly<Record<InstrumentKind, InvestmentPageResponse>> = {
  stock: page('stock', {
    summary: STOCK_SUMMARY,
    holdings: STOCK_HOLDINGS,
    allocation: STOCK_ALLOCATION,
    realisedByFy: STOCK_REALISED_BY_FY,
    timing: classOnlyHint(TIMING),
    charts: STOCK_CHARTS,
  }),
  etf: page('etf', {
    summary: ETF_SUMMARY,
    holdings: ETF_HOLDINGS,
    allocation: ETF_ALLOCATION,
    realisedByFy: ETF_REALISED_BY_FY,
    timing: TIMING,
    charts: ETF_CHARTS,
  }),
  managed_fund: page('managed_fund', {
    summary: FUND_SUMMARY,
    holdings: FUND_HOLDINGS,
    allocation: FUND_ALLOCATION,
    realisedByFy: FUND_REALISED_BY_FY,
    timing: classOnlyHint(TIMING),
    charts: FUND_CHARTS,
  }),
  crypto: page('crypto', {
    summary: CRYPTO_SUMMARY,
    holdings: CRYPTO_HOLDINGS,
    allocation: CRYPTO_ALLOCATION,
    realisedByFy: CRYPTO_REALISED_BY_FY,
    timing: classOnlyHint(TIMING),
    charts: CRYPTO_CHARTS,
  }),
};

const EMPTY_SUMMARY = {
  valueCents: 0,
  costCents: 0,
  unrealisedCents: 0,
  dividendsHeldCents: 0,
  totalReturnCents: 0,
  totalReturnRatio: null,
  realisedCents: 0,
  realisedThisFyCents: 0,
  xirr: null,
  investmentRatePerMonthCents: null,
  dividendsThisFyCents: 0,
  dividendsAllTimeCents: 0,
  heldCount: 0,
  watchingCount: 0,
  exitedCount: 0,
  unpricedCount: 0,
  stalePriceCount: 0,
  targetSumRatio: '0',
  targetCount: 0,
  estMgmtFeeCents: null,
  lastBuyDate: null,
} satisfies InvestmentSummaryDto;

/** A kind with no instruments at all (no snapshots either, so no chart points). */
export function investmentPageEmpty(kind: InstrumentKind): InvestmentPageResponse {
  return page(kind, {
    summary: EMPTY_SUMMARY,
    holdings: [],
    allocation: {
      byHolding: [],
      bySector: kind === 'crypto' ? null : [],
      byRegion: kind === 'etf' || kind === 'managed_fund' ? [] : null,
    },
    realisedByFy: [
      { financialYear: FY_NOW, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
    ],
    timing: TIMING_EMPTY,
    charts: { unit: 'monthly', count: null, points: [] },
  });
}

/** ETFs: ASX:DEF has no price (failed, left out of the totals), ASX:MNO's price is stale. */
export const investmentPageUnpriced = page('etf', {
  summary: ETF_UNPRICED_SUMMARY,
  holdings: ETF_UNPRICED_HOLDINGS,
  allocation: ETF_UNPRICED_ALLOCATION,
  realisedByFy: ETF_UNPRICED_REALISED_BY_FY,
  timing: TIMING_ETF_UNPRICED,
  charts: ETF_UNPRICED_CHARTS,
});

/** Stocks: every held holding is unpriced (value $0, null XIRR, an empty current ring). */
export const investmentPageAllUnpriced = page('stock', {
  summary: STOCK_ALL_UNPRICED_SUMMARY,
  holdings: STOCK_ALL_UNPRICED_HOLDINGS,
  allocation: STOCK_ALL_UNPRICED_ALLOCATION,
  realisedByFy: STOCK_ALL_UNPRICED_REALISED_BY_FY,
  timing: classOnlyHint({
    ...TIMING,
    considerNext: { ...TIMING.considerNext, rows: CLASS_ROWS_STOCK_ALL_UNPRICED },
  }),
  charts: STOCK_ALL_UNPRICED_CHARTS,
});

/**
 * Managed funds with the null states: a null portfolio XIRR, a null 1Y rate (the only trade in the
 * last 12 months is today's), a null emergency fund, EXAMPLEFUND first bought today (under 90
 * days), the held but unwatched EXAMPLEFUND3, and the watched, fully sold EXAMPLEFUND2 that keeps
 * its realised gain and distributions.
 */
export const investmentPageNulls = page('managed_fund', {
  summary: FUND_NULLS_SUMMARY,
  holdings: FUND_NULLS_HOLDINGS,
  allocation: FUND_NULLS_ALLOCATION,
  realisedByFy: FUND_NULLS_REALISED_BY_FY,
  timing: TIMING_NO_EMERGENCY_FUND,
  charts: FUND_NULLS_CHARTS,
});

/** The next-buy states (ETFs page): one per countdown state and per consider-next reason. */
export const investmentPageTiming = {
  wait: investmentPages.etf,
  invest: { ...investmentPages.etf, timing: TIMING_INVEST },
  cash_first: { ...investmentPages.etf, timing: TIMING_CASH_FIRST },
  unavailable: { ...investmentPages.etf, timing: TIMING_UNAVAILABLE },
  below_emergency_fund: { ...investmentPages.etf, timing: TIMING_BELOW_EMERGENCY_FUND },
  no_targets: { ...investmentPages.etf, timing: TIMING_NO_TARGETS },
  split_off: { ...investmentPages.etf, timing: TIMING_SPLIT_OFF },
} satisfies Record<string, InvestmentPageResponse>;

/** Every page fixture (coverage and consistency tests). */
export const allInvestmentPageFixtures: readonly InvestmentPageResponse[] = [
  ...Object.values(investmentPages),
  ...(['stock', 'etf', 'managed_fund', 'crypto'] as const).map(investmentPageEmpty),
  investmentPageUnpriced,
  investmentPageAllUnpriced,
  investmentPageNulls,
  ...Object.values(investmentPageTiming),
];

// ─── Trade ledgers ──────────────────────────────────────────────────────────────────────────────

/**
 * Each kind's ledger, newest first. Covers a sell with short- and long-term parts and an oversold
 * sell (stock ASX:OLD), an imported out-of-order row and an app row (ETF ASX:DEF), rate fees and a
 * flat-fee sell (crypto).
 */
export const investmentTrades: Readonly<Record<InstrumentKind, InvestmentTradesResponse>> = {
  stock: { kind: 'stock', asOf: INVESTMENT_FIXTURE_AS_OF, trades: STOCK_TRADES },
  etf: { kind: 'etf', asOf: INVESTMENT_FIXTURE_AS_OF, trades: ETF_TRADES },
  managed_fund: { kind: 'managed_fund', asOf: INVESTMENT_FIXTURE_AS_OF, trades: FUND_TRADES },
  crypto: { kind: 'crypto', asOf: INVESTMENT_FIXTURE_AS_OF, trades: CRYPTO_TRADES },
};

// ─── Instruments ─────────────────────────────────────────────────────────────────────────────────

/** Every instrument of the populated pages, by id. */
// prettier-ignore
export const instrumentDtoById: Readonly<Record<number, InstrumentDto>> = {
  1: { id: 1, kind: 'stock', symbol: 'ASX:ABC', exchange: 'ASX', code: 'ABC', name: 'ABC Example Ltd', quoteCurrency: 'AUD', watched: true, sortOrder: 1, targetRatio: '0.5', sector: 'Materials', location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: 6, drp: false, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: null, origin: 'import', sheetRef: 'Stocks!A2', price: { price: '12.5', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, tradeCount: 4, dividendCount: 3 },
  11: { id: 11, kind: 'stock', symbol: 'ASX:XYZ', exchange: 'ASX', code: 'XYZ', name: 'XYZ Example Ltd', quoteCurrency: 'AUD', watched: true, sortOrder: 2, targetRatio: '0.3', sector: 'Energy', location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: 6, drp: false, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: null, origin: 'import', sheetRef: 'Stocks!A3', price: { price: '4.5', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, tradeCount: 1, dividendCount: 0 },
  13: { id: 13, kind: 'stock', symbol: 'ASX:GHI', exchange: 'ASX', code: 'GHI', name: 'GHI Example Ltd', quoteCurrency: 'AUD', watched: true, sortOrder: 3, targetRatio: '0.2', sector: 'Health care', location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: null, drp: null, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: 'Watching for a dip', origin: 'app', sheetRef: null, price: { price: '20', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, tradeCount: 0, dividendCount: 0 },
  2: { id: 2, kind: 'stock', symbol: 'ASX:OLD', exchange: 'ASX', code: 'OLD', name: null, quoteCurrency: 'AUD', watched: false, sortOrder: 4, targetRatio: null, sector: null, location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: null, drp: null, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: null, origin: 'import', sheetRef: 'Stocks!A30', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, tradeCount: 3, dividendCount: 0 },
  4: { id: 4, kind: 'etf', symbol: 'ASX:DEF', exchange: 'ASX', code: 'DEF', name: 'DEF Example ETF', quoteCurrency: 'AUD', watched: true, sortOrder: 1, targetRatio: '0.6', sector: 'Global shares', location: 'Global', mgmtFeeRatio: '0.0007', regions: { us: '0.6', asia: '0.1', aus: '0.2', other: '0.1' }, dividendFreqMonths: 3, drp: true, defaultFee: { kind: 'flat', cents: 0 }, effectiveDefaultFee: { kind: 'flat', cents: 0 }, note: 'Auto-invest', origin: 'import', sheetRef: 'ETFs!A2', price: { price: '62', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, tradeCount: 3, dividendCount: 2 },
  12: { id: 12, kind: 'etf', symbol: 'ASX:MNO', exchange: 'ASX', code: 'MNO', name: 'MNO Example ETF', quoteCurrency: 'AUD', watched: true, sortOrder: 2, targetRatio: '0.4', sector: 'Australian shares', location: 'Australia', mgmtFeeRatio: '0.002', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: null }, dividendFreqMonths: 6, drp: false, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: null, origin: 'import', sheetRef: 'ETFs!A3', price: { price: '110', status: 'fresh', source: 'yahoo', asOf: '2026-09-24T04:00:00.000Z', lastError: null }, tradeCount: 1, dividendCount: 1 },
  3: { id: 3, kind: 'etf', symbol: 'ASX:XYZ', exchange: 'ASX', code: 'XYZ', name: 'XYZ Example ETF', quoteCurrency: 'AUD', watched: false, sortOrder: 3, targetRatio: null, sector: 'Global shares', location: 'Global', mgmtFeeRatio: '0.002', regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' }, dividendFreqMonths: 3, drp: false, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 1000 }, note: null, origin: 'import', sheetRef: 'ETFs!A30', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, tradeCount: 2, dividendCount: 1 },
  5: { id: 5, kind: 'managed_fund', symbol: 'EXAMPLEFUND', exchange: null, code: 'EXAMPLEFUND', name: 'Example Managed Fund', quoteCurrency: 'AUD', watched: true, sortOrder: 1, targetRatio: '1', sector: 'Diversified', location: 'Australia', mgmtFeeRatio: '0.008', regions: { us: '0.4', asia: '0.1', aus: '0.4', other: '0.1' }, dividendFreqMonths: 12, drp: true, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 0 }, note: null, origin: 'import', sheetRef: 'Managed Funds!A2', price: { price: '1.5', status: 'manual', source: 'manual', asOf: '2026-09-21', lastError: null }, tradeCount: 2, dividendCount: 2 },
  6: { id: 6, kind: 'managed_fund', symbol: 'EXAMPLEFUND2', exchange: null, code: 'EXAMPLEFUND2', name: 'Example Managed Fund 2', quoteCurrency: 'AUD', watched: true, sortOrder: 2, targetRatio: null, sector: null, location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: null, drp: null, defaultFee: null, effectiveDefaultFee: { kind: 'flat', cents: 0 }, note: null, origin: 'import', sheetRef: 'Managed Funds!A3', price: { price: null, status: 'none', source: null, asOf: null, lastError: null }, tradeCount: 0, dividendCount: 0 },
  7: { id: 7, kind: 'crypto', symbol: 'BTC', exchange: null, code: 'BTC', name: null, quoteCurrency: 'AUD', watched: true, sortOrder: 1, targetRatio: '0.7', sector: null, location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: null, drp: null, defaultFee: { kind: 'rate', rate: '0.0025' }, effectiveDefaultFee: { kind: 'rate', rate: '0.0025' }, note: null, origin: 'import', sheetRef: 'Crypto!A2', price: { price: '160000', status: 'fresh', source: 'coingecko', asOf: '2026-09-24T04:10:00.000Z', lastError: null }, tradeCount: 2, dividendCount: 0 },
  8: { id: 8, kind: 'crypto', symbol: 'ETH', exchange: null, code: 'ETH', name: null, quoteCurrency: 'AUD', watched: true, sortOrder: 2, targetRatio: '0.3', sector: null, location: null, mgmtFeeRatio: null, regions: { us: null, asia: null, aus: null, other: null }, dividendFreqMonths: 2, drp: null, defaultFee: null, effectiveDefaultFee: { kind: 'rate', rate: '0.005' }, note: null, origin: 'import', sheetRef: 'Crypto!A3', price: { price: '4000', status: 'fresh', source: 'coingecko', asOf: '2026-09-24T04:10:00.000Z', lastError: null }, tradeCount: 2, dividendCount: 2 },
};

/** One per kind, with and without a holding default fee (ETF $0 flat, crypto a rate). */
export const instrumentDtos: Readonly<Record<InstrumentKind, InstrumentDto>> = {
  stock: instrumentDtoById[1]!,
  etf: instrumentDtoById[4]!,
  managed_fund: instrumentDtoById[5]!,
  crypto: instrumentDtoById[7]!,
};

// ─── Holding details ──────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const LOTS_1 = [
  { tradeId: 103, tradeDate: '2024-06-03', units: '20', remainingUnits: '0', price: '8', feeCents: 1000, remainingCostCents: 0, unrealisedCents: null, unrealisedRatio: null, heldDays: 843, termIfSoldToday: 'long', status: 'closed' },
  { tradeId: 104, tradeDate: '2025-01-15', units: '100', remainingUnits: '60', price: '10', feeCents: 1000, remainingCostCents: 60600, unrealisedCents: 14400, unrealisedRatio: '0.144', heldDays: 617, termIfSoldToday: 'long', status: 'open' },
  { tradeId: 106, tradeDate: '2025-06-16', units: '50', remainingUnits: '50', price: '12', feeCents: 1000, remainingCostCents: 61000, unrealisedCents: 1500, unrealisedRatio: '0.025', heldDays: 465, termIfSoldToday: 'long', status: 'open' },
] satisfies LotRowDto[];

// prettier-ignore
const DISPOSALS_1 = [
  { sellTradeId: 107, lotTradeId: 103, sellDate: '2026-08-05', acquiredDate: '2024-06-03', units: '20', proceedsCents: 27667, costCents: 17000, gainCents: 10667, term: 'long', financialYear: 2026 },
  { sellTradeId: 107, lotTradeId: 104, sellDate: '2026-08-05', acquiredDate: '2025-01-15', units: '40', proceedsCents: 55333, costCents: 40400, gainCents: 14933, term: 'long', financialYear: 2026 },
] satisfies DisposalRowDto[];

// prettier-ignore
const DIVIDENDS_1 = [
  { id: 201, paymentDate: '2025-09-20', exDate: '2025-08-25', reinvested: false, netAmountCents: 3000, priceAtEx: '11', unitsAtEx: '170', yieldRatio: '0.0160427807487', origin: 'import', sheetRef: 'Dividends!A4' },
  { id: 203, paymentDate: '2026-03-20', exDate: '2026-02-25', reinvested: false, netAmountCents: 3300, priceAtEx: '11.5', unitsAtEx: '170', yieldRatio: '0.0168797953964', origin: 'import', sheetRef: 'Dividends!A6' },
  { id: 204, paymentDate: '2026-09-10', exDate: '2026-08-20', reinvested: false, netAmountCents: 3500, priceAtEx: '12', unitsAtEx: '110', yieldRatio: '0.0265151515152', origin: 'import', sheetRef: 'Dividends!A9' },
] satisfies HoldingDividendDto[];

// prettier-ignore
const LOTS_3 = [
  { tradeId: 111, tradeDate: '2023-08-01', units: '20', remainingUnits: '0', price: '80', feeCents: 1000, remainingCostCents: 0, unrealisedCents: null, unrealisedRatio: null, heldDays: 1150, termIfSoldToday: 'long', status: 'closed' },
] satisfies LotRowDto[];

// prettier-ignore
const DISPOSALS_3 = [
  { sellTradeId: 114, lotTradeId: 111, sellDate: '2025-12-01', acquiredDate: '2023-08-01', units: '20', proceedsCents: 139000, costCents: 161000, gainCents: -22000, term: 'long', financialYear: 2025 },
] satisfies DisposalRowDto[];

// prettier-ignore
const DIVIDENDS_3 = [
  { id: 211, paymentDate: '2024-07-15', exDate: '2024-06-28', reinvested: false, netAmountCents: 4000, priceAtEx: '82', unitsAtEx: '20', yieldRatio: '0.0243902439024', origin: 'import', sheetRef: 'Dividends!A7' },
] satisfies HoldingDividendDto[];

// prettier-ignore
const LOTS_4 = [
  { tradeId: 113, tradeDate: '2025-05-20', units: '10', remainingUnits: '10', price: '50', feeCents: 0, remainingCostCents: 50000, unrealisedCents: 12000, unrealisedRatio: '0.24', heldDays: 492, termIfSoldToday: 'long', status: 'open' },
  { tradeId: 115, tradeDate: '2026-02-10', units: '10', remainingUnits: '10', price: '55', feeCents: 0, remainingCostCents: 55000, unrealisedCents: 7000, unrealisedRatio: '0.127272727273', heldDays: 226, termIfSoldToday: 'short', status: 'open' },
  { tradeId: 116, tradeDate: '2026-08-18', units: '12', remainingUnits: '12', price: '60', feeCents: 0, remainingCostCents: 72000, unrealisedCents: 2400, unrealisedRatio: '0.0333333333333', heldDays: 37, termIfSoldToday: 'short', status: 'open' },
] satisfies LotRowDto[];

// prettier-ignore
const DISPOSALS_4 = [
] satisfies DisposalRowDto[];

// prettier-ignore
const DIVIDENDS_4 = [
  { id: 213, paymentDate: '2026-01-15', exDate: '2025-12-31', reinvested: true, netAmountCents: 2500, priceAtEx: '54', unitsAtEx: '10', yieldRatio: '0.0462962962963', origin: 'import', sheetRef: 'Dividends!A10' },
  { id: 214, paymentDate: '2026-07-15', exDate: '2026-06-30', reinvested: true, netAmountCents: 2800, priceAtEx: '58', unitsAtEx: '20', yieldRatio: '0.0241379310345', origin: 'import', sheetRef: 'Dividends!A11' },
] satisfies HoldingDividendDto[];

// prettier-ignore
const LOTS_5 = [
  { tradeId: 121, tradeDate: '2024-09-10', units: '1000', remainingUnits: '1000', price: '1.4', feeCents: 0, remainingCostCents: 140000, unrealisedCents: 10000, unrealisedRatio: '0.0714285714286', heldDays: 744, termIfSoldToday: 'long', status: 'open' },
  { tradeId: 122, tradeDate: '2025-10-10', units: '500.123456', remainingUnits: '500.123456', price: '1.45', feeCents: 0, remainingCostCents: 72518, unrealisedCents: 2501, unrealisedRatio: '0.0344827586207', heldDays: 349, termIfSoldToday: 'short', status: 'open' },
] satisfies LotRowDto[];

// prettier-ignore
const DISPOSALS_5 = [
] satisfies DisposalRowDto[];

// prettier-ignore
const DIVIDENDS_5 = [
  { id: 221, paymentDate: '2025-07-01', exDate: '2025-06-30', reinvested: false, netAmountCents: 4500, priceAtEx: '1.42', unitsAtEx: '1000', yieldRatio: '0.0316901408451', origin: 'import', sheetRef: 'Dividends!A12' },
  { id: 222, paymentDate: '2026-07-01', exDate: '2026-06-30', reinvested: false, netAmountCents: 6000, priceAtEx: '1.48', unitsAtEx: '1500.123456', yieldRatio: '0.0270248027777', origin: 'import', sheetRef: 'Dividends!A13' },
] satisfies HoldingDividendDto[];

// prettier-ignore
const LOTS_8 = [
  { tradeId: 132, tradeDate: '2025-03-03', units: '1.25', remainingUnits: '1', price: '3000', feeCents: 1875, remainingCostCents: 301500, unrealisedCents: 98500, unrealisedRatio: '0.262666666667', heldDays: 570, termIfSoldToday: 'long', status: 'open' },
] satisfies LotRowDto[];

// prettier-ignore
const DISPOSALS_8 = [
  { sellTradeId: 134, lotTradeId: 132, sellDate: '2026-04-10', acquiredDate: '2025-03-03', units: '0.25', proceedsCents: 104500, costCents: 75375, gainCents: 29125, term: 'long', financialYear: 2025 },
] satisfies DisposalRowDto[];

// prettier-ignore
const DIVIDENDS_8 = [
  { id: 231, paymentDate: '2026-06-30', exDate: '2026-06-30', reinvested: false, netAmountCents: 1200, priceAtEx: '4100', unitsAtEx: '1', yieldRatio: '0.00292682926829', origin: 'import', sheetRef: 'Dividends!A14' },
  { id: 232, paymentDate: '2026-08-31', exDate: '2026-08-31', reinvested: false, netAmountCents: 1500, priceAtEx: '3900', unitsAtEx: '1', yieldRatio: '0.00384615384615', origin: 'import', sheetRef: 'Dividends!A15' },
] satisfies HoldingDividendDto[];

function detail(
  kind: InstrumentKind,
  id: number,
  lots: LotRowDto[],
  disposals: DisposalRowDto[],
  dividends: HoldingDividendDto[],
): HoldingDetailResponse {
  const holding = investmentPages[kind].holdings.find((h) => h.instrumentId === id);
  const instrument = instrumentDtoById[id];
  if (!holding || !instrument) throw new Error(`fixtures: no holding ${id}`);
  return {
    asOf: INVESTMENT_FIXTURE_AS_OF,
    instrument,
    holding,
    lots,
    disposals,
    trades: investmentTrades[kind].trades.filter((t) => t.instrumentId === id),
    dividends,
  };
}

/**
 * Holding details by instrument id: a held stock with closed, partly sold and open parcels and
 * two disposals (1), an exited ETF with a realised loss (3), the $0-fee auto-invest ETF with an
 * app-entered buy (4), a managed fund with 6-dp units (5) and a coin with staking rewards and
 * yields (8).
 */
export const holdingDetails: Readonly<Record<number, HoldingDetailResponse>> = {
  1: detail('stock', 1, LOTS_1, DISPOSALS_1, DIVIDENDS_1),
  3: detail('etf', 3, LOTS_3, DISPOSALS_3, DIVIDENDS_3),
  4: detail('etf', 4, LOTS_4, DISPOSALS_4, DIVIDENDS_4),
  5: detail('managed_fund', 5, LOTS_5, DISPOSALS_5, DIVIDENDS_5),
  8: detail('crypto', 8, LOTS_8, DISPOSALS_8, DIVIDENDS_8),
};

// ─── Mutations ─────────────────────────────────────────────────────────────────────────────────

/** `POST /api/trades` → 201: the app-entered ASX:DEF buy as the engine recomputes it. */
export const tradeMutationResponse = {
  trade: ETF_TRADES.find((t) => t.id === 116)!,
} satisfies TradeMutationResponse;

export const deletedResponse = { id: 116 } satisfies DeletedResponse;

/** Request bodies as the web sends them: units mode, amount mode (D38) and a crypto rate fee. */
export const tradeInputExamples = {
  units: {
    instrumentId: 1,
    side: 'buy',
    tradeDate: '2026-09-24',
    quantity: { mode: 'units', units: '10' },
    price: '12.5',
    fee: { kind: 'flat', cents: 1000 },
    note: '',
  },
  amount: {
    instrumentId: 4,
    side: 'buy',
    tradeDate: '2026-09-24',
    quantity: { mode: 'amount', amountCents: 50000 },
    price: '62',
    fee: { kind: 'flat', cents: 0 },
    note: 'Auto-invest buy',
  },
  cryptoRate: {
    instrumentId: 7,
    side: 'sell',
    tradeDate: '2026-09-23',
    quantity: { mode: 'units', units: '0.01' },
    price: '160000',
    fee: { kind: 'rate', rate: '0.0025' },
  },
} satisfies Record<string, TradeInputBody>;
