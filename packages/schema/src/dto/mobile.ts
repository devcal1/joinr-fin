// The phone API (stage-9.md §4.3, FROZEN): `GET /api/mobile/today`, `GET /api/mobile/device` and
// `POST /api/mobile/pair`. Times are UTC ISO with milliseconds; decimals are strings; money is
// integer cents. The key appears only in `MobilePairResponse` (the 201 body); no DTO carries a key
// hash.
import type { DayStatus, MarketState, MobileHoldingKind, PriceStatus } from '../enums';
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
