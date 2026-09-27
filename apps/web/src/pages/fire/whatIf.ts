// The what-if panel's model (stage-6.md §6.2, §6.4, D100), pure: the six fields, the value each
// starts at (saved, else derived, else default), parsing and display, the query (only the fields
// that differ from the saved values, compared as normalised decimals, never floats or display
// text), the settings patch "Save as my settings" sends, the save summary, the sliders' ranges
// (extended to include the current value) and their keys (handled explicitly: browsers differ).
import {
  CASHFLOW_MONEY_MAX,
  FIRE_DEFAULT_ACCESS_AGE,
  FIRE_EXTRA_SAVINGS_MAX_CENTS,
  FIRE_FIELD_LABELS,
  FIRE_QUERY_ACCESS_AGE_MAX,
  FIRE_QUERY_ACCESS_AGE_MIN,
  FIRE_WHAT_IF_FIELDS,
  JoinrDecimal,
  compareDecimals,
  normaliseDecimal,
  type FireInputsDto,
  type FireQuery,
  type FireWhatIfField,
  type SettingsPatch,
} from '@joinr/schema';
import { MINUS, formatMoney, formatPercent, parseDecimal, parseMoney } from '@joinr/ui';

/** A burst of edits sends one request, this long after the last change (stage-6.md §6.4). */
export const WHAT_IF_DEBOUNCE_MS = 250;

/** The fields in panel order. */
export const WHAT_IF_FIELDS = [
  'spend',
  'withdrawalRate',
  'inflationRate',
  'marketReturn',
  'accessAge',
  'extraSavings',
] as const satisfies readonly FireWhatIfField[];

export type WhatIfKind = 'money' | 'ratio' | 'age';

export const FIELD_KIND: Readonly<Record<FireWhatIfField, WhatIfKind>> = {
  spend: 'money',
  withdrawalRate: 'ratio',
  inflationRate: 'ratio',
  marketReturn: 'ratio',
  accessAge: 'age',
  extraSavings: 'money',
};

/** The id of a what-if field's number input (the needs-input links focus it). */
export function whatIfFieldId(field: FireWhatIfField): string {
  return `fire-whatif-${field}`;
}

/** Money fields hold cents, ratio fields a normalised decimal string, the age an integer. */
export type WhatIfValue = number | string;
/** The fields the user has changed (the rest follow the saved or derived values). */
export type WhatIfTouched = Partial<Record<FireWhatIfField, WhatIfValue>>;
export type WhatIfBase = Record<FireWhatIfField, WhatIfValue | null>;

/**
 * Each field's value when no what-if applies: the stored setting, else the derived figure, else
 * the default. Read from the saved and derived parts of the inputs, so it is the same whether or
 * not the response is a what-if.
 */
export function baseValues(inputs: FireInputsDto): WhatIfBase {
  return {
    spend: inputs.yearlySpend.savedCents ?? inputs.yearlySpend.derivedCents,
    withdrawalRate: inputs.withdrawalRate.savedRatio,
    inflationRate: inputs.inflationRate.savedRatio,
    marketReturn: inputs.marketReturn.savedRatio,
    accessAge: inputs.accessAge.savedValue ?? FIRE_DEFAULT_ACCESS_AGE,
    extraSavings: inputs.extraSavings.savedCents ?? 0,
  };
}

/** Two values of one field are the same (ratios as normalised decimals). */
export function sameValue(field: FireWhatIfField, a: WhatIfValue, b: WhatIfValue): boolean {
  if (FIELD_KIND[field] === 'ratio') {
    return typeof a === 'string' && typeof b === 'string' && compareDecimals(a, b) === 0;
  }
  return a === b;
}

/** The fields whose value differs from the value in use without a what-if, in panel order. */
export function changedFields(touched: WhatIfTouched, base: WhatIfBase): FireWhatIfField[] {
  return WHAT_IF_FIELDS.filter((field) => {
    const value = touched[field];
    if (value === undefined) return false;
    const saved = base[field];
    return saved === null || !sameValue(field, value, saved);
  });
}

/** The `GET /api/fire` query of the changed fields; null when nothing differs. */
export function whatIfQuery(touched: WhatIfTouched, base: WhatIfBase): FireQuery | null {
  const fields = changedFields(touched, base);
  if (fields.length === 0) return null;
  const query: FireQuery = {};
  for (const field of fields) {
    const value = touched[field];
    if (field === 'spend' && typeof value === 'number') query.spend = value;
    if (field === 'accessAge' && typeof value === 'number') query.accessAge = value;
    if (field === 'extraSavings' && typeof value === 'number') query.extraSavings = value;
    if (field === 'withdrawalRate' && typeof value === 'string') query.withdrawalRate = value;
    if (field === 'inflationRate' && typeof value === 'string') query.inflationRate = value;
    if (field === 'marketReturn' && typeof value === 'string') query.marketReturn = value;
  }
  return query;
}

/** A stable text of a query (field order fixed), to tell two queries apart. */
export function queryKeyText(query: FireQuery | null): string {
  if (!query) return '';
  return WHAT_IF_FIELDS.map((field) => `${field}=${String(query[field] ?? '')}`).join('&');
}

