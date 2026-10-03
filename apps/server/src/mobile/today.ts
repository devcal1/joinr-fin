// The today builder (stage-9.md §6.5): everything the phone app and its widgets show, in one call.
// 1. The same finance context as the web pages (prices, engine, rows), then `compute(kind)` for the
//    four kinds (holdings and lots), loaded by `inputs.ts` (shared with the periods builder).
//    2. The stored days, bullion's days and the FX previous closes; `fxPrev` per non-AUD row. 2a. Bullion from the Other Assets rows (`bullion.ts`). 3. The pure
//    `computeDayChange` (§2) in the server's zone. 4. The display fields (code, symbol, name,
//    position), the lines downsampled, the market state and the freshness. 5. The `features.*`
//    page switches are ignored (D95: they hide pages, not data).
import {
  computeDayChange,
  downsample,
  type DayChangeInput,
  type DayHoldingResult,
  type DayRowInput,
} from '@joinr/engine';
import {
  BULLION_HOLDINGS,
  JoinrDecimal,
  LINE_MAX_POINTS,
  MOBILE_API_VERSION,
  normaliseDecimal,
  type DecimalString,
  type DecimalValue,
  type IsoDate,
  type MobileHoldingDto,
  type MobileTodayResponse,
  type PriceItem,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { FinanceDeps } from '../cashflow/context';
import {
  loadDayQuotes,
  loadFxPreviousCloses,
  loadSeriesDayQuotes,
  type DayQuoteRow,
} from '../db/queries/dayQuotes';
import { convertToAud, isPence } from '../market/fx';
import { bullionInputs, isoInstant, unitCostAudOf, type BullionGroup } from './bullion';
import { loadMobileInputs, type MobileInputs } from './inputs';
import { asxMarketState, newestSessionDate } from './market';

/** An FX previous close older than this many calendar days before the session → `fxPrev` null (§2.1). */
export const FX_PREV_MAX_DAYS = 7;

export interface TodayOptions {
  deps: FinanceDeps;
  /** The server's IANA zone (the response's `timeZone`). */
  timeZone: string;
  serverVersion: string;
  /** True while a Yahoo cool-down is in force (the market state stays `open`, §6.6). */
  yahooCooling: (now: Date) => boolean;
  log?: FastifyBaseLogger;
}

/** The series an FX previous close comes from: USD → AUDUSD, GBp/GBX → FX_GBPAUD, C → FX_<C>AUD. */
export function fxSeriesOfCurrency(currency: string): string {
  if (isPence(currency)) return 'FX_GBPAUD';
  const ccy = currency.toUpperCase();
  return ccy === 'USD' ? 'AUDUSD' : `FX_${ccy}AUD`;
}

const dayNumberOf = (date: IsoDate): number =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) /
  86_400_000;

/**
 * `fxPrev` (§2.1): AUD per native unit at the previous close, from the FX series' own previous
 * close; '1' for AUD; null when the close is unknown or more than 7 days before the session.
 */
export function fxPrevOf(
  currency: string,
  sessionDate: IsoDate,
  closes: ReadonlyMap<string, { value: DecimalString; date: IsoDate }>,
): DecimalString | null {
  if (currency.toUpperCase() === 'AUD' && !isPence(currency)) return '1';
  const close = closes.get(fxSeriesOfCurrency(currency));
  if (close === undefined) return null;
  if (dayNumberOf(sessionDate) - dayNumberOf(close.date) > FX_PREV_MAX_DAYS) return null;
  const usd = closes.get('AUDUSD');
  const conversion = convertToAud('1', currency, {
    audUsd: usd?.value ?? null,
    cross: (ccy) => closes.get(`FX_${ccy}AUD`)?.value ?? null,
  });
  return 'fxRate' in conversion ? conversion.fxRate : null;
}

function dayRowOf(
  row: DayQuoteRow,
  closes: ReadonlyMap<string, { value: DecimalString; date: IsoDate }>,
): DayRowInput {
  return {
    sessionDate: row.sessionDate,
    timeZone: row.timeZone,
    granularity: row.granularity,
    nativeCurrency: row.nativeCurrency,
    previousCloseNative: row.previousClose,
    fxPrev: fxPrevOf(row.nativeCurrency, row.sessionDate, closes),
    points: row.points,
  };
}

/**
 * The engine's `fetched` entry of a fetched price that is the effective one (null for anything
 * else). A hand price wins over a fetch even when it is stale (older than MANUAL_FRESH_DAYS), so
 * any `manual` entry means the fetched row is not the holding's price.
 */
