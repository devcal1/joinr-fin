// The asset form's model (stage-4.md §4.3, §6.3 item 4): the draft, its checks (the §4.3 refines:
// bullion needs a metal and oz per unit and is priced in AUD; FX at purchase only for a foreign
// currency), the body a Save sends and which fields changed. GBX is quoted per pound in the form
// and stored per penny (÷ 100 on the string). Pure: no React.
import {
  type DecimalString,
  type IsoDate,
  type Metal,
  type OtherAssetCreateBody,
  type OtherAssetDto,
  type OtherAssetPriceSource,
  type OtherAssetUpdateBody,
} from '@joinr/schema';
import { parseDecimal } from '@joinr/ui';
import { tomorrowOf } from '../cashflow/display';
import { quotedFxRate, storedFxRate } from '../assets/display';

/** The currency choices (§6.3): the stored code is added when it is another one. */
export const CURRENCY_CHOICES = [
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
] as const;

export const CURRENCY_LABELS: Readonly<Record<string, string>> = { GBX: 'GBX (UK pence)' };

/** The Select options: the choices plus a stored code outside them. */
export function currencyOptions(stored: string | null): { value: string; label: string }[] {
  const codes: string[] = [...CURRENCY_CHOICES];
  if (stored && !codes.includes(stored)) codes.push(stored);
  return codes.map((code) => ({ value: code, label: CURRENCY_LABELS[code] ?? code }));
}

export interface AssetDraft {
  description: string;
  url: string;
  note: string;
  purchaseDate: IsoDate | null;
  /** Decimal text ('' = empty). */
  units: DecimalString;
  currency: string;
  unitCost: DecimalString;
  /** As quoted: AUD per 1 unit (GBX: per 1 GBP). */
  fxQuoted: DecimalString;
  priceSource: OtherAssetPriceSource;
  metal: Metal | '';
  ozPerUnit: DecimalString;
  /** New manual items: the first price and its date. */
  price: DecimalString;
  priceAsOf: IsoDate | null;
}

export type AssetField =
  | 'description'
  | 'url'
  | 'note'
  | 'purchaseDate'
  | 'units'
  | 'currency'
  | 'unitCost'
  | 'purchaseFxRate'
  | 'priceSource'
  | 'metal'
  | 'ozPerUnit'
  | 'price';

export const ASSET_FIELDS: readonly AssetField[] = [
  'description',
  'url',
  'note',
  'purchaseDate',
  'units',
  'currency',
  'unitCost',
  'purchaseFxRate',
  'priceSource',
  'metal',
  'ozPerUnit',
  'price',
];

export function assetDraftOf(asset: OtherAssetDto | undefined, today: IsoDate): AssetDraft {
  return {
    description: asset?.description ?? '',
    url: asset?.url ?? '',
    note: asset?.note ?? '',
    purchaseDate: asset?.purchaseDate ?? null,
    units: asset?.units ?? '',
    currency: asset?.currency ?? 'AUD',
    unitCost: asset?.unitCost ?? '',
    fxQuoted:
      asset && asset.purchaseFxRate !== null
        ? quotedFxRate(asset.currency, asset.purchaseFxRate)
        : '',
    priceSource: asset?.priceSource ?? 'manual',
    metal: asset?.metal ?? '',
    ozPerUnit: asset?.ozPerUnit ?? '',
    price: '',
    priceAsOf: today,
  };
}

/**
 * A change to the currency or the purchase date blanks FX at purchase (§4.5 step 4: a rate for
 * another date or currency would be wrong); choosing Bullion spot sets the currency to AUD.
 */
export function applyAssetChange<K extends keyof AssetDraft>(
  draft: AssetDraft,
  key: K,
  value: AssetDraft[K],
): AssetDraft {
  const next: AssetDraft = { ...draft, [key]: value };
  if ((key === 'currency' || key === 'purchaseDate') && value !== draft[key]) next.fxQuoted = '';
  if (key === 'priceSource' && value === 'bullion') {
    next.currency = 'AUD';
    next.fxQuoted = '';
    next.price = '';
  }
  if (key === 'priceSource' && value === 'manual') {
    next.metal = '';
    next.ozPerUnit = '';
  }
  return next;
}

const isForeign = (draft: AssetDraft): boolean => draft.currency !== 'AUD';