/** "Save as my settings": the changed fields' keys (FIRE_WHAT_IF_FIELDS). */
export function savePatch(touched: WhatIfTouched, base: WhatIfBase): SettingsPatch | null {
  const fields = changedFields(touched, base);
  if (fields.length === 0) return null;
  const values: SettingsPatch['values'] = {};
  for (const field of fields) {
    const value = touched[field];
    if (value !== undefined) values[FIRE_WHAT_IF_FIELDS[field]] = value;
  }
  return { values };
}

// ─── Display and parsing ───────────────────────────────────────────────────────────────────────

/** The field's value in words (prose: "Saved:" lines, the save summary, aria-valuetext). */
export function valueWords(field: FireWhatIfField, value: WhatIfValue | null): string {
  if (value === null) return 'not set';
  switch (FIELD_KIND[field]) {
    case 'money':
      return formatMoney(Number(value), { wholeDollars: Number(value) % 100 === 0 });
    case 'ratio':
      return formatPercent(Number(value));
    case 'age':
      return `age ${value}`;
  }
}

/** `Saves: yearly spend $42,000 · access age 62`. */
export function saveSummary(touched: WhatIfTouched, base: WhatIfBase): string | null {
  const fields = changedFields(touched, base);
  if (fields.length === 0) return null;
  const parts = fields.map((field) => {
    const label = FIRE_FIELD_LABELS[field].toLowerCase();
    const value = touched[field] ?? null;
    return field === 'accessAge' ? `${label} ${value}` : `${label} ${valueWords(field, value)}`;
  });
  return `Saves: ${parts.join(' · ')}`;
}

/** A ratio as the percentage the field shows, at its stored precision up to 2 dp: '0.0375' → '3.75'. */
export function percentInput(ratio: string): string {
  const percent = new JoinrDecimal(ratio).times(100).toDecimalPlaces(2);
  const text = percent.toFixed();
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text;
}

/** The text a field shows for a value (no unit: the field adds `$` or `%`). */
export function inputText(field: FireWhatIfField, value: WhatIfValue | null): string {
  if (value === null) return '';
  switch (FIELD_KIND[field]) {
    case 'money': {
      const cents = Number(value);
      return formatMoney(cents, { wholeDollars: cents % 100 === 0 }).replace('$', '');
    }
    case 'ratio':
      return percentInput(String(value));
    case 'age':
      return String(value);
  }
}

export type ParseResult = { ok: true; value: WhatIfValue } | { ok: false; message: string };

const SPEND_MESSAGE = `Enter a yearly spend from $0 to ${formatMoney(CASHFLOW_MONEY_MAX, { wholeDollars: true })}`;
const EXTRA_MESSAGE = `Enter an amount from ${formatMoney(-FIRE_EXTRA_SAVINGS_MAX_CENTS, { wholeDollars: true })} to ${formatMoney(FIRE_EXTRA_SAVINGS_MAX_CENTS, { wholeDollars: true })}`;
const WITHDRAWAL_MESSAGE = 'Enter a rate above 0% and up to 100%, with up to 2 decimal places';
const RATE_MESSAGE = `Enter a rate above ${MINUS}100% and up to 100%, with up to 2 decimal places`;
const AGE_MESSAGE = `Enter a whole age from ${FIRE_QUERY_ACCESS_AGE_MIN} to ${FIRE_QUERY_ACCESS_AGE_MAX}`;

/** A percentage typed into a rate field → the ratio (4 dp at most), within the query bounds. */
function parseRatio(text: string, field: FireWhatIfField): ParseResult {
  const message = field === 'withdrawalRate' ? WITHDRAWAL_MESSAGE : RATE_MESSAGE;
  const percent = parseDecimal(text, 2);
  if (percent === null) return { ok: false, message };
  const ratio = normaliseDecimal(new JoinrDecimal(percent).div(100));
  const low = field === 'withdrawalRate' ? '0' : '-1';
  if (compareDecimals(ratio, low) <= 0 || compareDecimals(ratio, '1') > 0) {
    return { ok: false, message };
  }
  return { ok: true, value: ratio };
}

/**
 * Parses a field's text within the query bounds (stage-6.md §4.3). Empty text is not a value: the
 * caller reverts the field to the value in use.
 */
export function parseField(field: FireWhatIfField, text: string): ParseResult | null {
  if (text.trim() === '') return null;
  switch (field) {
    case 'spend': {
      const cents = parseMoney(text);
      if (cents === null || cents < 0 || cents > CASHFLOW_MONEY_MAX) {
        return { ok: false, message: SPEND_MESSAGE };
      }
      return { ok: true, value: cents };
    }
    case 'extraSavings': {
      const cents = parseMoney(text);
      if (
        cents === null ||
        cents < -FIRE_EXTRA_SAVINGS_MAX_CENTS ||
        cents > FIRE_EXTRA_SAVINGS_MAX_CENTS
      ) {
        return { ok: false, message: EXTRA_MESSAGE };
      }
      return { ok: true, value: cents };
    }
    case 'accessAge': {
      const trimmed = text.trim();
      if (!/^\d{1,3}$/.test(trimmed)) return { ok: false, message: AGE_MESSAGE };
      const age = Number(trimmed);
      if (age < FIRE_QUERY_ACCESS_AGE_MIN || age > FIRE_QUERY_ACCESS_AGE_MAX) {
        return { ok: false, message: AGE_MESSAGE };
      }
      return { ok: true, value: age };
    }
    case 'withdrawalRate':
    case 'inflationRate':
    case 'marketReturn':
      return parseRatio(text, field);
  }
}

