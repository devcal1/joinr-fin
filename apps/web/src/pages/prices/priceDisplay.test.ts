import type { PriceItem } from '@joinr/schema';
import {
  FIXTURE_NOW,
  marketSeries,
  priceItems,
  pricesEmpty,
  pricesLive,
  pricesOff,
  refreshResponse,
} from '@joinr/schema/fixtures';
import { formatDate, formatTime } from '@joinr/ui';
import { describe, expect, it } from 'vitest';
import {
  formatItemPrice,
  formatSeriesValue,
  kindLabel,
  orderSeries,
  refreshLine,
  refreshSummaryText,
  sourceLabel,
  statusReason,
} from './priceDisplay';

const item = (symbol: string): PriceItem => {
  const found = priceItems.find((i) => i.symbol === symbol);
  if (!found) throw new Error(symbol);
  return found;
};

describe('price display', () => {
  it('names sources and kinds', () => {
    expect(sourceLabel({ priceSource: 'yahoo' })).toBe('Yahoo');
    expect(sourceLabel({ priceSource: 'coingecko' })).toBe('CoinGecko');
    expect(sourceLabel({ priceSource: 'manual' })).toBe('Manual');
    expect(sourceLabel({ priceSource: 'sheet' })).toBe('From workbook');
    expect(sourceLabel({ priceSource: 'fake' })).toBe('Test prices');
    expect(sourceLabel({ priceSource: null })).toBeNull();
    expect(kindLabel('managed_fund')).toBe('Managed fund');
    expect(kindLabel('etf')).toBe('ETF');
  });

  it('formats prices with 2–4 decimals, or up to 8 below $1', () => {
    expect(formatItemPrice('12.5')).toBe('$12.50');
    expect(formatItemPrice('100000')).toBe('$100,000.00');
    expect(formatItemPrice('1.23456')).toBe('$1.2346');
    expect(formatItemPrice('0.00012345')).toBe('$0.00012345');
  });

  it('explains every non-fresh status', () => {
    expect(statusReason(item('ASX:XYZ'))).toBe('From workbook 31/08/2026');
    expect(statusReason(item('ASX:DEF'))).toBe('Symbol not found');
    expect(statusReason(item('EXAMPLEFUND2'))).toBe('No price source');
    expect(statusReason(item('ASX:OLD'))).toBe('Not fetched yet');
    expect(statusReason(item('EXAMPLEFUND3'))).toBe('Manual price from 01/07/2026');
    expect(statusReason(item('ETH'))).toBeNull();
    expect(statusReason(item('ASX:ABC'))).toBeNull();
    expect(statusReason(item('EXAMPLEFUND'))).toBeNull();
  });

  it('writes the refresh line', () => {
    const now = new Date(FIXTURE_NOW);
    const last = new Date(pricesLive.lastRun.finishedAt);
    const next = new Date(pricesLive.nextRefreshAt);
    expect(refreshLine(pricesLive, now)).toBe(
      `Refreshed ${formatTime(last)} · next ${formatTime(next)}`,
    );
    expect(refreshLine(pricesEmpty, now)).toBe(
      `Not refreshed yet · next ${formatTime(new Date(pricesEmpty.nextRefreshAt))}`,
    );
    expect(refreshLine(pricesOff, now)).toBe('Not refreshed yet');
    const later = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    expect(refreshLine({ ...pricesLive, nextRefreshAt: null }, later)).toBe(
      `Refreshed ${formatDate(last)} ${formatTime(last)}`,
    );
  });

  it('summarises a refresh', () => {
    expect(refreshSummaryText(refreshResponse.summary)).toBe('6 prices updated; 2 failed.');
    expect(refreshSummaryText({ ...refreshResponse.summary, ok: 1, failed: 0, skipped: 3 })).toBe(
      '1 price updated; 3 skipped.',
    );
    expect(refreshSummaryText({ ...refreshResponse.summary, ok: 18, failed: 1, skipped: 0 })).toBe(
      '18 prices updated; 1 failed.',
    );
  });

  it('orders and formats the market series', () => {
    expect(orderSeries(marketSeries).map((s) => s.seriesId)).toEqual([
      'AUDUSD',
      'XAG_AUD_OZ',
      'XAU_AUD_OZ',
      'SI_USD_OZ',
      'GC_USD_OZ',
    ]);
    expect(
      orderSeries([{ ...marketSeries[0]!, seriesId: 'FX_GBPAUD' }, ...marketSeries])[5]?.seriesId,
    ).toBe('FX_GBPAUD');
    expect(formatSeriesValue({ value: '0.65', unit: 'USD per AUD' })).toBe('0.65 USD per AUD');
    expect(formatSeriesValue({ value: '46.153846153846', unit: 'AUD per oz' })).toBe('$46.15');
    expect(formatSeriesValue({ value: '2600', unit: 'USD per oz' })).toBe('US$2,600.00');
    expect(formatSeriesValue({ value: null, unit: 'AUD per oz' })).toBeNull();
  });
});
