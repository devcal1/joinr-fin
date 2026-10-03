// The phone API (stage-9.md §4.3, FROZEN): `GET /api/mobile/today`, `GET /api/mobile/device` and
// `POST /api/mobile/pair`; Stage 10 adds `GET /api/mobile/periods` (stage-10.md §4.2, FROZEN,
// additive: the Stage 9 types are untouched). Times are UTC ISO with milliseconds; decimals are
// strings; money is integer cents. The key appears only in `MobilePairResponse` (the 201 body); no
// DTO carries a key hash.
import type {
  DayStatus,
  MarketState,
  MobileHoldingKind,
  PeriodStatus,
  PriceStatus,
  ServerPeriod,
} from '../enums';
import type { DecimalString, IsoDate } from '../primitives';

/** Integer cents (a safe integer). */
type Cents = number;

export interface MobileLineDto {
  sessionDate: IsoDate;
  timeZone: string;
  /** Previous close in its own currency (crypto: the 00:00 price; bullion: the AUD spot at 00:00). */
  base: DecimalString | null;
  /** Unix seconds, own currency, ascending, ≤ LINE_MAX_POINTS. */
  points: Array<[number, DecimalString]>;
}

export interface MobileHoldingDto {
  /** Unique and stable: holdingKey(id) ('i12') or 'bullion-gold'/'bullion-silver'; the app's id for navigation and widgets. */
  key: string;
  /** Null for bullion. */
  instrumentId: number | null;
  /** + 'bullion' (D148). */
  kind: MobileHoldingKind;
  /** instruments.code: 'ABC', 'BTC', 'EXAMPLEFUND'; bullion: 'GOLD', 'SILVER'. */
  code: string;
  /** instruments.symbol: 'ASX:ABC'; bullion: the futures' 'GC=F', 'SI=F'. */
  symbol: string;
  /** Bullion: 'Gold bullion', 'Silver bullion'. */
  name: string | null;
  /** Bullion: the Other Assets rows summed; else null. */
  items: number | null;
  /** Engine openUnits; bullion: troy ounces. */
  units: DecimalString;
  priceStatus: PriceStatus;
  /** AUD (the engine's); bullion: AUD per ounce (the spot). */
  price: DecimalString | null;
  priceAsOf: string | null;
  valueCents: Cents | null;
  weightRatio: DecimalString | null;
  dayStatus: DayStatus;
  /** AUD (B). */
  previousClose: DecimalString | null;
  /** AUD. */
  changePerUnit: DecimalString | null;
  /** AUD price move. */
  dayRatio: DecimalString | null;
  dayCents: Cents | null;
  /** '0' when none. */
  newUnits: DecimalString;
  /** Non-AUD only (bullion: the futures in USD/oz since 00:00 Melbourne). */
  native: {
    currency: string;
    price: DecimalString;
    previousClose: DecimalString | null;
    dayRatio: DecimalString | null;
  } | null;
  session: { date: IsoDate; timeZone: string; daily: boolean } | null;
  line: MobileLineDto | null;
  /** Bullion: costCents = Σ the rows' engine costCents (null when any held row's cost is unknown); averagePrice per ounce. */
  position: {
    costCents: Cents | null;
    unrealisedCents: Cents | null;
    unrealisedRatio: DecimalString | null;
    averagePrice: DecimalString | null;
  };
}

export interface MobilePortfolioLineDto {
  from: string;
  to: string;
  sessionDate: IsoDate;
  /** Unix seconds, day change in cents; last = totals.dayCents. */
  points: Array<[number, Cents]>;
}

export interface MobileTodayResponse {
  apiVersion: 1;
  serverVersion: string;
  generatedAt: string;
  /** The server's zone: the app shows every time in it. */
  timeZone: string;
  localDate: IsoDate;
  market: { asx: MarketState; asxSessionDate: IsoDate | null };
  freshness: {
    latestPriceAt: string | null;
    oldestPriceAt: string | null;
    lastFetchAt: string | null;
    stale: number;
    failed: number;
    manual: number;
    unpriced: number;
  };
  totals: {
    valueCents: Cents;
    dayCents: Cents | null;
    dayRatio: DecimalString | null;
    up: number;
    down: number;
    flat: number;
    noChange: number;
    holdings: number;
  };
  portfolioLine: MobilePortfolioLineDto | null;
  /** Held only; valueCents desc, unpriced last, then code. */
  holdings: MobileHoldingDto[];
}

