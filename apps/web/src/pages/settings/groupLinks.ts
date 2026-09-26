// The Settings groups a page links to (stage-5.md §6.5 item 10, D86): derived from the keys a
// form shows (never one fixed group), in SETTING_GROUPS order. No components (react-refresh);
// the links are in SettingsLinks.tsx.
import { SETTING_GROUPS, isSettingKey, settingGroupOf, type SettingGroupId } from '@joinr/schema';

export interface SettingsGroupRef {
  id: SettingGroupId;
  label: string;
}

/** The groups of the given keys (setting keys only; other inputs are skipped), in page order. */
export function settingsGroupsOf(keys: readonly string[]): SettingsGroupRef[] {
  const ids = new Set<SettingGroupId>();
  for (const key of keys) {
    if (isSettingKey(key)) ids.add(settingGroupOf(key));
  }
  return SETTING_GROUPS.filter((group) => ids.has(group.id)).map((group) => ({
    id: group.id,
    label: group.label,
  }));
}

/** "Pay and tax · Budget": the group names in words. */
export function settingsGroupsText(keys: readonly string[], separator = ' · '): string {
  return settingsGroupsOf(keys)
    .map((group) => group.label)
    .join(separator);
}
