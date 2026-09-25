// The trade ledger (`GET /api/investments/:kind/trades`, stage-2.md §4.2): every trade of the
// kind's instruments with the engine's per-trade results, newest first.
import type { InstrumentKind, InvestmentTradesResponse, TradeRowDto } from '@joinr/schema';
import type { InvestmentsContext } from './context';
import type { TradeRow } from './load';
import { compareTradesNewestFirst, tradeRowDto } from './mappers';

/** Ledger rows for `trades` (all of one kind), newest first. */
export function tradeRows(
  ctx: InvestmentsContext,
  kind: InstrumentKind,
  trades: readonly TradeRow[],
): TradeRowDto[] {
  const results = new Map(ctx.compute(kind).trades.map((r) => [r.tradeId, r]));
  return [...trades].sort(compareTradesNewestFirst).flatMap((t) => {
    const instrument = ctx.instrumentById.get(t.instrumentId);
    return instrument ? [tradeRowDto(t, instrument, results.get(t.id))] : [];
  });
}

export function buildTradesResponse(
  ctx: InvestmentsContext,
  kind: InstrumentKind,
): InvestmentTradesResponse {
  return { kind, asOf: ctx.asOf, trades: tradeRows(ctx, kind, ctx.rows(kind).trades) };
}

/** One recomputed ledger row (the trade mutation responses), or null when the trade is gone. */
export function tradeRowById(ctx: InvestmentsContext, tradeId: number): TradeRowDto | null {
  const trade = ctx.data.trades.find((t) => t.id === tradeId);
  const instrument = trade ? ctx.instrumentById.get(trade.instrumentId) : undefined;
  if (!trade || !instrument) return null;
  return tradeRows(ctx, instrument.kind, [trade])[0] ?? null;
}