export interface MobileDeviceResponse {
  apiVersion: 1;
  serverVersion: string;
  deviceId: string;
  label: string;
  pairedAt: string;
  timeZone: string;
}

export interface MobilePairRequest {
  code: string;
  deviceName?: string;
  appVersion?: string;
}

export interface MobilePairResponse {
  apiVersion: 1;
  serverVersion: string;
  deviceId: string;
  label: string;
  key: string;
}

// ─── Stage 10: GET /api/mobile/periods (stage-10.md §4.2, FROZEN; additive) ─────────────────────

/** One per held holding, /today's order and keys. */
export interface MobilePeriodHoldingDto {
  key: string;
  instrumentId: number | null;
  kind: MobileHoldingKind;
  code: string;
  symbol: string;
  name: string | null;
  items: number | null;
  units: DecimalString;
  priceStatus: PriceStatus;
  price: DecimalString | null;
  priceAsOf: string | null;
  valueCents: Cents | null;
  weightRatio: DecimalString | null;
}

export interface MobilePeriodFigureDto {
  /** A holding's key, or SOLD_HOLDINGS_KEY (ALL only). */
  key: string;
  status: PeriodStatus;
  cents: Cents | null;
  ratio: DecimalString | null;
  // 1W–12M (null under ALL)
  /** B in AUD (bullion: per oz). */
  startClose: DecimalString | null;
  /** b. */
  startCloseDate: IsoDate | null;
  changePerUnit: DecimalString | null;
  priceRatio: DecimalString | null;
  /** '0' when none. */
  startUnits: DecimalString;
  newUnits: DecimalString;
  laterUnits: DecimalString;
  /** centsOf(Σ within lots remaining × lot price); null when no within lot. */
  newCostCents: Cents | null;
  // ALL (null for 1W–12M): the detail's ALL rows (§9.5)
  unrealisedCents: Cents | null;
  realisedCents: Cents | null;
  costEverCents: Cents | null;
  /** The Sold figure only. */
  soldCount: number | null;
  /** AUD; ≤ PERIOD_HOLDING_POINTS. */
  line: { base: DecimalString | null; points: Array<[IsoDate, DecimalString]> } | null;
}

/** ≤ LINE_MAX_POINTS; the last, dated localDate, = totals.cents (1W–12M) or totals.unrealisedCents (ALL, D167). */
export interface MobilePeriodLineDto {
  from: IsoDate;
  to: IsoDate;
  points: Array<[IsoDate, Cents]>;
}

export interface MobilePeriodDto {
  period: ServerPeriod;
  /** S; null for ALL. */
  startDate: IsoDate | null;
  totals: {
    cents: Cents | null;
    ratio: DecimalString | null;
    baseCents: Cents | null;
    up: number;
    down: number;
    flat: number;
    missing: number;
    holdings: number;
    partial: boolean;
    /**
     * ALL only (null for 1W–12M): the ALL line's last point (D167). Kept for the line's caption and
     * spoken summary (§9.4), not for a header row (D168: the row stays VAL · INVESTED · GAIN).
     */
    unrealisedCents: Cents | null;
    /** ALL only (null for 1W–12M): the ALL figure minus the line's last point. */
    realisedCents: Cents | null;
  };
  line: MobilePeriodLineDto | null;
  /** One per held holding (holdings order), then the Sold figure (ALL). */
  figures: MobilePeriodFigureDto[];
}

export interface MobilePeriodsResponse {
  /** Stays 1 (§9.3). */
  apiVersion: 1;
  serverVersion: string;
  generatedAt: string;
  timeZone: string;
  localDate: IsoDate;
  /**
   * The OLDEST of the per-series newest stored closes over the held holdings' close series and the
   * FX/spot series they need (§5.1 targets only); null when none.
   */
  closesThrough: IsoDate | null;
  /** = /today's totals.valueCents for the same prices. */
  valueCents: Cents;
  holdings: MobilePeriodHoldingDto[];
  /** SERVER_PERIODS order, always seven. */
  periods: MobilePeriodDto[];
}
