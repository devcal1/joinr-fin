// The periods builder (stage-10.md §6.4): `GET /api/mobile/periods`, all seven periods (1W · 2W ·
// 1M · 3M · 6M · 12M · ALL) in one keyed, read-only answer.
// 1. The engine inputs from the shared loader (`inputs.ts`): every `HoldingResult` and every
//    `LotResult` of the four kinds (no disposals: D167). The today answer is built from the SAME
//    inputs, so the holdings (keys, order, values, prices, statuses) are `/today`'s exactly.
// 2. The stored closes (`db/queries/closes.ts`): the held instruments' closes and splits from
//    min(the 12M start, the earliest remaining lot) − 10 days; the FX series their currencies need
//    from 10 days earlier still (an FX close may lie 10 days before a start close that lies 10 days
//    before S); the AUD bullion spot from the instruments' window. Each instrument's AUD-per-unit
//    series by the `convertToAud` rules, date by date.
// 3. `priceDates` (§2.1 p) in each holding's own date system, then the pure `computePeriods`, then
//    the DTO (figures in the holdings' order, then the Sold figure).
// 4. The `features.*` page switches are ignored (D95, as `/today`).
// Reads only; nothing here writes or fetches.
import {
  computePeriods,
  periodStartDate,
  type DatedValues,
  type HoldingResult,
  type PeriodCloseSeries,
} from '@joinr/engine';
import {
  BULLION_HOLDINGS,
  JoinrDecimal,
  MOBILE_API_VERSION,
  PERIOD_START_MAX_GAP_DAYS,
  SOLD_HOLDINGS_KEY,
  dateInZone,
  type DecimalString,
  type IsoDate,
  type Metal,
  type MobilePeriodDto,
  type MobilePeriodHoldingDto,
  type MobilePeriodsResponse,
  type PriceItem,
} from '@joinr/schema';
import {
  closesThrough as readClosesThrough,
  loadInstrumentCloses,
  loadInstrumentSplits,
  loadSeriesCloses,
} from '../db/queries/closes';
import { loadDayQuotes, type DayQuoteRow } from '../db/queries/dayQuotes';
import { convertToAud, fxNeedFor } from '../market/fx';
import { timeZoneFromSymbol } from '../market/providers/exchangeTime';
import { periodBullionInputs } from './bullion';
import { loadMobileInputs } from './inputs';
import { buildMobileTodayFrom, fetchedOf, fxSeriesOfCurrency, type TodayOptions } from './today';

