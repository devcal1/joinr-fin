// The kind ↔ path ↔ label map for the investment pages (stage-2.md §6.1, §6.4).
import type { AssetClass, InstrumentKind } from '@joinr/schema';

export type InvestmentPath = '/stocks' | '/etfs' | '/managed-funds' | '/crypto';
export type HoldingDetailPath =
  | '/stocks/$instrumentId'
  | '/etfs/$instrumentId'
  | '/managed-funds/$instrumentId'
  | '/crypto/$instrumentId';

export interface KindMeta {
  kind: InstrumentKind;
  path: InvestmentPath;
  detailPath: HoldingDetailPath;
  /** The page title (h1) and nav name: "ETFs". */
  title: string;
  /** "Dividends", "Distributions" or "Staking". */
  dividendsLabel: string;
  /** One holding: "ETF", "stock", "fund", "coin". */
  noun: string;
  /** Holdings of the kind in prose: "ETFs", "stocks", "managed funds", "crypto holdings". */
  plural: string;
  /** The yield column's header. */
  yieldLabel: string;
  /** The holding form's symbol hint. */
  symbolHint: string;
  /** The allocation switch's per-holding option. */
  holdingSliceLabel: string;
  /** Sector, regions (location, management fee) apply to the kind. */
  hasSector: boolean;
  hasRegions: boolean;
}

export const KIND_META: Readonly<Record<InstrumentKind, KindMeta>> = {
  stock: {
    kind: 'stock',
    path: '/stocks',
    detailPath: '/stocks/$instrumentId',
    title: 'Stocks',
    dividendsLabel: 'Dividends',
    noun: 'stock',
    plural: 'stocks',
    yieldLabel: 'Yield',
    symbolHint: 'EXCHANGE:CODE, e.g. ASX:ABC',
    holdingSliceLabel: 'By holding',
    hasSector: true,
    hasRegions: false,
  },
  etf: {
    kind: 'etf',
    path: '/etfs',
    detailPath: '/etfs/$instrumentId',
    title: 'ETFs',
    dividendsLabel: 'Distributions',
    noun: 'ETF',
    plural: 'ETFs',
    yieldLabel: 'Yield',
    symbolHint: 'EXCHANGE:CODE, e.g. ASX:ABC',
    holdingSliceLabel: 'By holding',
    hasSector: true,
    hasRegions: true,
  },
  managed_fund: {
    kind: 'managed_fund',
    path: '/managed-funds',
    detailPath: '/managed-funds/$instrumentId',
    title: 'Managed Funds',
    dividendsLabel: 'Distributions',
    noun: 'fund',
    plural: 'managed funds',
    yieldLabel: 'Yield',
    symbolHint: 'The fund code or price symbol, e.g. EXAMPLEFUND',
    holdingSliceLabel: 'By holding',
    hasSector: true,
    hasRegions: true,
  },
  crypto: {
    kind: 'crypto',
    path: '/crypto',
    detailPath: '/crypto/$instrumentId',
    title: 'Crypto',
    dividendsLabel: 'Staking',
    noun: 'coin',
    plural: 'crypto holdings',
    yieldLabel: 'Staking yield',
    symbolHint: 'Coin symbol, e.g. BTC',
    holdingSliceLabel: 'By coin',
    hasSector: false,
    hasRegions: false,
  },
};

/** Asset class labels (ASSET_CLASSES order: Net Worth B38:B43). */
export const ASSET_CLASS_LABELS: Readonly<Record<AssetClass, string>> = {
  etf: 'ETFs',
  stock: 'Stocks',
  crypto: 'Crypto',
  cash: 'Cash savings',
  managed_fund: 'Managed funds',
  other_assets: 'Other assets',
};

/** The asset class an investment kind belongs to (the engine's `assetClassOfKind`). */
export const ASSET_CLASS_OF_KIND: Readonly<Record<InstrumentKind, AssetClass>> = {
  stock: 'stock',
  etf: 'etf',
  managed_fund: 'managed_fund',
  crypto: 'crypto',
};
