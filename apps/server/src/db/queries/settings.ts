// A typed reader for the `settings` table (stage-2.md §4.5 step 2). Each `value_json` is parsed with
// its registry schema (`settingValueSchema(key)`); a value that is not valid JSON or has the wrong
// type reads as null, with a warning that names the key but never the value.
import {
  isSettingKey,
  SETTING_KEYS,
  settingValueSchema,
  type AllocationAggressiveness,
  type ChartDateUnit,
  type PayFrequency,
  type SettingKey,
  type SettingValue,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import type { Db } from '../database';
import type { Tx } from './domain';

/** Every registry key → its parsed value, or null when unset or invalid. */
export type SettingsValues = Readonly<Record<SettingKey, SettingValue | null>>;

/** The logger surface readSettings needs (Fastify's logger fits). */
export interface SettingsLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Reads every setting. Unknown keys are ignored; a key that is absent reads as null. An invalid
 * stored value (bad JSON or the wrong type) reads as null and logs a warning without the value.
 */
export function readSettings(db: Db | Tx, log?: SettingsLog): SettingsValues {
  const values = Object.fromEntries(SETTING_KEYS.map((k) => [k, null])) as Record<
    SettingKey,
    SettingValue | null
  >;
  for (const row of db
    .select({ key: settings.key, valueJson: settings.valueJson })
    .from(settings)
    .all()) {
    if (!isSettingKey(row.key)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(row.valueJson);
    } catch {
      log?.warn({ key: row.key }, 'setting value is not valid JSON; using null');
      continue;
    }
    if (raw === null) continue;
    const parsed = settingValueSchema(row.key).safeParse(raw);
    if (!parsed.success) {
      log?.warn({ key: row.key }, 'setting value has the wrong type; using null');
      continue;
    }
    values[row.key] = parsed.data;
  }
  return values;
}

// ─── Typed accessors (the registry type decides the JS type; these only narrow) ─────────────────

/** A money, integer or boolean-free number setting. */
export function numberSetting(s: SettingsValues, key: SettingKey): number | null {
  const v = s[key];
  return typeof v === 'number' ? v : null;
}

/** A ratio (decimal string) or date setting. */
export function stringSetting(s: SettingsValues, key: SettingKey): string | null {
  const v = s[key];
  return typeof v === 'string' ? v : null;
}

export function booleanSetting(s: SettingsValues, key: SettingKey): boolean | null {
  const v = s[key];
  return typeof v === 'boolean' ? v : null;
}

export function payFrequencySetting(s: SettingsValues): PayFrequency | null {
  return stringSetting(s, 'pay.frequency') as PayFrequency | null;
}

export function aggressivenessSetting(s: SettingsValues): AllocationAggressiveness | null {
  return stringSetting(s, 'investing.allocationAggressiveness') as AllocationAggressiveness | null;
}

export function chartDateUnitSetting(s: SettingsValues): ChartDateUnit | null {
  return stringSetting(s, 'charts.dateUnit') as ChartDateUnit | null;
}