const METALS: readonly Metal[] = ['silver', 'gold'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const D = (v: DecimalString | number) => new JoinrDecimal(v);

/** `date` ± whole days (calendar arithmetic in UTC: no zone involved). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A date as is, or an instant as its calendar date in `timeZone`; null when unusable. */
export function dateOf(text: string | null | undefined, timeZone: string): IsoDate | null {
  if (text === null || text === undefined) return null;
  if (ISO_DATE_RE.test(text)) return text;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : dateInZone(ms, timeZone);
}

/**
 * The FX series an instrument quoted in `currency` needs (§2.1 B): `{ series: null }` for AUD,
 * `AUDUSD` for USD, `FX_GBPAUD` for GBp/GBX, `FX_<CCY>AUD` otherwise; null for a currency the app
 * cannot convert.
 */
export function fxSeriesNeeded(currency: string): { series: string | null } | null {
  const need = fxNeedFor(currency);
  if (need === null) return null;
  return { series: need.kind === 'aud' ? null : fxSeriesOfCurrency(currency) };
}

/**
 * AUD per native unit by date (§2.1, §6.4 step 2): null for AUD (factor 1); USD → 1 ÷ AUDUSD
 * (rounded as `convertToAud`); GBp/GBX → FX_GBPAUD ÷ 100; others FX_<CCY>AUD. An unsupported
 * currency, or a missing series, gives an empty series (so B is unknown: `no_start`).
 */
export function audPerUnitOf(
  currency: string,
  series: ReadonlyMap<string, DatedValues>,
): DatedValues | null {
  const need = fxSeriesNeeded(currency);
  if (need === null) return [];
  const id = need.series;
  if (id === null) return null;
  const out: Array<readonly [IsoDate, DecimalString]> = [];
  for (const [date, value] of series.get(id) ?? []) {
    const conversion = convertToAud(
      '1',
      currency,
      id === 'AUDUSD' ? { audUsd: value, cross: () => null } : { audUsd: null, cross: () => value },
    );
    if ('fxRate' in conversion && D(conversion.fxRate).greaterThan(0))
      out.push([date, conversion.fxRate]);
  }
  return out;
}

/**
 * p (§2.1) of a held instrument: a hand price's `manualPriceAsOf` in the server's zone; a fetched
 * coin price's as-of in the server's zone; a fetched listing's as-of in its exchange zone (the
 * stored day row's zone, else the zone of the provider symbol's suffix, else the server's); null
 * when no as-of is known.
 */
export function priceDateOf(
  item: PriceItem | undefined,
  day: DayQuoteRow | undefined,
  timeZone: string,
): IsoDate | null {
  if (item === undefined) return null;
  if (item.manual !== null) return dateOf(item.manual.asOf, timeZone);
  const fetched = fetchedOf(item);
  if (fetched === null) return null;
  const zone =
    item.provider === 'coingecko'
      ? timeZone
      : (day?.timeZone ?? timeZoneFromSymbol(item.providerSymbol) ?? timeZone);
  return dateOf(item.fetched?.asOf ?? fetched.asOf, zone);
}

function minDate(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

const isHeld = (h: HoldingResult) => D(h.openUnits).greaterThan(0);

export function buildMobilePeriods(o: TodayOptions): MobilePeriodsResponse {
  // 1. The engine inputs, and the today answer from the same inputs.
  const inputs = loadMobileInputs(o);
  const today = buildMobileTodayFrom(inputs, o);
  const { ctx, localDate, holdings, lots, kinds } = inputs;
  const db = o.deps.database.db;

  const held = holdings.filter(isHeld);
  const heldIds = held.map((h) => h.instrumentId);
  const heldIdSet = new Set(heldIds);
  const otherInput = ctx.otherAssetsInput().assets;
  const otherResults = ctx.otherAssets().assets;
  const otherResultById = new Map(otherResults.map((r) => [r.id, r]));

  // 2. The window: min(the 12M start, the earliest remaining lot, the earliest held bullion row's
  //    purchase date) − 10 days; the FX window 10 days earlier still.
  let earliest: IsoDate | null = periodStartDate(localDate, '12M');
  for (const lot of lots)
    if (heldIdSet.has(lot.instrumentId) && D(lot.remainingUnits).greaterThan(0))
      earliest = minDate(earliest, lot.tradeDate);
  const metalsWithRows = new Set<Metal>();
  const heldMetals = new Set<Metal>();
  for (const a of otherInput) {
    if (a.pricing.source !== 'bullion') continue;
    metalsWithRows.add(a.pricing.metal);
    const result = otherResultById.get(a.id);
    if (result === undefined || !D(result.remainingUnits).greaterThan(0)) continue;
    heldMetals.add(a.pricing.metal);
    earliest = minDate(earliest, a.purchaseDate);
  }
  const windowFrom = addDays(earliest ?? localDate, -PERIOD_START_MAX_GAP_DAYS);
  const fxFrom = addDays(windowFrom, -PERIOD_START_MAX_GAP_DAYS);

  const instrumentCloses = loadInstrumentCloses(db, heldIds, windowFrom);
  const splits = loadInstrumentSplits(db, heldIds);
  const fxIds = new Set<string>();
  for (const { currency } of instrumentCloses.values()) {
    const id = fxSeriesNeeded(currency)?.series ?? null;
    if (id !== null) fxIds.add(id);
  }
  const series = loadSeriesCloses(db, [...fxIds], fxFrom);
  const spotIds = METALS.filter((m) => metalsWithRows.has(m)).map(
    (m) => BULLION_HOLDINGS[m].spotSeries,
  );
  const spot = loadSeriesCloses(db, spotIds, windowFrom);

  const closes = new Map<number, PeriodCloseSeries>();
  for (const id of heldIds) {
    const stored = instrumentCloses.get(id);
    const splitDates = splits.get(id) ?? [];
    if (stored === undefined && splitDates.length === 0) continue;
    const currency = stored?.currency ?? 'AUD';
    closes.set(id, {
      currency,
      closes: stored?.closes ?? [],
      audPerUnit: stored === undefined ? null : audPerUnitOf(currency, series),
      splits: splitDates,
    });
  }

  // 3. p, then the rules.
  const dayRows = loadDayQuotes(db, o.log);
  const priceDates = new Map<number, IsoDate | null>();
  for (const id of heldIds)
    priceDates.set(id, priceDateOf(ctx.priceItems.get(id), dayRows.get(id), o.timeZone));

  const todayByKey = new Map(today.holdings.map((h) => [h.key, h]));
  const bullion = periodBullionInputs({
    assets: otherInput,
    results: otherResults,
    price: (metal) => todayByKey.get(BULLION_HOLDINGS[metal].key)?.price ?? null,
    priceDate: (metal) =>
      dateOf(todayByKey.get(BULLION_HOLDINGS[metal].key)?.priceAsOf ?? null, o.timeZone),
    closes: spot,
  });

  const result = computePeriods({
    localDate,
    holdings,
    kinds,
    lots,
    closes,
    priceDates,
    bullion,
  });

  // The figures in the holdings' order (the engine gives input order), then the Sold figure.
  const order = new Map(today.holdings.map((h, i) => [h.key, i]));
  const rank = (key: string) =>
    key === SOLD_HOLDINGS_KEY ? Number.MAX_SAFE_INTEGER : (order.get(key) ?? order.size);
  const periods: MobilePeriodDto[] = result.periods.map((p) => ({
    ...p,
    figures: [...p.figures].sort((a, b) => rank(a.key) - rank(b.key)),
  }));

  // closesThrough over the §5.1 targets: held instruments with a provider, the FX series their
  // currencies need, and the AUD spot of each held metal (with AUDUSD, which it is derived from).
  const targetIds: number[] = [];
  const throughSeries = new Set<string>();
  for (const id of heldIds) {
    const item = ctx.priceItems.get(id);
    if (item === undefined || item.providerSymbol === null) continue;
    if (item.provider !== 'yahoo' && item.provider !== 'coingecko') continue;
    targetIds.push(id);
    const currency = instrumentCloses.get(id)?.currency ?? item.fetched?.nativeCurrency ?? null;
    const fx = currency === null ? null : (fxSeriesNeeded(currency)?.series ?? null);
    if (fx !== null) throughSeries.add(fx);
  }
  for (const metal of heldMetals) {
    throughSeries.add('AUDUSD');
    throughSeries.add(BULLION_HOLDINGS[metal].spotSeries);
  }

  const holdingsDto: MobilePeriodHoldingDto[] = today.holdings.map((h) => ({
    key: h.key,
    instrumentId: h.instrumentId,
    kind: h.kind,
    code: h.code,
    symbol: h.symbol,
    name: h.name,
    items: h.items,
    units: h.units,
    priceStatus: h.priceStatus,
    price: h.price,
    priceAsOf: h.priceAsOf,
    valueCents: h.valueCents,
    weightRatio: h.weightRatio,
  }));

  return {
    apiVersion: MOBILE_API_VERSION,
    serverVersion: o.serverVersion,
    generatedAt: today.generatedAt,
    timeZone: o.timeZone,
    localDate,
    closesThrough: readClosesThrough(db, targetIds, [...throughSeries]),
    valueCents: today.totals.valueCents,
    holdings: holdingsDto,
    periods,
  };
}
