// Pricing helpers (stage-1.md §2.7, frozen, pure).
import type { InstrumentKind, PriceProvider } from './enums';

/** Exchange prefix (as in `ASX:ABC`) → Yahoo symbol suffix. */
export const YAHOO_EXCHANGE_SUFFIXES: Readonly<Record<string, string>> = {
  ASX: '.AX',
  NZE: '.NZ',
  LON: '.L',
  TSE: '.TO',
  NYSE: '',
  NASDAQ: '',
  NYSEARCA: '',
  NYSEAMERICAN: '',
  BATS: '',
};

/** The only CoinGecko ids known up front; everything else is resolved by search at refresh. */
export const COINGECKO_KNOWN_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
};

/** Bullion futures rows of the sheet's Managed Funds tab (D23). */
export const BULLION_FEEDS: Readonly<Record<string, 'silver' | 'gold'>> = {
  'SI=F': 'silver',
  'GC=F': 'gold',
};

export type MarketSeriesId = 'AUDUSD' | 'SI_USD_OZ' | 'GC_USD_OZ' | 'XAG_AUD_OZ' | 'XAU_AUD_OZ';

export interface MarketSeriesDef {
  label: string;
  unit: string;
  /** The Yahoo symbol fetched for this series. */
  yahoo?: string;
  /** `[numerator, denominator]` series ids: value = numerator / denominator. */
  derivedFrom?: [string, string];
}

/** The built-in market series (D23, D25). Dynamic `FX_<CCY>AUD` series are added at refresh. */
export const MARKET_SERIES: Readonly<Record<MarketSeriesId, MarketSeriesDef>> = {
  AUDUSD: { label: 'AUD/USD', unit: 'USD per AUD', yahoo: 'AUDUSD=X' },
  SI_USD_OZ: { label: 'Silver (USD/oz)', unit: 'USD per oz', yahoo: 'SI=F' },
  GC_USD_OZ: { label: 'Gold (USD/oz)', unit: 'USD per oz', yahoo: 'GC=F' },
  XAG_AUD_OZ: {
    label: 'Silver (AUD/oz)',
    unit: 'AUD per oz',
    derivedFrom: ['SI_USD_OZ', 'AUDUSD'],
  },
  XAU_AUD_OZ: { label: 'Gold (AUD/oz)', unit: 'AUD per oz', derivedFrom: ['GC_USD_OZ', 'AUDUSD'] },
};

export const MARKET_SERIES_IDS = Object.keys(MARKET_SERIES) as MarketSeriesId[];

const YAHOO_LIKE_RE = /^[A-Z0-9^.-]+(\.[A-Z]{1,3}|=F|=X)$/;
const MORNINGSTAR_ID_RE = /^0P[0-9A-Z]{8}/;

/** True when a managed-fund id already looks like a Yahoo symbol (`ABC.AX`, `SI=F`, `0P…`). */
export function looksLikeYahooSymbol(id: string): boolean {
  return YAHOO_LIKE_RE.test(id) || MORNINGSTAR_ID_RE.test(id);
}

/**
 * The default price source of an instrument:
 * - stock/ETF with a known exchange → `yahoo`, `${code}${suffix}`; unknown or no exchange → `none`;
 * - managed fund → `yahoo` with the id as-is when it looks like a Yahoo symbol, else `none`;
 * - crypto → `coingecko` with the known id, or `null` (resolved by search at refresh).
 */
export function derivePriceSource(i: {
  kind: InstrumentKind;
  symbol: string;
  exchange: string | null;
  code: string;
}): { provider: PriceProvider; providerSymbol: string | null } {
  switch (i.kind) {
    case 'stock':
    case 'etf': {
      const suffix =
        i.exchange !== null && Object.hasOwn(YAHOO_EXCHANGE_SUFFIXES, i.exchange)
          ? YAHOO_EXCHANGE_SUFFIXES[i.exchange]
          : undefined;
      return suffix === undefined
        ? { provider: 'none', providerSymbol: null }
        : { provider: 'yahoo', providerSymbol: `${i.code}${suffix}` };
    }
    case 'managed_fund':
      return looksLikeYahooSymbol(i.symbol)
        ? { provider: 'yahoo', providerSymbol: i.symbol }
        : { provider: 'none', providerSymbol: null };
    case 'crypto': {
      const id = Object.hasOwn(COINGECKO_KNOWN_IDS, i.symbol)
        ? COINGECKO_KNOWN_IDS[i.symbol]
        : undefined;
      return { provider: 'coingecko', providerSymbol: id ?? null };
    }
  }
}
