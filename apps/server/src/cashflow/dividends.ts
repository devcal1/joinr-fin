// `GET /api/dividends` (stage-3.md §4.2, §4.4, §6.6): the ledger with per-payment units and yields,
// the FY and rolling-12-month summaries, the per-holding FY table with DRP advice, the Yahoo
// suggestions (D50) and the dividend-events status. Every figure comes from the engine; the events
// status comes from the service (§4.6 interface) plus the `dividend_events` and `job_runs` tables.
import type {
  DividendFyRow,
  DividendHoldingFyResult,
  DividendMonthRow,
  DividendResult,
  DividendSuggestionResult,
  DividendsResult,
} from '@joinr/engine';
import {
  financialYearOfIso,
  INSTRUMENT_KINDS,
  parseReviewFlags,
  type DividendEventsStatusDto,
  type DividendFyRowDto,
  type DividendHoldingFyDto,
  type DividendMonthRowDto,
  type DividendRowDto,
  type DividendsKpisDto,
  type DividendsPageResponse,
  type DividendSuggestionDto,
  type InstrumentKind,
  type ReviewFlag,
} from '@joinr/schema';
import { dividendEvents } from '@joinr/schema/db';
import type { Db } from '../db/database';
import {
  latestJobRun,
  toEngineDividend,
  toEngineTrade,
  type DividendRow,
  type InstrumentRow,
  type InvestmentData,
} from '../investments/load';
import type { DividendEventsService } from '../market/dividends/index';
import { truncateError } from '../market/providers/http';
import type { FinanceContext } from './context';
import { instrumentsByKindThenId, toDividendEventInput } from './inputs';

function safeFlags(stored: string | null): ReviewFlag[] {
  try {
    return parseReviewFlags(stored);
  } catch {
    return [];
  }
}

export function dividendRowDto(
  d: DividendRow,
  o: { instrument: InstrumentRow | undefined; result: DividendResult | undefined },
): DividendRowDto {
  return {
    id: d.id,
    instrumentId: d.instrumentId,
    symbol: o.instrument?.symbol ?? null,
    ticker: d.ticker,
    holdingKind: d.holdingKind,
    paymentDate: d.paymentDate,
    exDate: d.exDate,
    reinvested: d.reinvested,
    netAmountCents: d.netAmountCents,
    priceAtEx: d.priceAtEx,
    priceAtExManual: d.priceAtExManual,
    unitsAtEx: o.result?.unitsAtEx ?? null,
    yieldRatio: o.result?.yieldRatio ?? null,
    financialYear: financialYearOfIso(d.paymentDate),
    flags: safeFlags(d.reviewFlags),
    note: d.note,
    origin: d.origin,
    sheetRef: d.sheetRef,
  };
}

/** Every dividend, payment date desc then id desc, with the engine's units and yield. */
export function dividendRowDtos(ctx: FinanceContext): DividendRowDto[] {
  const results = new Map(ctx.dividends().rows.map((r) => [r.dividendId, r]));
  return [...ctx.data.dividends]
    .sort((a, b) =>
      a.paymentDate !== b.paymentDate ? (a.paymentDate < b.paymentDate ? 1 : -1) : b.id - a.id,
    )
    .map((d) =>
      dividendRowDto(d, {
        instrument: d.instrumentId === null ? undefined : ctx.instrumentById.get(d.instrumentId),
        result: results.get(d.id),
      }),
    );
}

function byKindDto(
  byKind: Readonly<Record<InstrumentKind, number>>,
): Record<InstrumentKind, number> {
  return {
    stock: byKind.stock,
    etf: byKind.etf,
    managed_fund: byKind.managed_fund,
    crypto: byKind.crypto,
  };
}

export function fyRowDto(r: DividendFyRow): DividendFyRowDto {
  return { financialYear: r.financialYear, byKind: byKindDto(r.byKind), totalCents: r.totalCents };
}

export function monthRowDto(r: DividendMonthRow): DividendMonthRowDto {
  return { month: r.month, byKind: byKindDto(r.byKind), totalCents: r.totalCents };
}

export function holdingFyDto(h: DividendHoldingFyResult, symbol: string): DividendHoldingFyDto {
  return {
    instrumentId: h.instrumentId,
    symbol,
    kind: h.kind,
    netThisFyCents: h.netThisFyCents,
    payments: h.payments,
    frequencyMonths: h.frequencyMonths,
    drp: h.drp,
    yield365Ratio: h.yield365Ratio,
    monthsToExtraUnit: h.monthsToExtraUnit,
    advice: h.advice,
  };
}

