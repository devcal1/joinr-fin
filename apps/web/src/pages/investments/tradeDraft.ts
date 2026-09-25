// The trade form's state and rules (stage-2.md §6.6, D38): the draft, the default entry mode and
// fee pre-fill, the re-fill on a holding change, the preview line, client validation, the request
// body and the API error mapping. Pure functions; the only client-side arithmetic is
// `@joinr/schema` trading.ts (units from an amount, the fee from a rate).
import {
  PERCENT_INPUT_MAX_DP,
  isPositiveDecimal,
  compareDecimals,
  multiplyToCents,
  orderValueIssue,
  percentTextFromRatio,
  ratioFromPercentText,
  tradeFeeCents,
  unitsFromAmount,
  withinDecimalInputLimits,
  type FeeSpec,
  type HoldingRowDto,
  type InstrumentKind,
  type IsoDate,
  type QuantityMode,
  type TradeInputBody,
  type TradeRowDto,
  type TradeSide,
} from '@joinr/schema';
import { formatMoney } from '@joinr/ui';
import { splitFormErrors, type FormErrors } from './apiErrors';
import { formatUnits } from './display';

export type FeeMode = 'flat' | 'rate';

/** What the form holds while the owner types. Units and prices are decimal strings ('' = empty). */
export interface TradeDraft {
  instrumentId: number | null;
  side: TradeSide;
  tradeDate: IsoDate | null;
  mode: QuantityMode;
  units: string;
  amountCents: number | null;
  price: string;
  feeMode: FeeMode;
  feeCents: number | null;
  /** The crypto fee as percent text ("0.5" = 0.5 %). */
  feePercent: string;
  note: string;
}

export type TradeField =
  'instrumentId' | 'side' | 'tradeDate' | 'units' | 'amountCents' | 'price' | 'fee' | 'note';

/** Fields the owner has edited in this form (a holding change never overwrites them). */
export type TouchedField = 'price' | 'fee' | 'mode';

/** What the form needs to know about a holding. */
export type TradeHolding = Pick<
  HoldingRowDto,
  'instrumentId' | 'symbol' | 'kind' | 'units' | 'status' | 'price' | 'effectiveDefaultFee'
>;

export const NOTE_MAX = 200;
const UNITS_MAX = '1000000000000';
const PRICE_MAX = '1000000000';
const FEE_CENTS_MAX = 100_000_000;
const AMOUNT_CENTS_MAX = 1e13;

/** The decimal places a percent field accepts: 4, or more when a stored value needs them. */
export function percentMaxDp(storedPercentText: string): number {
  const decimals = storedPercentText.split('.')[1]?.length ?? 0;
  return Math.max(PERCENT_INPUT_MAX_DP, decimals);
}

/**
 * D47: the owner's last explicit Units / Amount choice for a holding (by instrument id), or null
 * when that holding has none. The form reads it from browser storage; tests pass a plain function.
 */
export type RememberedMode = (instrumentId: number) => QuantityMode | null;

/** No remembered choice for any holding. */
export const NO_REMEMBERED_MODE: RememberedMode = () => null;

/**
 * D38/D47 default entry mode: the holding's own remembered choice wins; else Amount for a $0 flat
 * default fee, otherwise Units. Another holding's choice never applies.
 */
export function defaultEntryMode(
  holding: Pick<TradeHolding, 'instrumentId' | 'effectiveDefaultFee'> | undefined,
  remembered: RememberedMode,
): QuantityMode {
  const own = holding ? remembered(holding.instrumentId) : null;
  if (own) return own;
  const fee = holding?.effectiveDefaultFee;
  return fee?.kind === 'flat' && fee.cents === 0 ? 'amount' : 'units';
}

/** The fee fields a holding pre-fills (its `effectiveDefaultFee`; a rate is crypto only). */
export function feeFieldsFor(
  fee: FeeSpec | undefined,
  kind: InstrumentKind,
): Pick<TradeDraft, 'feeMode' | 'feeCents' | 'feePercent'> {
  if (fee?.kind === 'rate' && kind === 'crypto') {
    return { feeMode: 'rate', feeCents: null, feePercent: percentTextFromRatio(fee.rate) };
  }
  if (fee?.kind === 'flat') return { feeMode: 'flat', feeCents: fee.cents, feePercent: '' };
  return { feeMode: kind === 'crypto' ? 'rate' : 'flat', feeCents: null, feePercent: '' };
}

