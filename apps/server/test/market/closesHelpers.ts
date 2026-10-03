// Stage 10 test builders: Yahoo daily-history bodies shaped like the probes of stage-10.md (bars
// stamped at the session start in the exchange's zone, nulls, `events.splits`, `firstTradeDate`)
// and CoinGecko `market_chart` bodies. Made-up symbols and values only (EXA.AX, EXUS, 0PEXAMPLE1,
// AUDUSD=X, GC=F); hand-made, never a probe body; no network.
import type {
  CoinHistoryClient,
  CoinHistoryResult,
  HistoryClose,
  YahooHistory,
  YahooHistoryClient,
  YahooHistoryRequest,
  YahooHistoryResult,
} from '../../src/market/providers/types';

/** Unix seconds of an ISO instant. */
export const sec = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export interface HistoryBodyOptions {
  symbol: string;
  currency?: string | null;
  exchangeTimezoneName?: string | null;
  gmtoffset?: number;
  /** ISO instant of the listing (meta.firstTradeDate); absent → no field. */
  firstTradeDate?: string;
  /** `[barInstantIso, close or null]`, ascending. */
  bars: Array<[string, number | null]>;
  /** `[eventInstantIso, numerator, denominator]`. */
  splits?: Array<[string, number, number]>;
}

/** A `v8/finance/chart` daily-history body with the fields the history parser reads. */
export function historyBody(o: HistoryBodyOptions): unknown {
  const meta: Record<string, unknown> = { symbol: o.symbol, dataGranularity: '1d' };
  if (o.currency !== null) meta.currency = o.currency ?? 'AUD';
  if (o.exchangeTimezoneName !== null) {
    meta.exchangeTimezoneName = o.exchangeTimezoneName ?? 'Australia/Sydney';
  }
  if (o.gmtoffset !== undefined) meta.gmtoffset = o.gmtoffset;
  if (o.firstTradeDate !== undefined) meta.firstTradeDate = sec(o.firstTradeDate);
  const result: Record<string, unknown> = {
    meta,
    timestamp: o.bars.map(([iso]) => sec(iso)),
    indicators: {
      quote: [{ close: o.bars.map(([, c]) => c) }],
      adjclose: [{ adjclose: o.bars.map(([, c]) => (c === null ? null : c * 0.9)) }],
    },
  };
  if (o.splits) {
    result.events = {
      splits: Object.fromEntries(
        o.splits.map(([iso, numerator, denominator]) => [
          String(sec(iso)),
          { date: sec(iso), numerator, denominator, splitRatio: `${numerator}:${denominator}` },
        ]),
      ),
    };
  }
  return { chart: { result: [result], error: null } };
}

/** A CoinGecko `market_chart` body. */
export function marketChartBody(points: Array<[number, number]>): unknown {
  return { prices: points, market_caps: [], total_volumes: [] };
}

/** Every `stepMs` from `fromMs` to `toMs` inclusive. */
export function everyStep(fromMs: number, toMs: number, stepMs: number): number[] {
  const out: number[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) out.push(t);
  return out;
}

// ─── Scripted history clients (the job suites) ──────────────────────────────────────────────────

export interface ScriptedYahooHistory extends YahooHistoryClient {
  requests: Array<YahooHistoryRequest & { at: number }>;
  /** symbol → answer; a missing symbol answers its closes from `defaultCloses`. */
  answers: Map<string, (req: YahooHistoryRequest) => YahooHistoryResult>;
  /** When set for a symbol, the request waits for it (or the run's abort) before answering. */
  gates: Map<string, Promise<void>>;
}

/** A history with weekday closes of `value` from `from` to `to` (inclusive). */
export function weekdayCloses(from: string, to: string, value = '10'): HistoryClose[] {
  const out: HistoryClose[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: value });
  }
  return out;
}

export function history(closes: HistoryClose[], extra: Partial<YahooHistory> = {}): YahooHistory {
  return {
    closes,
    splits: [],
    timeZone: 'Australia/Sydney',
    currency: 'AUD',
    firstTradeDate: null,
    ...extra,
  };
}

/** Waits for `gate` unless `signal` aborts first; true when aborted. */
async function waitGate(gate: Promise<void> | undefined, signal: AbortSignal): Promise<boolean> {
  if (!gate) return signal.aborted;
  await Promise.race([
    gate,
    new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    ),
  ]);
  return signal.aborted;
}

export function scriptedYahooHistory(
  now: () => Date,
  defaultCloses: (req: YahooHistoryRequest) => HistoryClose[],
): ScriptedYahooHistory {
  const client: ScriptedYahooHistory = {
    id: 'yahoo',
    requests: [],
    answers: new Map(),
    gates: new Map(),
    async fetchHistory(req, signal) {
      client.requests.push({ ...req, at: now().getTime() });
      if (await waitGate(client.gates.get(req.symbol), signal)) {
        return { ok: false, kind: 'skipped', error: 'Aborted' };
      }
      const answer = client.answers.get(req.symbol);
      if (answer) return answer(req);
      const currency = /^(AUDUSD=X|SI=F|GC=F|EXUS)$/.test(req.symbol) ? 'USD' : 'AUD';
      return { ok: true, history: history(defaultCloses(req), { currency }) };
    },
  };
  return client;
}

export interface ScriptedCoinHistory extends CoinHistoryClient {
  calls: Array<{ id: string; days: number; daily: boolean; at: number }>;
  answers: Map<string, (days: number, daily: boolean) => CoinHistoryResult>;
  gate: Promise<void> | null;
}

export function scriptedCoinHistory(
  now: () => Date,
  defaultPoints: (id: string, days: number, daily: boolean) => Array<[number, number]>,
): ScriptedCoinHistory {
  const client: ScriptedCoinHistory = {
    id: 'coingecko',
    calls: [],
    answers: new Map(),
    gate: null,
    async fetchHistory(id, days, daily, signal) {
      client.calls.push({ id, days, daily, at: now().getTime() });
      if (await waitGate(client.gate ?? undefined, signal)) {
        return { ok: false, kind: 'skipped', error: 'Aborted' };
      }
      const answer = client.answers.get(id);
      if (answer) return answer(days, daily);
      return { ok: true, prices: defaultPoints(id, days, daily) };
    },
  };
  return client;
}
