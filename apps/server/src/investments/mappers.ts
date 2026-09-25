// Engine results and DB rows → the frozen investment DTOs (stage-2.md §4.4). The server adds only
// display fields (symbol, name, note, price info, the effective default fee and the settings);
// every figure comes from the engine.
import type {
  AllocationSliceResult,
  DisposalResult,
  DividendResult,
  FyRealisedRow,
  HoldingResult,
  LotResult,
  SummaryResult,
  TradeResult,
} from '@joinr/engine';
import {
  effectiveDefaultFee,
  JoinrDecimal,
  multiplyToCents,
  normaliseDecimal,
  parseReviewFlags,
  REVIEW_FLAGS,
  tradeFeeCents,
  type AllocationSliceDto,
  type DisposalRowDto,
  type FeeSpec,
  type HoldingDividendDto,
  type HoldingRowDto,
  type InstrumentDto,
  type InstrumentKind,
  type InvestmentSettingsDto,
  type InvestmentSummaryDto,
  type LotRowDto,
  type PriceInfoDto,
  type PriceItem,
  type RealisedFyRowDto,
  type RegionsDto,
  type ReviewFlag,
  type TradeRowDto,
} from '@joinr/schema';
import { numberSetting, stringSetting, type SettingsValues } from '../db/queries/settings';
import type { DividendRow, InstrumentRow, TradeRow } from './load';

const KINDS_WITH_REGIONS: ReadonlySet<InstrumentKind> = new Set(['etf', 'managed_fund']);

/** PriceItem → PriceInfoDto; an instrument the price service does not list has no price. */
export function priceInfoDto(item: PriceItem | undefined): PriceInfoDto {
  if (!item) return { price: null, status: 'none', source: null, asOf: null, lastError: null };
  return {
    price: item.price,
    status: item.status,
    source: item.priceSource,
    asOf: item.asOf,
    lastError: item.lastError,
  };
}

export function regionsDto(r: InstrumentRow): RegionsDto {
  return {
    us: r.regionUsRatio,
    asia: r.regionAsiaRatio,
    aus: r.regionAusRatio,
    other: r.regionOtherRatio,
  };
}

/** The holding's own default fee (D38): a rate (crypto only), a flat fee, or null. */
export function ownDefaultFee(r: InstrumentRow): FeeSpec | null {
  if (r.kind === 'crypto' && r.defaultFeeRate !== null) {
    return { kind: 'rate', rate: r.defaultFeeRate };
  }
  if (r.defaultFeeCents !== null) return { kind: 'flat', cents: r.defaultFeeCents };
  return null;
}

/** The global fee defaults the trade form falls back to. */
export function feeSettings(s: SettingsValues | null): {
  defaultBrokerageCents: number | null;
  cryptoFeeRate: string | null;
} {
  return {
    defaultBrokerageCents: s ? numberSetting(s, 'investing.defaultBrokerageCents') : null,
    cryptoFeeRate: s ? stringSetting(s, 'crypto.feeRate') : null,
  };
}

/** What the trade form pre-fills for this holding (§2.3). */
export function effectiveFeeOf(r: InstrumentRow, s: SettingsValues | null): FeeSpec {
  return effectiveDefaultFee(
    { kind: r.kind, defaultFeeCents: r.defaultFeeCents, defaultFeeRate: r.defaultFeeRate },
    feeSettings(s),
  );
}

export function settingsDto(s: SettingsValues): InvestmentSettingsDto {
  return {
    defaultBrokerageCents: numberSetting(s, 'investing.defaultBrokerageCents'),
    cryptoFeeRate: stringSetting(s, 'crypto.feeRate'),
    etfLimit: numberSetting(s, 'investing.etfLimit'),
  };
}

export function instrumentDto(
  r: InstrumentRow,
  o: {
    price: PriceItem | undefined;
    settings: SettingsValues | null;
    tradeCount: number;
    dividendCount: number;
  },
): InstrumentDto {
  return {
    id: r.id,
    kind: r.kind,
    symbol: r.symbol,
    exchange: r.exchange,
    code: r.code,
    name: r.name,
    quoteCurrency: r.quoteCurrency,
    watched: r.isWatched,
    sortOrder: r.sortOrder,
    targetRatio: r.targetRatio,
    sector: r.sector,
    location: r.location,
    mgmtFeeRatio: r.mgmtFeeRatio,
    regions: regionsDto(r),
    dividendFreqMonths: r.dividendFreqMonths,
    drp: r.drp,
    defaultFee: ownDefaultFee(r),
    effectiveDefaultFee: effectiveFeeOf(r, o.settings),
    note: r.note,
    origin: r.origin,
    sheetRef: r.sheetRef,
    price: priceInfoDto(o.price),
    tradeCount: o.tradeCount,
    dividendCount: o.dividendCount,
  };
}

