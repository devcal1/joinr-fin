// The `closes` job's targets (stage-10.md §5.1): every held instrument priced by Yahoo or CoinGecko,
// the FX and futures series they and the held bullion rows need, and per target whether a run
// backfills, tops up or skips it. Read-only on the database; read at the start of each run. The
// once-a-day and completed-backfill memory lives in process memory (`ClosesMemory`), like the
// Stage 4 `FxBackfillAttempts`.
import {
  BULLION_HOLDINGS,
  CLOSES_BULLION_UNDATED_DAYS,
  CLOSES_LEAD_DAYS,
  COINGECKO_HISTORY_DAYS,
  COINGECKO_HOURLY_DAYS,
  JoinrDecimal,
  MARKET_SERIES,
  PERIOD_START_MAX_GAP_DAYS,
  type InstrumentKind,
  type IsoDate,
  type MarketSeriesId,
  type Metal,
} from '@joinr/schema';
import {
  instrumentCloses,
  otherAssets,
  otherAssetSales,
  seriesCloses,
  trades,
  type JoinrDb,
} from '@joinr/schema/db';
import { eq, inArray, max, min } from 'drizzle-orm';
import { addDaysIso } from '../../lib/dates';
import { fxNeedFor, fxSeriesId, fxYahooSymbol } from '../fx';
import { effectiveSource, loadInstrumentPriceRows } from '../items';

/** A held instrument whose daily closes the job keeps (§5.1). */
export interface InstrumentCloseTarget {
  /** The memory key: id, provider and provider symbol (a source change is a new target). */
  key: string;
  instrumentId: number;
  /** The instrument's identity when the run chose it (the write-time check, §5.6). */
  instrumentKind: InstrumentKind;
  symbol: string;
  provider: 'yahoo' | 'coingecko';
  providerSymbol: string;
  /** `prices.native_currency` (the FX the instrument needs, and the currency fallback). */
  nativeCurrency: string | null;
  earliestTrade: IsoDate;
  /** The earliest trade − CLOSES_LEAD_DAYS (crypto: never before localDate − 364). */
  needFrom: IsoDate;
}

/** A metal with a held bullion row: its futures, its derived AUD spot and how far back. */
export interface MetalCloseNeed {
  metal: Metal;
  futuresSeries: MarketSeriesId;
  spotSeries: MarketSeriesId;
  /** The earliest held row's purchase date − 10 days (undated: localDate − 380 days). */
  needFrom: IsoDate;
}

/** A fetched market series (`AUDUSD`, `FX_<CCY>AUD`, the futures). */
export interface SeriesCloseTarget {
  key: string;
  seriesId: string;
  yahooSymbol: string;
  /** The earliest dependant's needFrom − PERIOD_START_MAX_GAP_DAYS (§5.1). */
  needFrom: IsoDate;
  /**
   * What a backfill must reach: the earliest dependant's needFrom. The extra 10 days of `needFrom`
   * are look-back slack (an FX close up to 10 days before a start close), so a series whose first
   * bar falls after a weekend or holiday at `needFrom` is still covered (no backfill per restart).
   */
  coveredFrom: IsoDate;
}

const maxIso = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
const minIso = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

/** Held instruments with their earliest trade date (Σ trade units > 0, as `intradayTargets`). */
function tradeFacts(db: JoinrDb): Map<number, { held: boolean; earliest: IsoDate }> {
  const sums = new Map<number, { units: InstanceType<typeof JoinrDecimal>; earliest: IsoDate }>();
  for (const t of db
    .select({ id: trades.instrumentId, date: trades.tradeDate, units: trades.units })
    .from(trades)
    .all()) {
    const cur = sums.get(t.id);
    if (cur) {
      cur.units = cur.units.plus(t.units);
      cur.earliest = minIso(cur.earliest, t.date);
    } else {
      sums.set(t.id, { units: new JoinrDecimal(t.units), earliest: t.date });
    }
  }
  return new Map(
    [...sums].map(([id, s]) => [id, { held: s.units.greaterThan(0), earliest: s.earliest }]),
  );
}

/** §5.1 Instruments: held, effective source Yahoo or CoinGecko with a provider symbol. */
export function instrumentCloseTargets(db: JoinrDb, localDate: IsoDate): InstrumentCloseTarget[] {
  const facts = tradeFacts(db);
  const out: InstrumentCloseTarget[] = [];
  for (const row of loadInstrumentPriceRows(db)) {
    const fact = facts.get(row.instrument.id);
    if (!fact?.held) continue;
    // A hand price over a provider keeps the provider's closes (P is the hand price, §2.1).
    const src = effectiveSource(row);
    if ((src.provider !== 'yahoo' && src.provider !== 'coingecko') || src.providerSymbol === null)
      continue;
    let needFrom = addDaysIso(fact.earliest, -CLOSES_LEAD_DAYS);
    if (src.provider === 'coingecko') {
      needFrom = maxIso(needFrom, addDaysIso(localDate, -COINGECKO_HISTORY_DAYS));
    }
    out.push({
      key: `i:${row.instrument.id}:${src.provider}:${src.providerSymbol}`,
      instrumentId: row.instrument.id,
      instrumentKind: row.instrument.kind,
      symbol: row.instrument.symbol,
      provider: src.provider,
      providerSymbol: src.providerSymbol,
      nativeCurrency: row.price?.nativeCurrency ?? null,
      earliestTrade: fact.earliest,
      needFrom,
    });
  }
  return out;
}