/** A new trade: today, a buy, the holding's price and default fee (when a holding is chosen). */
export function newTradeDraft(
  holding: TradeHolding | undefined,
  kind: InstrumentKind,
  today: IsoDate,
  remembered: RememberedMode,
): TradeDraft {
  return {
    instrumentId: holding?.instrumentId ?? null,
    side: 'buy',
    tradeDate: today,
    mode: defaultEntryMode(holding, remembered),
    units: '',
    amountCents: null,
    price: holding?.price.price ?? '',
    ...feeFieldsFor(holding?.effectiveDefaultFee, kind),
    note: '',
  };
}

/** Edit: the stored values, always in Units mode; the fee as stored. */
export function draftFromTrade(trade: TradeRowDto): TradeDraft {
  return {
    instrumentId: trade.instrumentId,
    side: trade.side,
    tradeDate: trade.tradeDate,
    mode: 'units',
    units: trade.units,
    amountCents: null,
    price: trade.price,
    ...(trade.fee.kind === 'rate'
      ? { feeMode: 'rate', feeCents: null, feePercent: percentTextFromRatio(trade.fee.rate) }
      : { feeMode: 'flat', feeCents: trade.fee.cents, feePercent: '' }),
    note: trade.note ?? '',
  };
}

/**
 * The holding changed: the price, fee and default entry mode re-fill from the new holding (its own
 * remembered mode, D47), unless the owner has already edited that field in this form.
 */
export function withHolding(
  draft: TradeDraft,
  holding: TradeHolding,
  kind: InstrumentKind,
  touched: ReadonlySet<TouchedField>,
  remembered: RememberedMode,
): TradeDraft {
  return {
    ...draft,
    instrumentId: holding.instrumentId,
    ...(touched.has('price') ? {} : { price: holding.price.price ?? '' }),
    ...(touched.has('fee') ? {} : feeFieldsFor(holding.effectiveDefaultFee, kind)),
    ...(touched.has('mode') ? {} : { mode: defaultEntryMode(holding, remembered) }),
  };
}

/** True when two drafts hold the same values (Save stays disabled while pristine). */
export function sameDraft(a: TradeDraft, b: TradeDraft): boolean {
  return (Object.keys(a) as (keyof TradeDraft)[]).every((key) => Object.is(a[key], b[key]));
}

function validPrice(price: string): boolean {
  return (
    isPositiveDecimal(price) &&
    withinDecimalInputLimits(price) &&
    compareDecimals(price, PRICE_MAX) <= 0
  );
}

/** The fee rate the draft holds, or null when it does not parse. */
export function draftFeeRate(draft: TradeDraft, feeMaxDp: number): string | null {
  return ratioFromPercentText(draft.feePercent, feeMaxDp);
}

/** The units the draft trades: as typed, or D38's `unitsFromAmount` (null when unknown). */
export function draftUnits(draft: TradeDraft, kind: InstrumentKind): string | null {
  if (draft.mode === 'units') {
    return isPositiveDecimal(draft.units) && withinDecimalInputLimits(draft.units)
      ? draft.units
      : null;
  }
  if (draft.amountCents === null || draft.amountCents <= 0 || !validPrice(draft.price)) return null;
  if (!Number.isSafeInteger(draft.amountCents)) return null;
  return unitsFromAmount(draft.amountCents, draft.price, kind);
}

export type TradePreview =
  | {
      ok: true;
      approximate: boolean;
      side: TradeSide;
      units: string;
      orderCents: number;
      feeCents: number;
      /** Buy: order + fee. Sell: the proceeds, order − fee. */
      totalCents: number;
    }
  | { ok: false; message: string };

