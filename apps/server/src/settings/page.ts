// `GET /api/settings` (stage-5.md §4.4, §4.5 "Settings", D84–D95): every registry key with its
// stored value and origin, its group, whether it is editable and whether a save of it blocks a
// re-import, the pages that read it (SETTING_READERS), the marginal-rate suggestion for the gross
// salary (the engine's, D85, D90), the allocation targets' sum and the recorder's status. Only the
// settings rows (and the D98 app_meta marker) are read (one read transaction); nothing here needs
// the finance context. Stage 6 (stage-6.md §4.5): `notice` on the FIRE fields (the D98 note, the
// workbook's super contribution).
import type { EngineApi, MarginalRateSuggestion } from '@joinr/engine';
import {
  EDITABLE_SETTING_KEYS,
  isPreferenceSettingKey,
  isWorkbookSetting,
  JoinrDecimal,
  SETTING_GROUPS,
  SETTINGS,
  settingGroupOf,
  TAX_RATES_CHECKED_ON,
  type DecimalString,
  type FireAccessAgeReplacedDto,
  type MarginalRateSuggestionDto,
  type Origin,
  type RecorderStatusDto,
  type SettingDef,
  type SettingDto,
  type SettingsPageResponse,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { hasAppData } from '../db/queries/domain';
import {
  numberSetting,
  readSettings,
  stringSetting,
  type SettingsLog,
  type SettingsValues,
} from '../db/queries/settings';
import { fireSettingNotice } from '../fire/notices';
import { accessAgeReplaced, readAccessAgeMarker } from '../fire/upgrade';
import { marginalRateSuggestionFields } from '../history/dto';
import { allocationSumRatio } from '../history/inputs';
import { localIsoDate } from '../investments/format';
import { settingReaders } from './readers';

export interface SettingsPageDeps {
  database: AppDatabase;
  engine: EngineApi;
  now: () => Date;
}

const EDITABLE: ReadonlySet<string> = new Set(EDITABLE_SETTING_KEYS);

/** Who locks a key against edits: `AUTO_RECORD` (env) or the server (the cap's FY). */
export function lockedByOf(
  key: SettingDef['key'],
  config: Pick<Config, 'autoRecord'>,
): SettingDto['lockedBy'] {
  if (key === 'history.autoRecord' && config.autoRecord !== null) return 'env';
  if (key === 'super.concessionalCapFy') return 'server';
  return null;
}

export function settingDto(
  def: SettingDef,
  o: {
    values: SettingsValues;
    origins: ReadonlyMap<string, Origin>;
    config: Pick<Config, 'autoRecord'>;
    /** The D98 note's data while it applies (`accessAgeReplaced`); null otherwise. */
    replaced?: FireAccessAgeReplacedDto | null;
  },
): SettingDto {
  const preference = isPreferenceSettingKey(def.key);
  const origin = o.origins.get(def.key) ?? null;
  return {
    key: def.key,
    label: def.label,
    group: settingGroupOf(def.key),
    type: def.type,
    enumValues: def.enumValues ? [...def.enumValues] : null,
    min: def.min ?? null,
    max: def.max ?? null,
    defaultValue: def.defaultValue,
    value: o.values[def.key],
    origin,
    workbook: isWorkbookSetting(def.key) && !preference,
    editable: EDITABLE.has(def.key),
    lockedBy: lockedByOf(def.key, o.config),
    preference,
    usedOn: settingReaders(def.key),
    // Stage 6 (stage-6.md §4.5): the D98 and workbook-contribution notices; null otherwise.
    notice: fireSettingNotice(def.key, { origin, replaced: o.replaced ?? null }),
  };
}

/** Two decimal strings are the same number. */
function sameRatio(a: DecimalString, b: DecimalString): boolean {
  return new JoinrDecimal(a).equals(new JoinrDecimal(b));
}

/** The engine's suggestion plus the date the ATO rates were checked and the current rate (D90). */
export function taxSuggestionDto(
  s: MarginalRateSuggestion,
  currentRatio: DecimalString | null,
): MarginalRateSuggestionDto {
  const matches =
    currentRatio === null
      ? null
      : sameRatio(currentRatio, s.suggestedRatio)
        ? 'suggested'
        : sameRatio(currentRatio, s.bracketRatio)
          ? 'bracket'
          : null;
  return {
    ...marginalRateSuggestionFields(s),
    checkedOn: TAX_RATES_CHECKED_ON,
    currentRatio,
    matches,
  };
}

export function buildSettingsPage(
  deps: SettingsPageDeps,
  config: Pick<Config, 'autoRecord'>,
  recorder: RecorderStatusDto,
  log?: SettingsLog,
): SettingsPageResponse {
  const now = deps.now();
  const asOf = localIsoDate(now);
  const db = deps.database.db;
  const read = db.transaction(
    (tx) => ({
      values: readSettings(tx, log),
      origins: new Map(
        tx
          .select({ key: settings.key, origin: settings.origin })
          .from(settings)
          .all()
          .map((r) => [r.key, r.origin] as const),
      ),
      hasAppData: hasAppData(tx),
      marker: readAccessAgeMarker(tx),
    }),
    { behavior: 'deferred' },
  );
  const { values } = read;
  const replaced = accessAgeReplaced(read.marker, numberSetting(values, 'fire.preservationAge'));
  // No gross salary → no suggestion (the engine answers null too; it is not asked).
  const incomeCents = numberSetting(values, 'pay.grossAnnualSalaryCents');
  const suggestion =
    incomeCents === null ? null : deps.engine.suggestMarginalRate({ incomeCents, asOf });
  return {
    asOf,
    generatedAt: now.toISOString(),
    hasAppData: read.hasAppData,
    groups: SETTING_GROUPS.map((g) => ({ id: g.id, label: g.label, keys: [...g.keys] })),
    settings: SETTINGS.map((def) =>
      settingDto(def, { values, origins: read.origins, config, replaced }),
    ),
    taxSuggestion:
      suggestion === null
        ? null
        : taxSuggestionDto(suggestion, stringSetting(values, 'tax.marginalRate')),
    allocationSumRatio: allocationSumRatio(values),
    recorder,
  };
}
