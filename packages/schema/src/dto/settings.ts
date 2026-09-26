// Settings API (stage-5.md §4.4, frozen): `GET /api/settings`. `PATCH /api/settings` keeps its
// Stage 3 request schema and response (`settingsPatchSchema`, `SettingsPatchResponse`,
// dto/cashflow.ts) with the Stage 5 keys and bounds.
import type { Origin } from '../enums';
import type { DecimalString, IsoDate, IsoTimestamp } from '../primitives';
import type { SettingGroupId, SettingKey, SettingType, SettingValue } from '../settings';
import type { RecorderStatusDto } from './history';

export interface SettingDto {
  key: SettingKey;
  label: string;
  group: SettingGroupId;
  type: SettingType;
  enumValues: string[] | null;
  min: number | null;
  max: number | null;
  defaultValue: SettingValue | null;
  value: SettingValue | null;
  /** Null: never stored (the default applies). */
  origin: Origin | null;
  /** isWorkbookSetting and not a preference key: editing it blocks a re-import (D34). */
  workbook: boolean;
  /** In EDITABLE_SETTING_KEYS (every key but super.concessionalCapFy; D91). */
  editable: boolean;
  /** env: AUTO_RECORD; server: super.concessionalCapFy. */
  lockedBy: 'env' | 'server' | null;
  /** In PREFERENCE_SETTING_KEYS: kept on re-import, never app data (§3.3; D95). */
  preference: boolean;
  /** Page ids that read it (the web links back, §6.5; [] for the unused keys). */
  usedOn: string[];
}

/** = the engine's MarginalRateSuggestion (Cents → number) plus the server's fields. */
export interface MarginalRateSuggestionDto {
  /** asOf's FY (start year). */
  financialYear: number;
  /** The table used (the nearest earlier one past the end). */
  tableFinancialYear: number;
  /** False when asOf's FY is after the last table. */
  tableCurrent: boolean;
  incomeCents: number;
  /** thresholdCents < income ≤ toCents (display adds $1 to the threshold). */
  bracket: { thresholdCents: number; toCents: number | null; ratio: DecimalString };
  bracketRatio: DecimalString;
  medicare: {
    thresholdCents: number;
    thresholdFinancialYear: number;
    ratio: DecimalString;
    band: 'none' | 'shade_in' | 'full';
  };
  /** The bracket plus the levy (D90). */
  suggestedRatio: DecimalString;
  incomeTaxCents: number;
  medicareLevyCents: number;
  /** In the LITO phase-out range (the offset is not built; the hint says so). */
  litoPhaseOut: boolean;
  checkedOn: IsoDate;
  /** tax.marginalRate now. */
  currentRatio: DecimalString | null;
  /** The current rate equals one of the two figures (D90). */
  matches: 'suggested' | 'bracket' | null;
}

export interface SettingsPageResponse {
  asOf: IsoDate;
  generatedAt: IsoTimestamp;
  hasAppData: boolean;
  groups: { id: SettingGroupId; label: string; keys: SettingKey[] }[];
  /** Registry order. */
  settings: SettingDto[];
  /** Null without a gross salary. */
  taxSuggestion: MarginalRateSuggestionDto | null;
  /** Σ allocation.* set values (null when none is set). */
  allocationSumRatio: DecimalString | null;
  recorder: RecorderStatusDto;
}