export const AMOUNT_TOO_SMALL = 'The amount buys less than one unit step.';
/** The joint units × price bound (ORDER_VALUE_CENTS_MAX), as the server checks it. */
export const ORDER_TOO_LARGE = 'The order value is too large.';
export const FEE_TOO_LARGE = 'The fee is too large.';

/** The preview line's figures, or null until the units (or amount), price and fee are known. */
export function tradePreview(
  draft: TradeDraft,
  kind: InstrumentKind,
  feeMaxDp: number,
): TradePreview | null {
  if (!validPrice(draft.price)) return null;
  const units = draftUnits(draft, kind);
  if (units === null) return null;
  if (units === '0') return { ok: false, message: AMOUNT_TOO_SMALL };
  let rate: string | null = null;
  if (draft.feeMode === 'flat') {
    if (draft.feeCents === null || draft.feeCents < 0) return null;
  } else {
    rate = draftFeeRate(draft, feeMaxDp);
    if (rate === null) return null;
  }
  // An accepted units × price can pass the safe cents range (the rendering must never throw):
  // no preview then; validateTradeDraft reports the field.
  if (orderValueIssue({ units, price: draft.price, feeRate: rate }) !== null) return null;
  const feeCents =
    rate === null
      ? (draft.feeCents ?? 0)
      : tradeFeeCents({ units, price: draft.price, feeCents: 0, feeRate: rate });
  const orderCents = multiplyToCents(units, draft.price);
  return {
    ok: true,
    approximate: draft.mode === 'amount',
    side: draft.side,
    units,
    orderCents,
    feeCents,
    totalCents: draft.side === 'buy' ? orderCents + feeCents : orderCents - feeCents,
  };
}

/** "≈ 10.2345 units · order $500.00 · fee $0.00 · total $500.00" (a sell shows the proceeds). */
export function previewText(preview: TradePreview, kind: InstrumentKind): string {
  if (!preview.ok) return preview.message;
  const units = `${preview.approximate ? '≈ ' : ''}${formatUnits(preview.units, kind)} ${
    preview.units === '1' ? 'unit' : 'units'
  }`;
  const last = preview.side === 'buy' ? 'total' : 'proceeds';
  return `${units} · order ${formatMoney(preview.orderCents)} · fee ${formatMoney(preview.feeCents)} · ${last} ${formatMoney(preview.totalCents)}`;
}