export function fetchedOf(
  item: PriceItem,
): { currency: string; price: DecimalString; fxNow: DecimalString; asOf: string } | null {
  if (item.manual !== null || item.fetched === null) return null;
  const asOf = isoInstant(item.fetched.asOf);
  if (asOf === null) return null;
  const native = item.fetched.nativeCurrency !== null && item.fetched.nativePrice !== null;
  return {
    currency: native ? item.fetched.nativeCurrency! : 'AUD',
    price: native ? item.fetched.nativePrice! : item.fetched.price,
    fxNow: native ? (item.fetched.fxRate ?? '1') : '1',
    asOf,
  };
}

/** a ÷ b at 12 significant digits, half up (the engine's ratio form); null when b is 0. */
function ratio(a: DecimalValue | number, b: DecimalValue | number): DecimalString | null {
  const den = new JoinrDecimal(b);
  if (den.isZero()) return null;
  return normaliseDecimal(
    new JoinrDecimal(a).div(den).toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP),
  );
}

function maxIso(values: Iterable<string | null>): string | null {
  let out: string | null = null;
  for (const v of values) if (v !== null && (out === null || v > out)) out = v;
  return out;
}

function minIso(values: Iterable<string | null>): string | null {
  let out: string | null = null;
  for (const v of values) if (v !== null && (out === null || v < out)) out = v;
  return out;
}

/** The phone's order (§4.3): valueCents desc, unpriced last, then code. */
export function compareHoldings(a: MobileHoldingDto, b: MobileHoldingDto): number {
  if (a.valueCents === null && b.valueCents !== null) return 1;
  if (b.valueCents === null && a.valueCents !== null) return -1;
  if (a.valueCents !== null && b.valueCents !== null && a.valueCents !== b.valueCents)
    return b.valueCents - a.valueCents;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : a.key < b.key ? -1 : 1;
}

export function buildMobileToday(o: TodayOptions): MobileTodayResponse {
  return buildMobileTodayFrom(loadMobileInputs(o), o);
}

/**
 * The today answer from inputs already loaded (stage-10.md §6.2): the periods builder calls it on
 * its own inputs so both answers share one context, one clock and one set of prices.
 */