export function suggestionDto(
  s: DividendSuggestionResult,
  o: { instrument: InstrumentRow; currency: string },
): DividendSuggestionDto {
  return {
    instrumentId: s.instrumentId,
    symbol: o.instrument.symbol,
    kind: o.instrument.kind,
    exDate: s.exDate,
    amountPerUnit: s.amountPerUnit,
    currency: o.currency,
    unitsAtEx: s.unitsAtEx,
    estimatedNetCents: s.estimatedNetCents,
    priceAtEx: s.priceAtEx,
    yieldRatio: s.yieldRatio,
    expectedPaymentDate: s.expectedPaymentDate,
    status: s.status,
    reinvestedDefault: o.instrument.drp,
  };
}

/** The engine's suggestions (due, upcoming and dismissed) over the cached events. */
export function suggestionDtos(ctx: FinanceContext): DividendSuggestionDto[] {
  const { data } = ctx;
  const currency = new Map(
    data.dividendEvents.map((e) => [`${e.instrumentId}:${e.exDate}`, e.currency]),
  );
  const suggestions = ctx.engine.dividendSuggestions({
    asOf: ctx.asOf,
    events: data.dividendEvents.map(toDividendEventInput),
    trades: data.trades.map(toEngineTrade),
    dividends: data.dividends.map(toEngineDividend),
  });
  return suggestions.flatMap((s) => {
    const instrument = ctx.instrumentById.get(s.instrumentId);
    if (!instrument) return [];
    return [
      suggestionDto(s, {
        instrument,
        currency: currency.get(`${s.instrumentId}:${s.exDate}`) ?? 'AUD',
      }),
    ];
  });
}

const URL_RE = /\b(?:https?|ftp):\/\/\S+/gi;

/** A job error as the page shows it: URLs removed, whitespace collapsed, ≤ 200 characters. */
export function publicJobError(error: string | null | undefined): string | null {
  if (error === null || error === undefined) return null;
  const text = error.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : truncateError(text);
}

/** The service's status plus the cache counts and the last run's error text (§4.6 "Status"). */
export function eventsStatusDto(
  data: Pick<InvestmentData, 'dividendEvents' | 'lastDividendsRun'>,
  service: DividendEventsService,
): DividendEventsStatusDto {
  const st = service.status();
  return {
    mode: st.mode,
    running: st.running,
    lastRefreshAt: st.lastRefreshAt,
    nextRefreshAt: st.nextRefreshAt,
    eventCount: data.dividendEvents.length,
    instrumentsCovered: new Set(data.dividendEvents.map((e) => e.instrumentId)).size,
    lastError: publicJobError(data.lastDividendsRun?.error),
  };
}

/** The events status read straight from the tables (the refresh route's answer). */
export function readEventsStatus(db: Db, service: DividendEventsService): DividendEventsStatusDto {
  return eventsStatusDto(
    {
      dividendEvents: db.select().from(dividendEvents).all(),
      lastDividendsRun: latestJobRun(db, 'dividends'),
    },
    service,
  );
}

export function dividendsKpisDto(k: DividendsResult['kpis']): DividendsKpisDto {
  return {
    financialYear: k.financialYear,
    thisFyCents: k.thisFyCents,
    lastFyCents: k.lastFyCents,
    allTimeCents: k.allTimeCents,
    rolling12Cents: k.rolling12Cents,
    reinvestedThisFyCents: k.reinvestedThisFyCents,
    daysIntoFy: k.daysIntoFy,
    projectedFyCents: k.projectedFyCents,
  };
}

export function buildDividendsPage(
  ctx: FinanceContext,
  service: DividendEventsService,
): DividendsPageResponse {
  const { data } = ctx;
  const result = ctx.dividends();
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    dividends: dividendRowDtos(ctx),
    kpis: dividendsKpisDto(result.kpis),
    byFinancialYear: result.byFinancialYear.map(fyRowDto),
    rolling12: result.rolling12.map(monthRowDto),
    holdingsThisFy: result.holdingsThisFy.flatMap((h) => {
      const instrument = ctx.instrumentById.get(h.instrumentId);
      return instrument ? [holdingFyDto(h, instrument.symbol)] : [];
    }),
    unlinkedThisFyCents: result.unlinkedThisFyCents,
    suggestions: suggestionDtos(ctx),
    events: eventsStatusDto(data, service),
    holdings: instrumentsByKindThenId(data.instruments, INSTRUMENT_KINDS).map((i) => ({
      instrumentId: i.id,
      symbol: i.symbol,
      kind: i.kind,
      drp: i.drp,
      dividendFreqMonths: i.dividendFreqMonths,
    })),
  };
}
