// computeInvestments (stage-2.md §2.4–§2.10, §2.13): lots and disposals, per-holding metrics,
// the portfolio summary, allocation, dividend and staking metrics and the FY realised table for
// one instrument kind. Pure: every "today" is `asOf`; data problems are flagged, never thrown.
import {
  decimalFromNumber,
  financialYearOfIso,
  HOLDING_FLAGS,
  type DecimalString,
  type HoldingFlag,
  type HoldingStatus,
  type InstrumentKind,
  type IsoDate,
  type PriceStatus,
} from '@joinr/schema';
import {
  capitalGainTerm,
  processLedger,
  type Disposal,
  type OpenLot,
  type SellOutcome,
} from './lots';
import {
  centsOf,
  dayNumber,
  daysBetween,
  dec,
  decimalString,
  dollarsOf,
  isSafeCents,
  maxDec,
  ONE,
  priceString,
  ratioString,
  roundUpAway,
  sum,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import { paymentMetrics } from './dividends';
import { fyRowsFromGains } from './realised';
import type {
  AllocationResult,
  AllocationSliceResult,
  Cents,
  DisposalResult,
  DividendResult,
  EngineDividend,
  EngineInstrument,
  EngineTrade,
  HoldingResult,
  InvestmentsInput,
  InvestmentsResult,
  LotResult,
  SummaryResult,
  TradeResult,
} from './types';
import { xirrRate, type XirrFlow } from './xirr';

/** The sheet's month length in the 1Y investment rate (Stocks H18). */
const DAYS_PER_MONTH = '30.416';
const DAYS_PER_YEAR = 365;
const MGMT_FEE_KINDS: ReadonlySet<InstrumentKind> = new Set(['etf', 'managed_fund']);
const REGION_KINDS: ReadonlySet<InstrumentKind> = new Set(['etf', 'managed_fund']);
const REGIONS = [
  { key: 'us', label: 'US' },
  { key: 'asia', label: 'Asia' },
  { key: 'aus', label: 'Australia' },
  { key: 'other', label: 'EU/Other' },
] as const;
const UNASSIGNED = { key: 'unassigned', label: 'Unassigned' } as const;

/** The per-instrument working state. */
interface Holding {
  inst: EngineInstrument;
  trades: EngineTrade[];
  lots: OpenLot[];
  sells: SellOutcome[];
  disposals: Disposal[];
  dividends: EngineDividend[];
  netUnits: Dec;
  openUnits: Dec;
  price: Dec | null;
  priceStatus: PriceStatus;
  held: boolean;
  status: HoldingStatus;
  value: Dec | null;
  cost: Dec;
  unrealised: Dec | null;
  dividendsCents: Cents;
  totalReturn: Dec | null;
  current: Dec | null;
  target: Dec | null;
}

function lotCostLeft(lot: OpenLot): Dec {
  return lot.price.times(lot.remaining).plus(lot.fee.times(lot.remaining).div(lot.units));
}

function lotUnrealised(lot: OpenLot, price: Dec): Dec {
  return price
    .minus(lot.price)
    .times(lot.remaining)
    .minus(lot.fee.times(lot.remaining).div(lot.units));
}

/** A flow list's XIRR as a 12-significant-digit ratio string, or null. */
function xirrString(flows: readonly XirrFlow[]): DecimalString | null {
  const rate = xirrRate(flows.filter((f) => f.amount !== 0));
  return rate === null ? null : decimalFromNumber(rate);
}

function tradeFlows(
  trades: readonly EngineTrade[],
  units: ReadonlyMap<number, Dec>,
  prices: ReadonlyMap<number, Dec>,
): XirrFlow[] {
  return trades.map((t) => ({
    amount: units.get(t.id)!.times(prices.get(t.id)!).neg().toNumber(),
    date: t.tradeDate,
  }));
}

function dividendFlows(dividends: readonly EngineDividend[]): XirrFlow[] {
  return dividends.map((d) => ({
    amount: dollarsOf(d.netAmountCents).toNumber(),
    date: d.paymentDate,
  }));
}

function effectivePrice(
  input: InvestmentsInput,
  id: number,
): { price: Dec | null; status: PriceStatus } {
  const p = input.prices.get(id);
  if (!p) return { price: null, status: 'none' };
  if (p.price === null) return { price: null, status: p.status };
  const d = dec(p.price, `price of instrument ${id}`);
  // A zero or negative price is a data problem: the holding is treated as unpriced (flagged).
  return { price: d.greaterThan(0) ? d : null, status: p.status };
}

function maxIso(dates: readonly IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

function compareSlices(
  a: { current: Dec; target: Dec; label: string },
  b: { current: Dec; target: Dec; label: string },
): number {
  const c = b.current.comparedTo(a.current);
  if (c !== 0) return c;
  const t = b.target.comparedTo(a.target);
  if (t !== 0) return t;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

function slices(
  rows: { key: string; label: string; current: Dec; target: Dec }[],
): AllocationSliceResult[] {
  return [...rows].sort(compareSlices).map((r) => ({
    key: r.key,
    label: r.label,
    currentRatio: ratioString(r.current),
    targetRatio: ratioString(r.target),
  }));
}

/** Mean yield × 365 × (count − 1) / span over payments with a yield; null unless count ≥ 2 and span > 0. */
function cadenceYield(payments: readonly { date: IsoDate; yieldDec: Dec }[]): Dec | null {
  if (payments.length < 2) return null;
  const dates = payments.map((p) => p.date).sort();
  const span = daysBetween(dates[0]!, dates[dates.length - 1]!);
  if (span <= 0) return null;
  const mean = sum(payments.map((p) => p.yieldDec)).div(payments.length);
  return mean
    .times(DAYS_PER_YEAR)
    .times(payments.length - 1)
    .div(span);
}

export function computeInvestments(input: InvestmentsInput): InvestmentsResult {
  const { kind, asOf } = input;
  const asOfDay = dayNumber(asOf);
  const strategy = input.matching ?? 'fifo';
  const instruments = [...input.instruments].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  );
  const known = new Set(instruments.map((i) => i.id));
  // A trade whose instrument is not in `instruments` has no holding to belong to: it is ignored.
  const trades = input.trades.filter((t) => known.has(t.instrumentId));
  const ledger = processLedger(trades, strategy);
  const fy = financialYearOfIso(asOf);

  const kindDividends = input.dividends.filter((d) => d.holdingKind === kind);
  const isLinked = (d: EngineDividend) =>
    d.holdingKind === kind && d.instrumentId !== null && known.has(d.instrumentId);

  // ─── Per-instrument state ───────────────────────────────────────────────────────────────────
  const byId = new Map<number, Holding>();
  for (const inst of instruments) {
    const { price, status: priceStatus } = effectivePrice(input, inst.id);
    const h: Holding = {
      inst,
      trades: [],
      lots: [],
      sells: [],
      disposals: [],
      dividends: [],
      netUnits: ZERO,
      openUnits: ZERO,
      price,
      priceStatus,
      held: false,
      status: 'exited',
      value: null,
      cost: ZERO,
      unrealised: null,
      dividendsCents: 0,
      totalReturn: null,
      current: null,
      target:
        inst.targetRatio === null ? null : dec(inst.targetRatio, `target of instrument ${inst.id}`),
    };
    byId.set(inst.id, h);
  }
  for (const t of ledger.order) {
    const h = byId.get(t.instrumentId)!;
    if (ledger.units.get(t.id)!.isZero()) continue;
    h.trades.push(t);
    h.netUnits = h.netUnits.plus(ledger.units.get(t.id)!);
    const lot = ledger.lots.get(t.id);
    if (lot) h.lots.push(lot);
    const sell = ledger.sells.get(t.id);
    if (sell) {
      h.sells.push(sell);
      h.disposals.push(...sell.disposals);
    }
  }
  for (const d of kindDividends) {
    if (isLinked(d)) {
      const h = byId.get(d.instrumentId!)!;
      h.dividends.push(d);
      h.dividendsCents += d.netAmountCents;
    }
  }

  for (const h of byId.values()) {
    h.openUnits = sum(h.lots.map((l) => l.remaining));
    h.held = h.openUnits.greaterThan(0);
    h.status = h.held ? 'held' : h.inst.watched ? 'watching' : 'exited';
    h.cost = sum(h.lots.map(lotCostLeft));
    if (h.price !== null) {
      const p = h.price;
      const value = h.openUnits.times(p);
      const lotGains = h.lots
        .filter((l) => l.remaining.greaterThan(0))
        .map((l) => lotUnrealised(l, p));
      const unrealised = sum(lotGains);
      const totalReturn = unrealised.plus(dollarsOf(h.dividendsCents));
      if ([value, unrealised, totalReturn, ...lotGains].every(isSafeCents)) {
        h.value = value;
        h.unrealised = unrealised;
      } else {
        // A price that values the position beyond safe-integer cents is a data problem (§2.1):
        // the price is unusable, so the holding is unpriced (flagged, left out of every sum, §2.13)
        // instead of the page failing. Scaffold note 2026-09-25 — Fixer.
        h.price = null;
      }
    }
    if (h.held && h.unrealised !== null) {
      h.totalReturn = h.unrealised.plus(dollarsOf(h.dividendsCents));
    }
  }

  const heldPriced = [...byId.values()].filter((h) => h.held && h.value !== null);
  const totalValue = sum(heldPriced.map((h) => h.value!));
  for (const h of byId.values()) {
    if (h.held && h.value !== null)
      h.current = totalValue.greaterThan(0) ? h.value.div(totalValue) : null;
    else if (!h.held && h.inst.watched) h.current = ZERO;
    else h.current = null;
  }

  // ─── Dividends (§2.9) ─────────────────────────────────────────────────────────────────────
  const unitsBefore = (instrumentId: number, before: IsoDate): Dec =>
    sum(
      (byId.get(instrumentId)?.trades ?? [])
        .filter((t) => t.tradeDate < before)
        .map((t) => ledger.units.get(t.id)!),
    );
  const dividendResults: DividendResult[] = [];
  const yieldsByInstrument = new Map<number, { date: IsoDate; yieldDec: Dec }[]>();
  for (const d of input.dividends) {
    const { result, yieldDec } = paymentMetrics(d, isLinked(d), unitsBefore);
    dividendResults.push(result);
    if (yieldDec !== null && d.instrumentId !== null) {
      const list = yieldsByInstrument.get(d.instrumentId) ?? [];
      list.push({ date: d.paymentDate, yieldDec });
      yieldsByInstrument.set(d.instrumentId, list);
    }
  }
  const yieldOf = (h: Holding): Dec | null => {
    const payments = yieldsByInstrument.get(h.inst.id) ?? [];
    if (kind !== 'crypto') return cadenceYield(payments);
    // Crypto staking yield: payments in the last 365 days; × 12 / frequency when one is set.
    const recent = payments.filter((p) => {
      const day = dayNumber(p.date);
      return day > asOfDay - DAYS_PER_YEAR && day <= asOfDay;
    });
    const freq = h.inst.dividendFreqMonths;
    if (freq !== null && freq > 0) {
      if (recent.length === 0) return null;
      return sum(recent.map((p) => p.yieldDec))
        .div(recent.length)
        .times(12)
        .div(freq);
    }
    return cadenceYield(recent);
  };

  // ─── Lots, trades and disposals ─────────────────────────────────────────────────────────────
  const lots: LotResult[] = [];
  const tradeResults: TradeResult[] = [];
  for (const t of ledger.order) {
    const u = ledger.units.get(t.id)!;
    const p = ledger.prices.get(t.id)!;
    const fee = ledger.fees.get(t.id)!;
    const h = byId.get(t.instrumentId)!;
    const lot = ledger.lots.get(t.id);
    const sell = ledger.sells.get(t.id);
    let unrealisedCents: Cents | null = null;
    if (lot) {
      const unrealised =
        h.price !== null && lot.remaining.greaterThan(0) ? lotUnrealised(lot, h.price) : null;
      unrealisedCents = unrealised === null ? null : centsOf(unrealised);
      const original = lot.price.times(lot.units);
      lots.push({
        tradeId: t.id,
        instrumentId: t.instrumentId,
        tradeDate: t.tradeDate,
        seq: t.seq,
        units: decimalString(lot.units),
        remainingUnits: decimalString(lot.remaining),
        price: decimalString(lot.price),
        feeCents: centsOf(lot.fee),
        remainingCostCents: centsOf(lotCostLeft(lot)),
        unrealisedCents,
        unrealisedRatio:
          unrealised === null || original.isZero() ? null : ratioString(unrealised.div(original)),
        heldDays: dayNumber(asOf) - dayNumber(t.tradeDate),
        termIfSoldToday: capitalGainTerm(t.tradeDate, asOf),
      });
    }
    const gains = sell?.disposals ?? [];
    tradeResults.push({
      tradeId: t.id,
      side: u.lessThan(0) ? 'sell' : 'buy',
      orderValueCents: centsOf(u.times(p).abs()),
      feeCents: centsOf(fee),
      remainingUnits: lot ? decimalString(lot.remaining) : null,
      unrealisedCents: lot ? unrealisedCents : null,
      realisedCents: sell ? centsOf(sum(gains.map((g) => g.gain))) : null,
      realisedShortCents: sell
        ? centsOf(sum(gains.filter((g) => g.term === 'short').map((g) => g.gain)))
        : null,
      realisedLongCents: sell
        ? centsOf(sum(gains.filter((g) => g.term === 'long').map((g) => g.gain)))
        : null,
      oversoldUnits: sell && sell.oversold.greaterThan(0) ? decimalString(sell.oversold) : null,
    });
  }
  const disposals: DisposalResult[] = ledger.disposals.map((d) => ({
    sellTradeId: d.sell.id,
    lotTradeId: d.lot.trade.id,
    instrumentId: d.sell.instrumentId,
    sellDate: d.sell.tradeDate,
    acquiredDate: d.lot.trade.tradeDate,
    units: decimalString(d.units),
    proceedsCents: centsOf(d.proceeds),
    costCents: centsOf(d.cost),
    gainCents: centsOf(d.gain),
    term: d.term,
    financialYear: d.financialYear,
  }));

  // ─── Holding results ──────────────────────────────────────────────────────────────────────────
  const holdings: HoldingResult[] = [];
  const resultOf = new Map<number, HoldingResult>();
  for (const h of byId.values()) {
    const flagSet = new Set<HoldingFlag>();
    if (h.held && h.price === null) flagSet.add('unpriced');
    if (h.held && h.price !== null && (h.priceStatus === 'stale' || h.priceStatus === 'failed')) {
      flagSet.add('stale_price');
    }
    if (h.sells.some((s) => s.oversold.greaterThan(0))) flagSet.add('oversell');
    if (h.held && !h.inst.watched) flagSet.add('unwatched_held');
    const flags = HOLDING_FLAGS.filter((f) => flagSet.has(f));

    let xirr: DecimalString | null = null;
    if (!(h.held && h.price === null)) {
      const flows = [
        ...tradeFlows(h.trades, ledger.units, ledger.prices),
        ...dividendFlows(h.dividends),
      ];
      if (h.held && h.value !== null) flows.push({ amount: h.value.toNumber(), date: asOf });
      xirr = xirrString(flows);
    }
    const averagePrice = h.openUnits.greaterThan(0)
      ? priceString(sum(h.lots.map((l) => l.price.times(l.remaining))).div(h.openUnits))
      : null;
    const mgmtFee =
      h.inst.mgmtFeeRatio === null
        ? null
        : dec(h.inst.mgmtFeeRatio, `mgmt fee of instrument ${h.inst.id}`);
    const estMgmtFee =
      MGMT_FEE_KINDS.has(kind) && mgmtFee !== null && h.value !== null
        ? h.value.times(ONE.plus(mgmtFee.div(DAYS_PER_YEAR)).pow(DAYS_PER_YEAR).minus(ONE))
        : null;
    const yieldDec = yieldOf(h);
    const result: HoldingResult = {
      instrumentId: h.inst.id,
      status: h.status,
      flags,
      netUnits: decimalString(h.netUnits),
      openUnits: decimalString(h.openUnits),
      price: h.price === null ? null : decimalString(h.price),
      priceStatus: h.priceStatus,
      valueCents: h.value === null ? null : centsOf(h.value),
      costCents: centsOf(h.cost),
      unrealisedCents: h.unrealised === null ? null : centsOf(h.unrealised),
      dividendsCents: h.dividendsCents,
      totalReturnCents: h.totalReturn === null ? null : centsOf(h.totalReturn),
      totalReturnRatio:
        h.totalReturn !== null && h.cost.greaterThan(0)
          ? ratioString(h.totalReturn.div(h.cost))
          : null,
      realisedCents: centsOf(sum(h.disposals.map((d) => d.gain))),
      xirr,
      averagePrice,
      currentRatio: h.current === null ? null : ratioString(h.current),
      targetRatio: h.target === null ? null : decimalString(h.target),
      differenceRatio:
        h.current !== null && h.target !== null ? ratioString(h.current.minus(h.target)) : null,
      dividendYieldRatio: yieldDec === null ? null : ratioString(yieldDec),
      estMgmtFeeCents: estMgmtFee === null ? null : centsOf(estMgmtFee),
      lastBuyDate: maxIso(h.lots.map((l) => l.trade.tradeDate)),
      lastTradeDate: maxIso(h.trades.map((t) => t.tradeDate)),
    };
    holdings.push(result);
    resultOf.set(h.inst.id, result);
  }

  // ─── Realised by FY (§2.5, §2.10) ─────────────────────────────────────────────────────────────
  const realisedByFy = fyRowsFromGains(
    ledger.disposals.map((d) => ({ financialYear: d.financialYear, term: d.term, gain: d.gain })),
    asOf,
  );

  // ─── Summary (§2.8) ──────────────────────────────────────────────────────────────────────────
  const all = [...byId.values()];
  const pricedResults = heldPriced.map((h) => resultOf.get(h.inst.id)!);
  const totalReturnSum = sum(heldPriced.map((h) => h.totalReturn!));
  const costSum = sum(heldPriced.map((h) => h.cost));

  const portfolioFlows: XirrFlow[] = [];
  for (const h of all) {
    if (h.held && h.price === null) continue;
    portfolioFlows.push(
      ...tradeFlows(h.trades, ledger.units, ledger.prices),
      ...dividendFlows(h.dividends),
    );
  }
  if (totalValue.greaterThan(0)) portfolioFlows.push({ amount: totalValue.toNumber(), date: asOf });

  const estFees = pricedResults.map((r) => r.estMgmtFeeCents).filter((c): c is Cents => c !== null);
  const watchedTargets = all
    .filter((h) => h.inst.watched && h.target !== null)
    .map((h) => h.target!);

  const summary: SummaryResult = {
    valueCents: sumCents(pricedResults.map((r) => r.valueCents!)),
    costCents: sumCents(pricedResults.map((r) => r.costCents)),
    unrealisedCents: sumCents(pricedResults.map((r) => r.unrealisedCents!)),
    dividendsHeldCents: sumCents(pricedResults.map((r) => r.dividendsCents)),
    totalReturnCents: sumCents(pricedResults.map((r) => r.totalReturnCents!)),
    totalReturnRatio: costSum.greaterThan(0) ? ratioString(totalReturnSum.div(costSum)) : null,
    realisedCents: sumCents(holdings.map((r) => r.realisedCents)),
    realisedThisFyCents: realisedByFy.find((r) => r.financialYear === fy)?.totalCents ?? 0,
    xirr: xirrString(portfolioFlows),
    investmentRatePerMonthCents: investmentRate(all, ledger.units, ledger.prices, asOf),
    dividendsThisFyCents: sumCents(
      kindDividends
        .filter((d) => financialYearOfIso(d.paymentDate) === fy)
        .map((d) => d.netAmountCents),
    ),
    dividendsAllTimeCents: sumCents(kindDividends.map((d) => d.netAmountCents)),
    heldCount: all.filter((h) => h.status === 'held').length,
    watchingCount: all.filter((h) => h.status === 'watching').length,
    exitedCount: all.filter((h) => h.status === 'exited').length,
    unpricedCount: holdings.filter((r) => r.flags.includes('unpriced')).length,
    stalePriceCount: holdings.filter((r) => r.flags.includes('stale_price')).length,
    targetSumRatio: ratioString(sum(watchedTargets)),
    targetCount: all.filter(
      (h) =>
        (h.inst.watched && h.target !== null && h.target.greaterThan(0)) ||
        (h.held && h.current !== null && h.current.greaterThan(0)),
    ).length,
    estMgmtFeeCents: estFees.length === 0 ? null : sumCents(estFees),
    lastBuyDate: maxIso(holdings.map((r) => r.lastBuyDate).filter((d): d is IsoDate => d !== null)),
  };

  return {
    kind,
    asOf,
    holdings,
    lots,
    disposals,
    trades: tradeResults,
    dividends: dividendResults,
    summary,
    allocation: allocation(kind, all),
    realisedByFy,
  };
}

/**
 * The sheet's "1Y Inv. Rate" (§2.8): Σ buys' order value over trades with asOf − 365 < date ≤ asOf,
 * per (asOf − the earliest trade date in that window) / 30.416 days, rounded up to whole dollars.
 */
function investmentRate(
  holdings: readonly Holding[],
  units: ReadonlyMap<number, Dec>,
  prices: ReadonlyMap<number, Dec>,
  asOf: IsoDate,
): Cents | null {
  const asOfDay = dayNumber(asOf);
  const inWindow = holdings
    .flatMap((h) => h.trades)
    .filter((t) => {
      const day = dayNumber(t.tradeDate);
      return day > asOfDay - DAYS_PER_YEAR && day <= asOfDay;
    });
  if (inWindow.length === 0) return null;
  const first = inWindow.map((t) => dayNumber(t.tradeDate)).reduce((a, b) => Math.min(a, b));
  const days = asOfDay - first;
  if (days <= 0) return null;
  const buys = sum(
    inWindow
      .filter((t) => units.get(t.id)!.greaterThan(0))
      .map((t) => units.get(t.id)!.times(prices.get(t.id)!)),
  );
  const perMonth = buys.times(DAYS_PER_MONTH).div(days);
  return centsOf(roundUpAway(perMonth, 0));
}

/** Allocation (§2.8): by holding, by sector and (ETF and managed fund) by region. */
function allocation(kind: InstrumentKind, all: readonly Holding[]): AllocationResult {
  const currentOf = (h: Holding): Dec => (h.held && h.current !== null ? h.current : ZERO);
  const targetOf = (h: Holding): Dec => (h.inst.watched && h.target !== null ? h.target : ZERO);

  const byHolding = slices(
    all
      .filter((h) => h.held || targetOf(h).greaterThan(0))
      .map((h) => ({
        key: String(h.inst.id),
        label: h.inst.symbol,
        current: currentOf(h),
        target: targetOf(h),
      })),
  );

  const sectors = new Map<string, { key: string; label: string; current: Dec; target: Dec }>();
  for (const h of all) {
    const current = currentOf(h);
    const target = targetOf(h);
    if (!current.greaterThan(0) && !target.greaterThan(0)) continue;
    const key = h.inst.sector ?? UNASSIGNED.key;
    const row = sectors.get(key) ?? {
      key,
      label: h.inst.sector ?? UNASSIGNED.label,
      current: ZERO,
      target: ZERO,
    };
    row.current = row.current.plus(current);
    row.target = row.target.plus(target);
    sectors.set(key, row);
  }

  let byRegion: AllocationSliceResult[] | null = null;
  if (REGION_KINDS.has(kind)) {
    const weightOf = (h: Holding, key: (typeof REGIONS)[number]['key']): Dec => {
      const v = h.inst.regions[key];
      return v === null ? ZERO : dec(v, `region ${key} of instrument ${h.inst.id}`);
    };
    const rows: { key: string; label: string; current: Dec; target: Dec }[] = REGIONS.map((r) => ({
      key: r.key,
      label: r.label,
      current: sum(all.map((h) => currentOf(h).times(weightOf(h, r.key)))),
      target: sum(all.map((h) => targetOf(h).times(weightOf(h, r.key)))),
    }));
    const totalCurrent = sum(all.map(currentOf));
    const totalTarget = sum(all.map(targetOf));
    rows.push({
      key: UNASSIGNED.key,
      label: UNASSIGNED.label,
      current: maxDec(ZERO, totalCurrent.minus(sum(rows.map((r) => r.current)))),
      target: maxDec(ZERO, totalTarget.minus(sum(rows.map((r) => r.target)))),
    });
    byRegion = slices(rows);
  }
  return { byHolding, bySector: slices([...sectors.values()]), byRegion };
}
