// Stage 9 test builders: Yahoo chart bodies shaped like the probes of stage-9.md (one-day and
// two-day five-minute charts, five-day daily charts) and five-minute series. Made-up symbols and
// prices only (EXA.AX, EXUS, 0PEXAMPLE1, AUDUSD=X, GC=F); no network.
import type {
  CoinDayChartClient,
  CoinIdResolver,
  CoinSearchResult,
  DayChartResult,
  PriceProviderClient,
  Quote,
  QuoteBatch,
  QuoteFailure,
  QuoteRequest,
} from '../../src/market/providers/types';

/** Unix seconds of an ISO instant. */
export const sec = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Every `stepMin` minutes from `fromIso` to `toIso` inclusive, as ISO strings. */
export function everyMinutes(fromIso: string, toIso: string, stepMin = 5): string[] {
  const out: string[] = [];
  for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += stepMin * 60_000) {
    out.push(new Date(t).toISOString());
  }
  return out;
}

export interface ChartOptions {
  symbol: string;
  currency?: string;
  price?: number | null;
  /** regularMarketTime (ISO); defaults to the last bar's time. */
  marketTime?: string;
  timestamps: string[];
  closes: Array<number | null>;
  chartPreviousClose?: number;
  previousClose?: number;
  exchangeTimezoneName?: string;
  dataGranularity?: string;
  /** Each period as [startIso, endIso]; one inner array per trading day. */
  tradingPeriods?: Array<[string, string]>;
  /** The next session (after a close), never to be read. */
  currentTradingPeriod?: [string, string];
}

/** A `v8/finance/chart` body with the fields the day parser reads. */
export function chartBody(o: ChartOptions): unknown {
  const period = ([start, end]: [string, string]) => ({
    timezone: 'X',
    start: sec(start),
    end: sec(end),
    gmtoffset: 0,
  });
  const meta: Record<string, unknown> = {
    currency: o.currency ?? 'AUD',
    symbol: o.symbol,
    regularMarketPrice:
      o.price === undefined ? ([...o.closes].reverse().find((c) => c !== null) ?? 1) : o.price,
    regularMarketTime: sec(o.marketTime ?? o.timestamps.at(-1) ?? '2030-01-01T00:00:00.000Z'),
    dataGranularity: o.dataGranularity ?? '5m',
  };
  if (o.chartPreviousClose !== undefined) meta.chartPreviousClose = o.chartPreviousClose;
  if (o.previousClose !== undefined) meta.previousClose = o.previousClose;
  if (o.exchangeTimezoneName !== undefined) meta.exchangeTimezoneName = o.exchangeTimezoneName;
  if (o.tradingPeriods) meta.tradingPeriods = o.tradingPeriods.map((p) => [period(p)]);
  if (o.currentTradingPeriod) {
    meta.currentTradingPeriod = { regular: period(o.currentTradingPeriod) };
  }
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: o.timestamps.map(sec),
          indicators: { quote: [{ close: o.closes }] },
        },
      ],
      error: null,
    },
  };
}

/** Yahoo's `chart.error` body (sent with a 200 for a five-minute request it refuses). */
export function chartErrorBody(): unknown {
  return { chart: { result: null, error: { code: 'Bad Request', description: 'Refused' } } };
}

/** The first chart result of a body (for the pure parsers). */
export function resultOf(body: unknown): Record<string, unknown> {
  return (body as { chart: { result: Array<Record<string, unknown>> } }).chart.result[0]!;
}

// ─── Scripted providers (the refresh and intraday suites) ───────────────────────────────────────

export type ScriptedAnswer = Omit<Quote, 'key'> | Omit<QuoteFailure, 'key'>;

export interface ScriptedProvider extends PriceProviderClient, CoinIdResolver, CoinDayChartClient {
  /** Every request, in order. */
  requests: QuoteRequest[];
  charts: string[];
  searches: string[];
  /** symbol → answer (a function of the request); a missing symbol is "Symbol not found". */
  answers: Map<string, (req: QuoteRequest) => ScriptedAnswer>;
  chartAnswers: Map<string, () => DayChartResult>;
  /** When set, fetchQuotes waits for it before answering (to hold a run in flight). */
  gate: Promise<void> | null;
}

export function scriptedProvider(id: 'yahoo' | 'coingecko' | 'fake' = 'yahoo'): ScriptedProvider {
  const p: ScriptedProvider = {
    id,
    requests: [],
    charts: [],
    searches: [],
    answers: new Map(),
    chartAnswers: new Map(),
    gate: null,
    async fetchQuotes(reqs: QuoteRequest[]): Promise<QuoteBatch> {
      p.requests.push(...reqs);
      if (p.gate) await p.gate;
      const quotes: Quote[] = [];
      const failures: QuoteFailure[] = [];
      for (const req of reqs) {
        const answer = p.answers.get(req.symbol)?.(req) ?? {
          error: 'Symbol not found',
          retryable: false,
        };
        if ('price' in answer) quotes.push({ key: req.key, ...answer });
        else failures.push({ key: req.key, ...answer });
      }
      return { quotes, failures };
    },
    async searchId(symbol: string): Promise<CoinSearchResult> {
      p.searches.push(symbol);
      return { ok: true, id: symbol.toLowerCase() };
    },
    async fetchDayChart(coinId: string): Promise<DayChartResult> {
      p.charts.push(coinId);
      return p.chartAnswers.get(coinId)?.() ?? { ok: false, error: 'Unknown CoinGecko id' };
    },
  };
  return p;
}