/** §5.1 The metals with a held bullion row (`metal ?? 'silver'`, as the web), silver first. */
export function metalCloseNeeds(db: JoinrDb, localDate: IsoDate): MetalCloseNeed[] {
  const rows = db
    .select({
      id: otherAssets.id,
      units: otherAssets.units,
      soldUnits: otherAssets.soldUnits,
      metal: otherAssets.metal,
      purchaseDate: otherAssets.purchaseDate,
    })
    .from(otherAssets)
    .where(eq(otherAssets.priceSource, 'bullion'))
    .all();
  if (rows.length === 0) return [];
  const sold = new Map<number, InstanceType<typeof JoinrDecimal>>();
  for (const s of db
    .select({ id: otherAssetSales.otherAssetId, units: otherAssetSales.units })
    .from(otherAssetSales)
    .where(
      inArray(
        otherAssetSales.otherAssetId,
        rows.map((r) => r.id),
      ),
    )
    .all()) {
    sold.set(s.id, (sold.get(s.id) ?? new JoinrDecimal(0)).plus(s.units));
  }
  const needFrom = new Map<Metal, IsoDate>();
  for (const r of rows) {
    const remaining = new JoinrDecimal(r.units)
      .minus(r.soldUnits)
      .minus(sold.get(r.id) ?? new JoinrDecimal(0));
    if (!remaining.greaterThan(0)) continue;
    const metal = r.metal ?? 'silver';
    const from =
      r.purchaseDate !== null
        ? addDaysIso(r.purchaseDate, -CLOSES_LEAD_DAYS)
        : addDaysIso(localDate, -CLOSES_BULLION_UNDATED_DAYS);
    const cur = needFrom.get(metal);
    needFrom.set(metal, cur === undefined ? from : minIso(cur, from));
  }
  return (Object.keys(BULLION_HOLDINGS) as Metal[])
    .filter((m) => needFrom.has(m))
    .map((metal) => ({
      metal,
      futuresSeries: BULLION_HOLDINGS[metal].futuresSeries,
      spotSeries: BULLION_HOLDINGS[metal].spotSeries,
      needFrom: needFrom.get(metal)!,
    }));
}

/**
 * §5.1 Series: `AUDUSD` when a target instrument is quoted in USD or a bullion row is held;
 * `FX_<CCY>AUD` for every other non-AUD currency (`GBp`/`GBX` → `GBP`); the futures of each metal in
 * use. `currencyOf` gives each instrument's currency (its stored native currency, or one learned
 * from this run's history answers). Ordered: FX by id, `AUDUSD`, then the futures (silver, gold).
 */
export function seriesCloseTargets(
  instruments: readonly InstrumentCloseTarget[],
  metals: readonly MetalCloseNeed[],
  currencyOf: (t: InstrumentCloseTarget) => string | null = (t) => t.nativeCurrency,
): SeriesCloseTarget[] {
  const deps = new Map<string, { symbol: string; from: IsoDate }>();
  const need = (seriesId: string, symbol: string, from: IsoDate): void => {
    const cur = deps.get(seriesId);
    deps.set(seriesId, { symbol, from: cur === undefined ? from : minIso(cur.from, from) });
  };
  for (const t of instruments) {
    const currency = currencyOf(t);
    if (currency === null) continue;
    const fx = fxNeedFor(currency);
    if (fx?.kind === 'usd') need('AUDUSD', MARKET_SERIES.AUDUSD.yahoo!, t.needFrom);
    else if (fx?.kind === 'cross') need(fxSeriesId(fx.ccy), fxYahooSymbol(fx.ccy), t.needFrom);
  }
  for (const m of metals) {
    need('AUDUSD', MARKET_SERIES.AUDUSD.yahoo!, m.needFrom);
    need(m.futuresSeries, MARKET_SERIES[m.futuresSeries].yahoo!, m.needFrom);
  }
  const rank = (id: string): number =>
    id.startsWith('FX_') ? 0 : id === 'AUDUSD' ? 1 : id === 'SI_USD_OZ' ? 2 : 3;
  return [...deps]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([seriesId, { symbol, from }]) => ({
      key: `s:${seriesId}`,
      seriesId,
      yahooSymbol: symbol,
      needFrom: addDaysIso(from, -PERIOD_START_MAX_GAP_DAYS),
      coveredFrom: from,
    }));
}