/** Checks the draft as §4.3 does; field messages in the app's words. */
export function validateAsset(
  draft: AssetDraft,
  options: { create: boolean; today: IsoDate },
): Partial<Record<AssetField, string>> {
  const found: Partial<Record<AssetField, string>> = {};
  const description = draft.description.trim();
  if (!description) found.description = 'Enter a description.';
  else if (description.length > 200) found.description = 'Use at most 200 characters.';
  const url = draft.url.trim();
  if (url.length > 500) found.url = 'Use at most 500 characters.';
  else if (url && !/^https?:\/\/\S+$/i.test(url)) {
    found.url = 'Enter a link starting with http:// or https://.';
  }
  if (draft.note.trim().length > 200) found.note = 'Use at most 200 characters.';
  if (draft.purchaseDate && draft.purchaseDate > tomorrowOf(options.today)) {
    found.purchaseDate = 'Enter a date no later than tomorrow.';
  }
  if (draft.units === '') found.units = 'Enter the units.';
  else if (!(Number(draft.units) > 0)) found.units = 'Enter more than zero units.';
  if (!/^[A-Z]{3}$/.test(draft.currency)) found.currency = 'Choose a currency.';
  if (draft.priceSource === 'bullion') {
    if (draft.metal === '') found.metal = 'Choose the metal.';
    if (draft.ozPerUnit === '') found.ozPerUnit = 'Enter the ounces in each unit.';
    else if (!(Number(draft.ozPerUnit) > 0)) found.ozPerUnit = 'Enter more than zero ounces.';
    if (draft.currency !== 'AUD') found.currency = 'Bullion is priced in AUD.';
  } else if (isForeign(draft) && draft.fxQuoted !== '') {
    if (!(Number(draft.fxQuoted) > 0)) found.purchaseFxRate = 'Enter a rate above zero.';
    else if (storedFxRate(draft.currency, draft.fxQuoted) === null) {
      found.purchaseFxRate = 'Enter a rate like 1.52.';
    }
  }
  if (options.create && draft.priceSource === 'manual' && draft.price !== '') {
    if (!draft.priceAsOf) found.price = 'Enter the date of the price.';
    else if (draft.priceAsOf > tomorrowOf(options.today)) {
      found.price = 'Enter a price date no later than tomorrow.';
    }
  }
  return found;
}

/**
 * The stored FX rate to send: the asset's own stored rate when the quote was left as it was
 * (the form echoes it, §4.5 step 4), the typed quote converted otherwise, null when blank.
 */
function purchaseFxRateOf(draft: AssetDraft, asset: OtherAssetDto | undefined): string | null {
  if (!isForeign(draft) || draft.priceSource === 'bullion' || draft.fxQuoted === '') return null;
  if (
    asset?.purchaseFxRate &&
    asset.currency === draft.currency &&
    Number(quotedFxRate(asset.currency, asset.purchaseFxRate)) === Number(draft.fxQuoted)
  ) {
    return asset.purchaseFxRate;
  }
  return storedFxRate(draft.currency, draft.fxQuoted);
}

/** The `PUT /api/other-assets/:id` body. */
export function assetUpdateBody(
  draft: AssetDraft,
  asset: OtherAssetDto | undefined,
): OtherAssetUpdateBody {
  const bullion = draft.priceSource === 'bullion';
  return {
    description: draft.description.trim(),
    url: draft.url.trim() || null,
    note: draft.note.trim() || null,
    purchaseDate: draft.purchaseDate,
    units: draft.units,
    currency: bullion ? 'AUD' : draft.currency,
    unitCost: draft.unitCost === '' ? null : draft.unitCost,
    purchaseFxRate: purchaseFxRateOf(draft, asset),
    priceSource: draft.priceSource,
    metal: bullion && draft.metal !== '' ? draft.metal : null,
    ozPerUnit: bullion && draft.ozPerUnit !== '' ? draft.ozPerUnit : null,
  };
}

/** The `POST /api/other-assets` body: a manual item may carry its first price. */
export function assetCreateBody(draft: AssetDraft): OtherAssetCreateBody {
  return {
    ...assetUpdateBody(draft, undefined),
    price:
      draft.priceSource === 'manual' && draft.price !== '' && draft.priceAsOf
        ? { unitPrice: draft.price, asOf: draft.priceAsOf }
        : null,
  };
}

const sameDecimal = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : Number(a) === Number(b);

/** True when the body would change nothing on the stored asset (Save stays disabled). */
export function assetUnchanged(draft: AssetDraft, asset: OtherAssetDto): boolean {
  const body = assetUpdateBody(draft, asset);
  return (
    body.description === asset.description &&
    body.url === asset.url &&
    body.note === asset.note &&
    body.purchaseDate === asset.purchaseDate &&
    sameDecimal(body.units, asset.units) &&
    body.currency === asset.currency &&
    sameDecimal(body.unitCost ?? null, asset.unitCost) &&
    sameDecimal(body.purchaseFxRate ?? null, asset.purchaseFxRate) &&
    body.priceSource === asset.priceSource &&
    body.metal === asset.metal &&
    sameDecimal(body.ozPerUnit ?? null, asset.ozPerUnit)
  );
}

/** A decimal text field's value after `parseDecimal` ('' stays ''). */
export function decimalOrEmpty(text: string, maxDp?: number): string {
  if (text.trim() === '') return '';
  return parseDecimal(text, maxDp) ?? text;
}