export function holdingRowDto(
  r: InstrumentRow,
  h: HoldingResult,
  price: PriceItem | undefined,
  settings: SettingsValues,
): HoldingRowDto {
  return {
    instrumentId: r.id,
    kind: r.kind,
    symbol: r.symbol,
    name: r.name,
    note: r.note,
    watched: r.isWatched,
    status: h.status,
    flags: [...h.flags],
    units: h.openUnits,
    price: priceInfoDto(price),
    valueCents: h.valueCents,
    costCents: h.costCents,
    unrealisedCents: h.unrealisedCents,
    dividendsCents: h.dividendsCents,
    totalReturnCents: h.totalReturnCents,
    totalReturnRatio: h.totalReturnRatio,
    realisedCents: h.realisedCents,
    xirr: h.xirr,
    averagePrice: h.averagePrice,
    currentRatio: h.currentRatio,
    targetRatio: h.targetRatio,
    differenceRatio: h.differenceRatio,
    dividendYieldRatio: h.dividendYieldRatio,
    sector: r.sector,
    regions: KINDS_WITH_REGIONS.has(r.kind) ? regionsDto(r) : null,
    mgmtFeeRatio: r.mgmtFeeRatio,
    estMgmtFeeCents: h.estMgmtFeeCents,
    lastBuyDate: h.lastBuyDate,
    lastTradeDate: h.lastTradeDate,
    effectiveDefaultFee: effectiveFeeOf(r, settings),
  };
}

const STATUS_ORDER = { held: 0, watching: 1, exited: 2 } as const;

/** Held, then watching, then exited; the engine's order (sortOrder, id) within each group. */
export function sortHoldings<T extends { status: HoldingResult['status'] }>(
  holdings: readonly T[],
): T[] {
  return holdings
    .map((h, i) => ({ h, i }))
    .sort((a, b) => STATUS_ORDER[a.h.status] - STATUS_ORDER[b.h.status] || a.i - b.i)
    .map((x) => x.h);
}

/** = SummaryResult, field for field. */
export function summaryDto(s: SummaryResult): InvestmentSummaryDto {
  return {
    valueCents: s.valueCents,
    costCents: s.costCents,
    unrealisedCents: s.unrealisedCents,
    dividendsHeldCents: s.dividendsHeldCents,
    totalReturnCents: s.totalReturnCents,
    totalReturnRatio: s.totalReturnRatio,
    realisedCents: s.realisedCents,
    realisedThisFyCents: s.realisedThisFyCents,
    xirr: s.xirr,
    investmentRatePerMonthCents: s.investmentRatePerMonthCents,
    dividendsThisFyCents: s.dividendsThisFyCents,
    dividendsAllTimeCents: s.dividendsAllTimeCents,
    heldCount: s.heldCount,
    watchingCount: s.watchingCount,
    exitedCount: s.exitedCount,
    unpricedCount: s.unpricedCount,
    stalePriceCount: s.stalePriceCount,
    targetSumRatio: s.targetSumRatio,
    targetCount: s.targetCount,
    estMgmtFeeCents: s.estMgmtFeeCents,
    lastBuyDate: s.lastBuyDate,
  };
}

export function sliceDto(s: AllocationSliceResult): AllocationSliceDto {
  return { key: s.key, label: s.label, currentRatio: s.currentRatio, targetRatio: s.targetRatio };
}

export function realisedFyDto(r: FyRealisedRow): RealisedFyRowDto {
  return {
    financialYear: r.financialYear,
    shortTermCents: r.shortTermCents,
    longTermCents: r.longTermCents,
    totalCents: r.totalCents,
    disposals: r.disposals,
  };
}

// ─── Trades ─────────────────────────────────────────────────────────────────────────────────────

const FLAG_ORDER = new Map<ReviewFlag, number>(REVIEW_FLAGS.map((f, i) => [f, i]));

/**
 * A trade's review flags: the stored review flags except `oversell`, ∪ the live `oversell`,
 * deduplicated, in REVIEW_FLAGS order. `oversell` is live-only (§3.3; Scaffold note 2026-09-25 —
 * Fixer): an importer-written `oversell` can go stale (a same-day sell entered before its buy, or
 * an oversold sell fixed later by adding the missing buy), so the engine's FIFO decides it. The
 * Records view keeps the raw stored flags.
 */