/** The oldest and newest stored close of a target. */
export interface StoredRange {
  earliest: IsoDate;
  latest: IsoDate;
}

export function storedInstrumentRanges(
  db: JoinrDb,
  ids: readonly number[],
): Map<number, StoredRange> {
  const out = new Map<number, StoredRange>();
  if (ids.length === 0) return out;
  for (const r of db
    .select({
      id: instrumentCloses.instrumentId,
      earliest: min(instrumentCloses.date),
      latest: max(instrumentCloses.date),
    })
    .from(instrumentCloses)
    .where(inArray(instrumentCloses.instrumentId, [...ids]))
    .groupBy(instrumentCloses.instrumentId)
    .all()) {
    if (r.earliest !== null && r.latest !== null) {
      out.set(r.id, { earliest: r.earliest, latest: r.latest });
    }
  }
  return out;
}

export function storedSeriesRanges(
  db: JoinrDb,
  seriesIds: readonly string[],
): Map<string, StoredRange> {
  const out = new Map<string, StoredRange>();
  if (seriesIds.length === 0) return out;
  for (const r of db
    .select({
      id: seriesCloses.seriesId,
      earliest: min(seriesCloses.date),
      latest: max(seriesCloses.date),
    })
    .from(seriesCloses)
    .where(inArray(seriesCloses.seriesId, [...seriesIds]))
    .groupBy(seriesCloses.seriesId)
    .all()) {
    if (r.earliest !== null && r.latest !== null) {
      out.set(r.id, { earliest: r.earliest, latest: r.latest });
    }
  }
  return out;
}

// ─── Backfill, top-up or skip (§5.1) ────────────────────────────────────────────────────────────

/**
 * The job's process memory: which targets were backfilled-or-tried on which server-local date (the
 * once-a-day rule), which backfills succeeded (complete for this process, even when the feed starts
 * after the first trade) and each Yahoo target's listing date (`firstTradeDate`). A restart forgets
 * it all, so a restart may try a target once more.
 */
export class ClosesMemory {
  private readonly tried = new Map<string, IsoDate>();
  private readonly complete = new Set<string>();
  private readonly listed = new Map<string, IsoDate>();

  triedOn(key: string, localDate: IsoDate): boolean {
    return this.tried.get(key) === localDate;
  }

  markTried(key: string, localDate: IsoDate): void {
    this.tried.set(key, localDate);
  }

  markComplete(key: string): void {
    this.complete.add(key);
  }

  isComplete(key: string): boolean {
    return this.complete.has(key);
  }

  setFirstTradeDate(key: string, date: IsoDate | null): void {
    if (date === null) this.listed.delete(key);
    else this.listed.set(key, date);
  }

  firstTradeDate(key: string): IsoDate | null {
    return this.listed.get(key) ?? null;
  }
}

export type ClosesAction = 'backfill' | 'topup' | 'skip';

/**
 * §5.1: backfill when nothing is stored, or the earliest stored close is later than `coveredFrom`
 * and the target was not tried today and no backfill of it succeeded in this process; skip when
 * nothing is stored and it was already tried today; otherwise top up. A coin whose newest close is
 * more than 87 days old takes the backfill path (a top-up asks for at most 90 days).
 */
export function planTarget(o: {
  stored: StoredRange | null;
  coveredFrom: IsoDate;
  triedToday: boolean;
  complete: boolean;
  /** A coin's top-up gap limit: `localDate` for the 87-day rule; absent for Yahoo targets. */
  coinLocalDate?: IsoDate;
}): ClosesAction {
  if (o.stored === null) return o.triedToday ? 'skip' : 'backfill';
  if (!o.triedToday && !o.complete && o.stored.earliest > o.coveredFrom) return 'backfill';
  if (
    o.coinLocalDate !== undefined &&
    !o.triedToday &&
    o.stored.latest < addDaysIso(o.coinLocalDate, -(COINGECKO_HOURLY_DAYS - 3))
  ) {
    return 'backfill';
  }
  return 'topup';
}

/**
 * What a target must reach (§5.1): Yahoo `max(earliest trade, firstTradeDate)` (the listing date
 * remembered from the last backfill), a coin `max(earliest trade, localDate − 364)`.
 */
export function instrumentCoveredFrom(
  t: InstrumentCloseTarget,
  memory: ClosesMemory,
  localDate: IsoDate,
): IsoDate {
  if (t.provider === 'coingecko') {
    return maxIso(t.earliestTrade, addDaysIso(localDate, -COINGECKO_HISTORY_DAYS));
  }
  const listed = memory.firstTradeDate(t.key);
  return listed === null ? t.earliestTrade : maxIso(t.earliestTrade, listed);
}
