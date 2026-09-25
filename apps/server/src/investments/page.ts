// `GET /api/investments/:kind` (stage-2.md §4.2, §4.5 page build): summary, holdings, allocation,
// realised-by-FY, timing, charts and settings, every figure from the engine.
import type { InstrumentKind, InvestmentPageResponse } from '@joinr/schema';
import { buildCharts } from './charts';
import type { InvestmentsContext } from './context';
import {
  holdingRowDto,
  realisedFyDto,
  settingsDto,
  sliceDto,
  sortHoldings,
  summaryDto,
} from './mappers';
import { buildTiming } from './timing';

export function buildInvestmentPage(
  ctx: InvestmentsContext,
  kind: InstrumentKind,
): InvestmentPageResponse {
  const result = ctx.compute(kind);
  const settings = ctx.data.settings;
  const holdings = sortHoldings(result.holdings).flatMap((h) => {
    const row = ctx.instrumentById.get(h.instrumentId);
    return row ? [holdingRowDto(row, h, ctx.priceItems.get(row.id), settings)] : [];
  });
  return {
    kind,
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    prices: {
      mode: ctx.market.mode,
      lastRefreshAt: ctx.market.lastRefreshAt,
      running: ctx.market.running,
    },
    summary: summaryDto(result.summary),
    holdings,
    allocation: {
      byHolding: result.allocation.byHolding.map(sliceDto),
      bySector: kind === 'crypto' ? null : result.allocation.bySector.map(sliceDto),
      byRegion: result.allocation.byRegion?.map(sliceDto) ?? null,
    },
    realisedByFy: result.realisedByFy.map(realisedFyDto),
    timing: buildTiming(ctx, kind),
    charts: buildCharts(ctx, kind),
    settings: settingsDto(settings),
  };
}