/** Client checks (the server checks again, with the same limits). */
export function validateTradeDraft(
  draft: TradeDraft,
  kind: InstrumentKind,
  feeMaxDp: number,
): Partial<Record<TradeField, string>> {
  const errors: Partial<Record<TradeField, string>> = {};
  if (draft.instrumentId === null) errors.instrumentId = 'Choose a holding.';
  if (draft.tradeDate === null) errors.tradeDate = 'Enter the trade date.';

  if (draft.price === '') errors.price = 'Enter the price per unit.';
  else if (!isPositiveDecimal(draft.price)) errors.price = 'Enter a price greater than zero.';
  else if (!withinDecimalInputLimits(draft.price)) {
    errors.price = 'Use at most 15 significant digits.';
  } else if (compareDecimals(draft.price, PRICE_MAX) > 0) {
    errors.price = 'Enter a price up to 1,000,000,000.';
  }

  if (draft.mode === 'units') {
    if (draft.units === '') errors.units = 'Enter the units.';
    else if (!isPositiveDecimal(draft.units)) errors.units = 'Enter units greater than zero.';
    else if (!withinDecimalInputLimits(draft.units)) {
      errors.units = 'Use at most 15 significant digits.';
    } else if (compareDecimals(draft.units, UNITS_MAX) > 0) {
      errors.units = 'Enter at most 1,000,000,000,000 units.';
    }
  } else if (draft.amountCents === null) {
    errors.amountCents = 'Enter the amount.';
  } else if (draft.amountCents <= 0) {
    errors.amountCents = 'Enter an amount greater than zero.';
  } else if (draft.amountCents > AMOUNT_CENTS_MAX) {
    errors.amountCents = 'Enter an amount up to $100,000,000,000.';
  } else if (errors.price === undefined && draftUnits(draft, kind) === '0') {
    errors.amountCents = AMOUNT_TOO_SMALL;
  }

  if (draft.feeMode === 'flat') {
    if (draft.feeCents === null) errors.fee = 'Enter a fee ($0 for none).';
    else if (draft.feeCents < 0) errors.fee = 'Enter a fee of zero or more.';
    else if (draft.feeCents > FEE_CENTS_MAX) errors.fee = 'Enter a fee up to $1,000,000.';
  } else if (kind !== 'crypto') {
    errors.fee = 'A percentage fee is for crypto only.';
  } else if (draft.feePercent.trim() === '') {
    errors.fee = 'Enter a fee % (0 for none).';
  } else {
    const rate = draftFeeRate(draft, feeMaxDp);
    if (rate === null) {
      errors.fee = `Enter a percentage with up to ${feeMaxDp} decimal places.`;
    } else if (compareDecimals(rate, '1') > 0) {
      errors.fee = 'Enter a fee of at most 100%.';
    }
  }

  // The joint bound (ORDER_VALUE_CENTS_MAX): units and price can each be valid while their
  // product (or a rate fee on it) is too large. Amount mode is bounded by the amount itself.
  if (draft.mode === 'units' && errors.units === undefined && errors.price === undefined) {
    const rate =
      draft.feeMode === 'rate' && errors.fee === undefined ? draftFeeRate(draft, feeMaxDp) : null;
    const issue = orderValueIssue({ units: draft.units, price: draft.price, feeRate: rate });
    if (issue === 'order') errors.units = ORDER_TOO_LARGE;
    else if (issue === 'fee') errors.fee = FEE_TOO_LARGE;
  }

  if (draft.note.trim().length > NOTE_MAX) errors.note = `Use at most ${NOTE_MAX} characters.`;
  return errors;
}

/**
 * The request body (call after `validateTradeDraft` found nothing). On an edit, a fee the owner
 * did not touch is sent back exactly as stored.
 */
export function tradeBody(
  draft: TradeDraft,
  feeMaxDp: number,
  stored?: { fee: FeeSpec; feeTouched: boolean },
): TradeInputBody {
  if (draft.instrumentId === null || draft.tradeDate === null) {
    throw new Error('tradeBody: the draft is not valid');
  }
  let fee: FeeSpec;
  if (stored && !stored.feeTouched) {
    fee = stored.fee;
  } else if (draft.feeMode === 'flat') {
    fee = { kind: 'flat', cents: draft.feeCents ?? 0 };
  } else {
    fee = { kind: 'rate', rate: draftFeeRate(draft, feeMaxDp) ?? '0' };
  }
  return {
    instrumentId: draft.instrumentId,
    side: draft.side,
    tradeDate: draft.tradeDate,
    quantity:
      draft.mode === 'units'
        ? { mode: 'units', units: draft.units }
        : { mode: 'amount', amountCents: draft.amountCents ?? 0 },
    price: draft.price,
    fee,
    note: draft.note.trim(),
  };
}

const TRADE_PATHS: Readonly<Record<string, TradeField>> = {
  instrumentId: 'instrumentId',
  side: 'side',
  tradeDate: 'tradeDate',
  'quantity.units': 'units',
  'quantity.amountCents': 'amountCents',
  price: 'price',
  fee: 'fee',
  note: 'note',
};

/** A validation issue path → the field it belongs to (by the longest known prefix). */
export function tradeFieldOfPath(path: string, mode: QuantityMode): TradeField | undefined {
  let key = path;
  for (;;) {
    const field = TRADE_PATHS[key];
    if (field) return field;
    if (key === 'quantity') return mode === 'units' ? 'units' : 'amountCents';
    const dot = key.lastIndexOf('.');
    if (dot === -1) return undefined;
    key = key.slice(0, dot);
  }
}

/** Server errors → field messages and a form-level message. */
export function tradeApiErrors(error: unknown, mode: QuantityMode): FormErrors<TradeField> {
  return splitFormErrors(error, (path) => tradeFieldOfPath(path, mode));
}
