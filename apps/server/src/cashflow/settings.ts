// The settings a page edits (stage-3.md §3.3, §4.4 SettingsSliceDto): each key's stored value
// (parsed with its registry schema; null when unset, stored as JSON null, or invalid) and the
// stored row's origin (null when the key was never stored).
import type { SettingKey, SettingsSliceDto, SettingValue, Origin } from '@joinr/schema';
import type { SettingsValues } from '../db/queries/settings';
import type { SettingOrigins } from '../investments/load';

export function settingsSliceDto(
  values: SettingsValues,
  origins: SettingOrigins,
  keys: readonly SettingKey[],
): SettingsSliceDto {
  const v: Partial<Record<SettingKey, SettingValue | null>> = {};
  const o: Partial<Record<SettingKey, Origin | null>> = {};
  for (const key of keys) {
    v[key] = values[key];
    o[key] = origins.get(key) ?? null;
  }
  return { values: v, origins: o };
}