// ─── Sliders ───────────────────────────────────────────────────────────────────────────────────

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/** The sliders' default ranges in their units (dollars, percent, years). */
export const SLIDER_DEFAULTS: Readonly<Record<FireWhatIfField, SliderRange>> = {
  spend: { min: 0, max: 200_000, step: 500 },
  withdrawalRate: { min: 2, max: 8, step: 0.1 },
  inflationRate: { min: 0, max: 8, step: 0.1 },
  marketReturn: { min: 0, max: 12, step: 0.1 },
  accessAge: { min: 55, max: 75, step: 1 },
  extraSavings: { min: -50_000, max: 100_000, step: 1_000 },
};

/** Decimal places of a step (0.1 → 1). */
function stepDp(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Rounds away the float noise of slider arithmetic to the step's decimals. */
function tidy(value: number, step: number): number {
  return Number(value.toFixed(stepDp(step)));
}

/** A value in slider units (dollars, percent, years); null stays null. */
export function sliderValue(field: FireWhatIfField, value: WhatIfValue | null): number | null {
  if (value === null) return null;
  switch (FIELD_KIND[field]) {
    case 'money':
      return Number(value) / 100;
    case 'ratio':
      return Number(new JoinrDecimal(String(value)).times(100).toFixed());
    case 'age':
      return Number(value);
  }
}

/** A slider position back to the field's value (cents, a normalised ratio or an age). */
export function fromSlider(field: FireWhatIfField, position: number): WhatIfValue {
  switch (FIELD_KIND[field]) {
    case 'money':
      return Math.round(position * 100);
    case 'ratio':
      return normaliseDecimal(new JoinrDecimal(position.toFixed(1)).div(100));
    case 'age':
      return Math.round(position);
  }
}

/**
 * The slider's range: the default, extended on the step grid to include the current value and
 * (for the spend) up to twice the value in use.
 */
export function sliderRange(
  field: FireWhatIfField,
  current: number | null,
  inUse: number | null = current,
): SliderRange {
  const base = SLIDER_DEFAULTS[field];
  const { step } = base;
  let { min, max } = base;
  if (field === 'spend' && inUse !== null) max = Math.max(max, 2 * inUse);
  if (current !== null && Number.isFinite(current)) {
    min = Math.min(min, tidy(Math.floor(current / step) * step, step));
    max = Math.max(max, tidy(Math.ceil(current / step) * step, step));
  }
  // Keep the maximum on the grid that starts at the minimum.
  max = tidy(min + Math.ceil(tidy((max - min) / step, 6)) * step, step);
  return { min, max, step };
}

/** Snaps a position to the slider's grid, within its range. */
export function snapToStep(position: number, range: SliderRange): number {
  const { min, max, step } = range;
  const snapped = min + Math.round((position - min) / step) * step;
  return tidy(Math.min(max, Math.max(min, snapped)), step);
}

/**
 * The slider's new position for a key (handled explicitly, browsers differ): arrows step, Page
 * Up/Down move 10 steps, Home/End go to the ends. Null for any other key.
 */
export function sliderKeyValue(
  key: string,
  position: number | null,
  range: SliderRange,
): number | null {
  const from = position ?? range.min;
  const move = (steps: number): number => snapToStep(from + steps * range.step, range);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return move(1);
    case 'ArrowLeft':
    case 'ArrowDown':
      return move(-1);
    case 'PageUp':
      return move(10);
    case 'PageDown':
      return move(-10);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}

/** The slider's spoken value (§8 formats): "4.0%", "$42,500 a year", "age 60". */
export function sliderValueText(field: FireWhatIfField, value: WhatIfValue | null): string {
  if (value === null) return 'not set';
  if (FIELD_KIND[field] === 'money') return `${valueWords(field, value)} a year`;
  return valueWords(field, value);
}

/**
 * Maps a `VALIDATION_ERROR` message (`path: issue; …`) to the what-if fields it names. Null when
 * any part names something else (the page then shows the message as a whole).
 */
export function fieldErrorsOf(message: string): Partial<Record<FireWhatIfField, string>> | null {
  const errors: Partial<Record<FireWhatIfField, string>> = {};
  const parts = message
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) return null;
    const path = part.slice(0, colon).trim();
    const issue = part.slice(colon + 1).trim();
    const field = WHAT_IF_FIELDS.find((f) => f === path);
    if (!field) return null;
    errors[field] = `${FIRE_FIELD_LABELS[field]} ${issue}`;
  }
  return errors;
}