export function tradeFlags(stored: string | null, oversold: boolean): ReviewFlag[] {
  let flags: ReviewFlag[];
  try {
    flags = parseReviewFlags(stored);
  } catch {
    flags = []; // a malformed column should not break the ledger
  }
  const set = new Set(flags);
  set.delete('oversell');
  if (oversold) set.add('oversell');
  return [...set].sort((a, b) => (FLAG_ORDER.get(a) ?? 0) - (FLAG_ORDER.get(b) ?? 0));
}

/** The fee as stored: a rate when `fee_rate` is set, else the flat cents. */
export function storedFee(t: TradeRow): FeeSpec {
  return t.feeRate !== null
    ? { kind: 'rate', rate: t.feeRate }
    : { kind: 'flat', cents: t.feeCents };
}

function isPositive(v: string | null): boolean {
  return v !== null && new JoinrDecimal(v).greaterThan(0);
}

/**
 * A ledger row. `result` is the engine's TradeResult; a row the engine skipped (e.g. zero units)
 * still shows with its side from the sign, its order value and its fee, and null results.
 */
export function tradeRowDto(
  t: TradeRow,
  instrument: InstrumentRow,
  result: TradeResult | undefined,
): TradeRowDto {
  const units = new JoinrDecimal(t.units);
  const side = result?.side ?? (units.isNegative() ? 'sell' : 'buy');
  const absUnits = normaliseDecimal(units.abs());
  const feeInput = { units: t.units, price: t.price, feeCents: t.feeCents, feeRate: t.feeRate };
  return {
    id: t.id,
    instrumentId: t.instrumentId,
    symbol: instrument.symbol,
    kind: instrument.kind,
    tradeDate: t.tradeDate,
    side,
    units: absUnits,
    price: t.price,
    orderValueCents: result?.orderValueCents ?? multiplyToCents(absUnits, t.price),
    fee: storedFee(t),
    feeCents: result?.feeCents ?? tradeFeeCents(feeInput),
    seq: t.seq,
    origin: t.origin,
    sheetRef: t.sheetRef,
    note: t.note,
    flags: tradeFlags(t.reviewFlags, isPositive(result?.oversoldUnits ?? null)),
    correctionId: t.correctionId,
    remainingUnits: result?.remainingUnits ?? null,
    unrealisedCents: result?.unrealisedCents ?? null,
    realisedCents: result?.realisedCents ?? null,
    realisedShortCents: result?.realisedShortCents ?? null,
    realisedLongCents: result?.realisedLongCents ?? null,
    oversoldUnits: result?.oversoldUnits ?? null,
  };
}

/** Newest first: date desc, seq desc, id desc (§4.2). */
export function compareTradesNewestFirst(a: TradeRow, b: TradeRow): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? 1 : -1;
  if (a.seq !== b.seq) return b.seq - a.seq;
  return b.id - a.id;
}

// ─── Holding detail ─────────────────────────────────────────────────────────────────────────────

export function lotRowDto(l: LotResult): LotRowDto {
  return {
    tradeId: l.tradeId,
    tradeDate: l.tradeDate,
    units: l.units,
    remainingUnits: l.remainingUnits,
    price: l.price,
    feeCents: l.feeCents,
    remainingCostCents: l.remainingCostCents,
    unrealisedCents: l.unrealisedCents,
    unrealisedRatio: l.unrealisedRatio,
    heldDays: l.heldDays,
    termIfSoldToday: l.termIfSoldToday,
    status: isPositive(l.remainingUnits) ? 'open' : 'closed',
  };
}

export function disposalRowDto(d: DisposalResult): DisposalRowDto {
  return {
    sellTradeId: d.sellTradeId,
    lotTradeId: d.lotTradeId,
    sellDate: d.sellDate,
    acquiredDate: d.acquiredDate,
    units: d.units,
    proceedsCents: d.proceedsCents,
    costCents: d.costCents,
    gainCents: d.gainCents,
    term: d.term,
    financialYear: d.financialYear,
  };
}

export function holdingDividendDto(
  d: DividendRow,
  result: DividendResult | undefined,
): HoldingDividendDto {
  return {
    id: d.id,
    paymentDate: d.paymentDate,
    exDate: d.exDate,
    reinvested: d.reinvested,
    netAmountCents: d.netAmountCents,
    priceAtEx: d.priceAtEx,
    unitsAtEx: result?.unitsAtEx ?? null,
    yieldRatio: result?.yieldRatio ?? null,
    origin: d.origin,
    sheetRef: d.sheetRef,
  };
}
