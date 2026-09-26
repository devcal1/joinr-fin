import type { OtherAssetDto } from '@joinr/schema';
import { otherAssetsPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import {
  applyAssetChange,
  assetCreateBody,
  assetDraftOf,
  assetUnchanged,
  assetUpdateBody,
  currencyOptions,
  validateAsset,
} from './assetDraft';
import { priceMarkers, priceRowChanged, sellableUnits, type PriceEdit } from './otherAssetsText';

const TODAY = '2026-09-24';
const assets = otherAssetsPages.populated.assets;
const byId = (id: number): OtherAssetDto => {
  const asset = assets.find((a) => a.id === id);
  if (!asset) throw new Error(`no asset ${id}`);
  return asset;
};

describe('the asset form (§4.3 refines, §6.3 item 4)', () => {
  it('bullion needs a metal and oz per unit, and is priced in AUD', () => {
    let draft = assetDraftOf(undefined, TODAY);
    draft = { ...draft, description: 'Silver bar', units: '10', currency: 'USD' };
    draft = applyAssetChange(draft, 'priceSource', 'bullion');
    expect(draft.currency).toBe('AUD');
    expect(validateAsset(draft, { create: true, today: TODAY })).toMatchObject({
      metal: 'Choose the metal.',
      ozPerUnit: 'Enter the ounces in each unit.',
    });
    draft = { ...draft, metal: 'silver', ozPerUnit: '1' };
    expect(validateAsset(draft, { create: true, today: TODAY })).toEqual({});
    const body = assetCreateBody(draft);
    expect(body).toMatchObject({
      priceSource: 'bullion',
      metal: 'silver',
      ozPerUnit: '1',
      currency: 'AUD',
      purchaseFxRate: null,
      price: null,
    });
  });

  it('manual clears the bullion fields; FX at purchase only for a foreign currency', () => {
    let draft = { ...assetDraftOf(byId(4), TODAY) };
    draft = applyAssetChange(draft, 'priceSource', 'manual');
    expect(draft.metal).toBe('');
    expect(draft.ozPerUnit).toBe('');
    draft = { ...draft, fxQuoted: '1.5' };
    // AUD: the typed quote is ignored (never sent).
    expect(assetUpdateBody(draft, byId(4)).purchaseFxRate).toBeNull();
    draft = applyAssetChange(draft, 'currency', 'USD');
    draft = { ...draft, fxQuoted: '1.5' };
    expect(assetUpdateBody(draft, byId(4)).purchaseFxRate).toBe('1.5');
  });

  it('FX at purchase is blanked when the currency or the purchase date changes (§4.5 step 4)', () => {
    const print = byId(3);
    let draft = assetDraftOf(print, TODAY);
    expect(draft.fxQuoted).toBe('1.5');
    draft = applyAssetChange(draft, 'purchaseDate', '2024-05-11');
    expect(draft.fxQuoted).toBe('');
    draft = assetDraftOf(print, TODAY);
    draft = applyAssetChange(draft, 'currency', 'EUR');
    expect(draft.fxQuoted).toBe('');
    // Unchanged: the stored rate is echoed as it was, and nothing differs.
    draft = assetDraftOf(print, TODAY);
    expect(assetUpdateBody(draft, print).purchaseFxRate).toBe('1.5');
    expect(assetUnchanged(draft, print)).toBe(true);
  });

  it('GBX asks for AUD per 1 GBP and stores the per-penny rate (÷ 100)', () => {
    const banknote = byId(11);
    const draft = { ...assetDraftOf(banknote, TODAY), fxQuoted: '1.9012' };
    expect(assetUpdateBody(draft, banknote).purchaseFxRate).toBe('0.019012');
  });

  it('checks the words the server would refuse', () => {
    const draft = { ...assetDraftOf(undefined, TODAY), url: 'example.com', units: '0' };
    expect(validateAsset(draft, { create: true, today: TODAY })).toMatchObject({
      description: 'Enter a description.',
      url: 'Enter a link starting with http:// or https://.',
      units: 'Enter more than zero units.',
    });
    expect(
      validateAsset(
        { ...draft, description: 'X', url: '', units: '1', purchaseDate: '2026-09-30' },
        { create: true, today: TODAY },
      ),
    ).toEqual({ purchaseDate: 'Enter a date no later than tomorrow.' });
  });

  it('a new manual item may carry its first price and its date', () => {
    const draft = {
      ...assetDraftOf(undefined, TODAY),
      description: 'Example vase',
      units: '1',
      unitCost: '100',
      price: '120',
    };
    expect(assetCreateBody(draft).price).toEqual({ unitPrice: '120', asOf: TODAY });
  });

  it('the currency choices, plus a stored code outside them', () => {
    const codes = currencyOptions(null).map((o) => o.value);
    expect(codes).toEqual([
      'AUD',
      'USD',
      'EUR',
      'GBP',
      'GBX',
      'NZD',
      'JPY',
      'CAD',
      'CHF',
      'HKD',
      'SGD',
    ]);
    expect(currencyOptions(null).find((o) => o.value === 'GBX')?.label).toBe('GBX (UK pence)');
    expect(currencyOptions('SEK').at(-1)).toEqual({ value: 'SEK', label: 'SEK' });
  });
});

describe('Update prices and the price markers (D72, UX-6)', () => {
  const edit = (
    drafts: Record<number, string>,
    current: Record<number, boolean> = {},
  ): PriceEdit => ({
    drafts,
    current,
    asOf: TODAY,
    pending: false,
    onDraft: () => undefined,
    onCurrent: () => undefined,
  });

  it('a row counts when its price changed or Still current is ticked; bullion never', () => {
    expect(priceRowChanged(edit({ 1: '1800' }), byId(1))).toBe(false);
    expect(priceRowChanged(edit({ 1: '1850' }), byId(1))).toBe(true);
    expect(priceRowChanged(edit({ 1: '1800.00' }), byId(1))).toBe(false);
    expect(priceRowChanged(edit({ 2: '2600' }, { 2: true }), byId(2))).toBe(true);
    expect(priceRowChanged(edit({ 4: '60' }), byId(4))).toBe(false);
    // An unpriced item counts once a price is typed.
    expect(priceRowChanged(edit({ 9: '' }), byId(9))).toBe(false);
    expect(priceRowChanged(edit({ 9: '95' }), byId(9))).toBe(true);
  });

  it('Stale, Spot, Last known and No price yet; never Manual', () => {
    expect(priceMarkers(byId(1))).toEqual([]);
    expect(priceMarkers(byId(2))).toEqual(['stale']);
    expect(priceMarkers(byId(4))).toEqual(['spot']);
    expect(priceMarkers(byId(5))).toEqual(['stale']);
    expect(priceMarkers(byId(9))).toEqual(['noPriceYet']);
    const fallback = otherAssetsPages.marketOff.assets.find((a) => a.id === 4);
    expect(fallback && priceMarkers(fallback)).toEqual(['lastKnown']);
  });

  it('a sale may take the units left, plus its own when edited', () => {
    expect(sellableUnits(byId(8))).toBe(2);
    const sale = otherAssetsPages.populated.sales[0];
    expect(sale && sellableUnits(byId(8), sale)).toBe(3);
  });
});
