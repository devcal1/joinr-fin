// `GET /api/instruments/:id` (stage-2.md §4.2, §6.5): the instrument, its holding row, lots,
// disposals, trades and linked dividends, from the engine result of its kind.
import type { HoldingDetailResponse } from '@joinr/schema';
import type { InvestmentsContext } from './context';
import {
  disposalRowDto,
  holdingDividendDto,
  holdingRowDto,
  instrumentDto,
  lotRowDto,
} from './mappers';
import { tradeRows } from './trades';

/** The detail response, or null when the instrument does not exist. */
export function buildHoldingDetail(
  ctx: InvestmentsContext,
  instrumentId: number,
): HoldingDetailResponse | null {
  const row = ctx.instrumentById.get(instrumentId);
  if (!row) return null;
  const result = ctx.compute(row.kind);
  const holding = result.holdings.find((h) => h.instrumentId === instrumentId);
  if (!holding) throw new Error(`engine returned no holding for instrument ${instrumentId}`);

  const trades = ctx.data.trades.filter((t) => t.instrumentId === instrumentId);
  const linked = ctx.data.dividends
    .filter((d) => d.instrumentId === instrumentId)
    .sort((a, b) =>
      a.paymentDate !== b.paymentDate ? (a.paymentDate < b.paymentDate ? -1 : 1) : a.id - b.id,
    );
  const dividendResults = new Map(result.dividends.map((d) => [d.dividendId, d]));
  const price = ctx.priceItems.get(instrumentId);

  return {
    asOf: ctx.asOf,
    instrument: instrumentDto(row, {
      price,
      settings: ctx.data.settings,
      tradeCount: trades.length,
      dividendCount: linked.length,
    }),
    holding: holdingRowDto(row, holding, price, ctx.data.settings),
    lots: result.lots.filter((l) => l.instrumentId === instrumentId).map(lotRowDto),
    disposals: result.disposals.filter((d) => d.instrumentId === instrumentId).map(disposalRowDto),
    trades: tradeRows(ctx, row.kind, trades),
    dividends: linked.map((d) => holdingDividendDto(d, dividendResults.get(d.id))),
  };
}