export function buildMobileTodayFrom(inputs: MobileInputs, o: TodayOptions): MobileTodayResponse {
  // 1. The four kinds (loaded by `loadMobileInputs`).
  const { ctx, now, generatedAt, localDate, holdings, lots, kinds, holdingById } = inputs;
  const db = o.deps.database.db;

  // 2. The stored days.
  const dayRows = loadDayQuotes(db, o.log);
  const seriesDays = loadSeriesDayQuotes(db, o.log);
  const closes = loadFxPreviousCloses(db);
  const days = new Map<number, DayRowInput>();
  for (const [id, row] of dayRows) days.set(id, dayRowOf(row, closes));
  const fetched: DayChangeInput['fetched'] = new Map(
    [...ctx.priceItems.values()].flatMap((item) => {
      const f = fetchedOf(item);
      return f === null ? [] : [[item.instrumentId, f] as const];
    }),
  );

  // 2a. Bullion.
  const groups: BullionGroup[] = bullionInputs({
    assets: ctx.otherAssetsInput().assets,
    results: ctx.otherAssets().assets,
    series: ctx.series,
    seriesDays,
  });

  // 3. The rules.
  const day = computeDayChange({
    timeZone: o.timeZone,
    localDate,
    generatedAt,
    holdings,
    kinds,
    lots,
    fetched,
    days,
    bullion: groups.map((g) => g.input),
  });

  // 4. The display fields.
  const groupByKey = new Map<string, BullionGroup>(
    groups.map((g) => [BULLION_HOLDINGS[g.input.metal].key, g]),
  );
  const out: MobileHoldingDto[] = day.holdings.map((h) => {
    if (h.instrumentId === null) return bullionDto(h, groupByKey.get(h.key));
    const instrument = ctx.instrumentById.get(h.instrumentId);
    const engine = holdingById.get(h.instrumentId);
    return {
      ...common(h),
      code: instrument?.code ?? instrument?.symbol ?? h.key,
      symbol: instrument?.symbol ?? h.key,
      name: instrument?.name ?? null,
      position: {
        costCents: engine?.costCents ?? null,
        unrealisedCents: engine?.unrealisedCents ?? null,
        unrealisedRatio:
          engine !== undefined && engine.unrealisedCents !== null && engine.costCents > 0
            ? ratio(engine.unrealisedCents, engine.costCents)
            : null,
        averagePrice: engine?.averagePrice ?? null,
      },
    };
  });
  out.sort(compareHoldings);

  // The market state and the held ASX listings' sessions.
  const heldAsxSessionDates: IsoDate[] = [];
  for (const h of day.holdings) {
    if (h.instrumentId === null) continue;
    const item = ctx.priceItems.get(h.instrumentId);
    const row = dayRows.get(h.instrumentId);
    if (row !== undefined && item?.providerSymbol?.toUpperCase().endsWith('.AX'))
      heldAsxSessionDates.push(row.sessionDate);
  }

  // Freshness (§4.3): over held, non-manual, priced holdings (bullion: the spot's times).
  const fetchedTimes: (string | null)[] = [];
  const asOfTimes: (string | null)[] = [];
  let stale = 0;
  let failed = 0;
  let manual = 0;
  let unpriced = 0;
  for (const h of day.holdings) {
    if (h.price === null) {
      unpriced += 1;
      continue;
    }
    if (h.priceStatus === 'stale') stale += 1;
    else if (h.priceStatus === 'failed') failed += 1;
    else if (h.priceStatus === 'manual') {
      manual += 1;
      continue;
    }
    asOfTimes.push(h.priceAsOf);
    if (h.instrumentId === null) fetchedTimes.push(groupByKey.get(h.key)?.fetchedAt ?? null);
    else {
      // A (stale) hand price: the fetched row underneath is not its price, so it never counts.
      const item = ctx.priceItems.get(h.instrumentId);
      fetchedTimes.push(
        item === undefined || item.manual !== null
          ? null
          : isoInstant(item.fetched?.fetchedAt ?? null),
      );
    }
  }

  return {
    apiVersion: MOBILE_API_VERSION,
    serverVersion: o.serverVersion,
    generatedAt,
    timeZone: o.timeZone,
    localDate,
    market: {
      asx: asxMarketState({
        nowMs: now.getTime(),
        timeZone: o.timeZone,
        heldAsxSessionDates,
        yahooCooling: o.yahooCooling(now),
      }),
      asxSessionDate: newestSessionDate(heldAsxSessionDates),
    },
    freshness: {
      latestPriceAt: maxIso(asOfTimes),
      oldestPriceAt: minIso(asOfTimes),
      lastFetchAt: maxIso(fetchedTimes),
      stale,
      failed,
      manual,
      unpriced,
    },
    totals: {
      valueCents: day.totals.valueCents,
      dayCents: day.totals.dayCents,
      dayRatio: day.totals.dayRatio,
      up: day.totals.up,
      down: day.totals.down,
      flat: day.totals.flat,
      noChange: day.totals.noChange,
      holdings: day.totals.holdings,
    },
    portfolioLine: day.portfolioLine,
    holdings: out,
  };

  function bullionDto(h: DayHoldingResult, group: BullionGroup | undefined): MobileHoldingDto {
    const def = BULLION_HOLDINGS[h.metal ?? 'silver'];
    const rows = group?.input.rows ?? [];
    const assets = new Map(ctx.otherAssetsInput().assets.map((a) => [a.id, a]));
    let costCents: number | null = rows.length === 0 ? null : 0;
    let costAud: DecimalValue | null = new JoinrDecimal(0);
    let ounces = new JoinrDecimal(0);
    for (const r of rows) {
      costCents =
        costCents === null || r.asset.costCents === null ? null : costCents + r.asset.costCents;
      const oz = new JoinrDecimal(r.asset.remainingUnits).times(r.ozPerUnit);
      ounces = ounces.plus(oz);
      const asset = assets.get(r.asset.id);
      const unitCost = asset === undefined ? null : unitCostAudOf(asset);
      costAud =
        costAud === null || unitCost === null
          ? null
          : costAud.plus(new JoinrDecimal(r.asset.remainingUnits).times(unitCost));
    }
    const unrealisedCents =
      costCents !== null && h.valueCents !== null ? h.valueCents - costCents : null;
    return {
      ...common(h),
      code: def.code,
      symbol: def.symbol,
      name: def.name,
      position: {
        costCents,
        unrealisedCents,
        unrealisedRatio:
          unrealisedCents !== null && costCents !== null && costCents > 0
            ? ratio(unrealisedCents, costCents)
            : null,
        averagePrice: costAud !== null && ounces.greaterThan(0) ? ratio(costAud, ounces) : null,
      },
    };
  }
}

/** The fields the engine computed (§4.3), with the line downsampled to `LINE_MAX_POINTS`. */
function common(
  h: DayHoldingResult,
): Omit<MobileHoldingDto, 'code' | 'symbol' | 'name' | 'position'> {
  return {
    key: h.key,
    instrumentId: h.instrumentId,
    kind: h.kind,
    items: h.items,
    units: h.units,
    priceStatus: h.priceStatus,
    price: h.price,
    priceAsOf: h.priceAsOf,
    valueCents: h.valueCents,
    weightRatio: h.weightRatio,
    dayStatus: h.dayStatus,
    previousClose: h.previousClose,
    changePerUnit: h.changePerUnit,
    dayRatio: h.dayRatio,
    dayCents: h.dayCents,
    newUnits: h.newUnits,
    native: h.native,
    session: h.session,
    line:
      h.line === null
        ? null
        : {
            sessionDate: h.line.sessionDate,
            timeZone: h.line.timeZone,
            base: h.line.base,
            points: downsample(h.line.points, LINE_MAX_POINTS),
          },
  };
}
