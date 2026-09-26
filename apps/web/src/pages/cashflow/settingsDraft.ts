// The page-settings form model (stage-3.md §3.3, §6.3 item 6, §6.5 item 3): each editable key's
// display text, its draft (the form's value), the parsed value and the changed keys a Save sends
// (`PATCH /api/settings` with changed keys only, so a no-op never flips a row to `app`).
import {
  CASHFLOW_MONEY_MAX,
  SETTINGS_INTEGER_MAX,
  percentTextFromRatio,
  ratioFromPercentText,
  settingDef,
  settingValueSchema,
  type EditableSettingKey,
  type IsoDate,
  type SettingValue,
  type SettingsSliceDto,
} from '@joinr/schema';
import { formatDate, formatMoney } from '@joinr/ui';
import { PAY_FREQUENCY_LABELS, YEAR_BASIS_LABELS } from './display';

/** A form value: cents (money), text (ratio %, integer, enum, boolean 'yes'/'no'), or a date. */
export type SettingDraft = number | string | null;

export type SettingDrafts = Partial<Record<EditableSettingKey, SettingDraft>>;

/** Enum options with their words (only the enums the pages edit). */
export const ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'pay.frequency': PAY_FREQUENCY_LABELS,
  'savings.yearBasis': YEAR_BASIS_LABELS,
  // Stage 4 (stage-4.md §3.3, D75): how imported (untyped) super contributions are read.
  'super.importedContributionType': {
    salary_sacrifice: 'Salary sacrifice',
    after_tax: 'After-tax',
  },
};

/** The value a slice holds for a key (null when never stored or stored as null). */
export function sliceValue(slice: SettingsSliceDto, key: EditableSettingKey): SettingValue | null {
  return slice.values[key] ?? null;
}

/** A stored value in words for the settings table; null = "Not set". */
export function settingText(key: EditableSettingKey, value: SettingValue | null): string | null {
  if (value === null) return null;
  const def = settingDef(key);
  switch (def.type) {
    case 'money':
      return typeof value === 'number' ? formatMoney(value) : String(value);
    case 'ratio':
      try {
        return `${percentTextFromRatio(String(value))}%`;
      } catch {
        return String(value);
      }
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'enum':
      return ENUM_LABELS[key]?.[String(value)] ?? String(value);
    case 'date':
      try {
        return formatDate(String(value));
      } catch {
        return String(value);
      }
    case 'integer':
      return String(value);
  }
}

/** The form's starting value for a stored value. */
export function draftOf(key: EditableSettingKey, value: SettingValue | null): SettingDraft {
  const def = settingDef(key);
  if (value === null) return def.type === 'money' || def.type === 'date' ? null : '';
  switch (def.type) {
    case 'money':
      return typeof value === 'number' ? value : null;
    case 'ratio':
      try {
        return percentTextFromRatio(String(value));
      } catch {
        return '';
      }
    case 'boolean':
      return value === true ? 'yes' : 'no';
    case 'date':
      return String(value);
    default:
      return String(value);
  }
}

export type ParsedSetting =
  { ok: true; value: SettingValue | null } | { ok: false; message: string };

/** A draft → the value to store (null clears the key), or the reason it is invalid. */
export function parseDraft(key: EditableSettingKey, draft: SettingDraft): ParsedSetting {
  const def = settingDef(key);
  if (draft === null || draft === '') return { ok: true, value: null };
  let value: SettingValue;
  switch (def.type) {
    case 'money':
      if (typeof draft !== 'number') return { ok: false, message: 'Enter an amount' };
      // The server's write bound (settingsPatchSchema): money up to CASHFLOW_MONEY_MAX.
      if (draft > CASHFLOW_MONEY_MAX) {
        return { ok: false, message: 'Enter an amount up to $100,000,000' };
      }
      value = draft;
      break;
    case 'ratio': {
      const ratio = ratioFromPercentText(String(draft));
      if (ratio === null) return { ok: false, message: 'Enter a percentage like 20' };
      const n = Number(ratio);
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        return { ok: false, message: 'Enter a percentage from 0 to 100' };
      }
      value = ratio;
      break;
    }
    case 'integer': {
      if (!/^\d+$/.test(String(draft))) return { ok: false, message: 'Enter a whole number' };
      value = Number(draft);
      // The server's write bound for an integer without a registry maximum (the fund's months).
      if (def.max === undefined && value > SETTINGS_INTEGER_MAX) {
        return {
          ok: false,
          message: `Enter a whole number from ${def.min ?? 0} to ${SETTINGS_INTEGER_MAX}`,
        };
      }
      break;
    }
    case 'boolean':
      value = draft === 'yes';
      break;
    default:
      value = String(draft);
  }
  const parsed = settingValueSchema(key).safeParse(value);
  if (!parsed.success) {
    if (def.type === 'integer' && def.min !== undefined && def.max !== undefined) {
      return { ok: false, message: `Enter a whole number from ${def.min} to ${def.max}` };
    }
    return { ok: false, message: 'Enter a valid value' };
  }
  return { ok: true, value: parsed.data };
}

/** Two stored values are the same setting (decimal strings compare by value). */
function sameValue(
  key: EditableSettingKey,
  a: SettingValue | null,
  b: SettingValue | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (settingDef(key).type === 'ratio') return Number(a) === Number(b);
  return a === b;
}

export interface SettingsDiff {
  /** The keys whose parsed value differs from the stored one. */
  values: Partial<Record<EditableSettingKey, SettingValue | null>>;
  errors: Partial<Record<EditableSettingKey, string>>;
}

/** The changed keys only (the PATCH body) and the invalid drafts. */
export function diffSettings(
  keys: readonly EditableSettingKey[],
  slice: SettingsSliceDto,
  drafts: SettingDrafts,
): SettingsDiff {
  const diff: SettingsDiff = { values: {}, errors: {} };
  for (const key of keys) {
    if (!(key in drafts)) continue;
    const parsed = parseDraft(key, drafts[key] ?? null);
    if (!parsed.ok) {
      diff.errors[key] = parsed.message;
      continue;
    }
    if (!sameValue(key, parsed.value, sliceValue(slice, key))) diff.values[key] = parsed.value;
  }
  return diff;
}

/** A date draft for the DateField (null when empty). */
export function dateDraft(draft: SettingDraft): IsoDate | null {
  return typeof draft === 'string' && draft !== '' ? draft : null;
}
