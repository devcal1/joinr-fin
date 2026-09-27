// The Stage 6 schema additions (stage-6.md §3.2–3.3, §4.3): the `GET /api/fire` query schema (every
// bound, strictness, coercion, the ratio strings), the settings registry (63 keys, 62 editable, 21
// preferences, the fire group of eight, the labels sharing the what-if words, the access-age
// default 60, the two app-only keys) and the write bounds of the two new keys.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  EDITABLE_SETTING_KEYS,
  FIRE_ACCESS_AGE_META_KEY,
  FIRE_DEFAULT_ACCESS_AGE,
  FIRE_EXTRA_SAVINGS_MAX_CENTS,
  FIRE_FIELD_LABELS,
  FIRE_GROWTH_WEIGHT_KEYS,
  FIRE_HORIZON_AGE,
  FIRE_INPUT_SOURCES,
  FIRE_MILESTONE_KINDS,
  FIRE_MILESTONE_TONE_ORDER,
  FIRE_MISSING_INPUTS,
  FIRE_PHASE_WORDS,
  FIRE_PHASES,
  FIRE_QUERY_ACCESS_AGE_MAX,
  FIRE_REPLACED_ACCESS_AGE,
  FIRE_STATUSES,
  FIRE_WHAT_IF_FIELDS,
  FIRE_WINDOW_STALE_DAYS,
  fireQuerySchema,
  isEditableSettingKey,
  isPreferenceSettingKey,
  isWorkbookSetting,
  PREFERENCE_SETTING_KEYS,
  SETTING_GROUPS,
  SETTING_KEYS,
  SETTING_WRITE_BOUNDS,
  SETTINGS,
  SETTINGS_PATCH_MAX_KEYS,
  settingDef,
  settingGroupOf,
  settingsPatchSchema,
  settingValueSchema,
  type EditableSettingKey,
  type SettingValue,
} from '../src/index';

/** `path: message` lines, as the server's 400 formats them. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
}
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;
const patchIssues = (key: EditableSettingKey, value: SettingValue) =>
  issues(settingsPatchSchema, { values: { [key]: value } });

const FIRE_KEYS = [
  'fire.birthYear',
  'fire.preservationAge',
  'fire.inflationRate',
  'fire.withdrawalRate',
  'fire.yearlySpendOverrideCents',
  'fire.superContributionPerYearCents',
  'fire.marketReturn',
  'fire.extraSavingsPerYearCents',
] as const;

describe('FIRE constants (§3.2)', () => {
  it('lists the frozen enums in order', () => {
    expect(FIRE_STATUSES).toEqual([
      'needs_input',
      'spend_needed',
      'fire',
      'on_track',
      'not_reachable',
    ]);
    expect(FIRE_MISSING_INPUTS).toEqual([
      'birthYear',
      'accessAge',
      'inflationRate',
      'withdrawalRate',
      'marketReturn',
      'cashInterestRate',
      'rates',
    ]);
    expect(FIRE_PHASES).toEqual(['accumulation', 'top_up', 'drawdown', 'access', 'retired']);
    expect(FIRE_MILESTONE_KINDS).toEqual(['today', 'fire_start', 'top_ups_end', 'access']);
    expect(FIRE_GROWTH_WEIGHT_KEYS).toHaveLength(9);
    expect(FIRE_INPUT_SOURCES).toEqual(['setting', 'derived', 'what_if', 'default', 'missing']);
    expect(FIRE_MILESTONE_TONE_ORDER).toEqual(['teal', 'violet', 'fuchsia', 'orange']);
    expect(Object.keys(FIRE_PHASE_WORDS)).toEqual([...FIRE_PHASES]);
    expect(FIRE_PHASE_WORDS.access).toBe(FIRE_PHASE_WORDS.retired);
  });

  it('holds the D98 constants and the bounds', () => {
    expect(FIRE_DEFAULT_ACCESS_AGE).toBe(60);
    expect(FIRE_REPLACED_ACCESS_AGE).toBe(65);
    expect(FIRE_ACCESS_AGE_META_KEY).toBe('fire.accessAgeReplaced');
    expect(FIRE_HORIZON_AGE).toBe(100);
    expect(FIRE_WINDOW_STALE_DAYS).toBe(45);
    expect(FIRE_EXTRA_SAVINGS_MAX_CENTS).toBe(1_000_000_000);
  });

  it('maps every what-if field to an editable fire.* key and a label', () => {
    expect(Object.keys(FIRE_WHAT_IF_FIELDS).sort()).toEqual(Object.keys(FIRE_FIELD_LABELS).sort());
    expect(Object.keys(FIRE_WHAT_IF_FIELDS).sort()).toEqual(
      Object.keys(fireQuerySchema.shape).sort(),
    );
    for (const key of Object.values(FIRE_WHAT_IF_FIELDS)) {
      expect(isEditableSettingKey(key), key).toBe(true);
      expect(key.startsWith('fire.'), key).toBe(true);
    }
  });
});

describe('settings registry: Stage 6 (§3.3)', () => {
  it('holds 63 keys: the two app-only FIRE keys appended after history.autoRecord', () => {
    expect(SETTING_KEYS).toHaveLength(63);
    expect(SETTINGS.map((s) => s.key)).toEqual([...SETTING_KEYS]);
    expect(SETTING_KEYS.slice(-3)).toEqual([
      'history.autoRecord',
      'fire.marketReturn',
      'fire.extraSavingsPerYearCents',
    ]);
    expect(settingDef('fire.marketReturn')).toMatchObject({
      label: 'Market return for FIRE',
      category: 'fire',
      type: 'ratio',
      source: null,
      defaultValue: null,
    });
    expect(settingDef('fire.extraSavingsPerYearCents')).toMatchObject({
      label: 'Extra savings a year',
      category: 'fire',
      type: 'money',
      source: null,
      defaultValue: null,
    });
    // Signed money: no registry minimum.
    expect(settingDef('fire.extraSavingsPerYearCents').min).toBeUndefined();
    expect(settingValueSchema('fire.extraSavingsPerYearCents').safeParse(-500000).success).toBe(
      true,
    );
    expect(isWorkbookSetting('fire.marketReturn')).toBe(false);
    expect(isWorkbookSetting('fire.extraSavingsPerYearCents')).toBe(false);
  });

  it('defaults the access age to 60 (D98) and relabels the FIRE keys', () => {
    expect(settingDef('fire.preservationAge')).toMatchObject({
      label: 'Access age (preservation age)',
      defaultValue: FIRE_DEFAULT_ACCESS_AGE,
      min: 0,
      max: 120,
    });
    expect(settingDef('fire.yearlySpendOverrideCents').label).toBe('Yearly spend (override)');
    expect(settingDef('fire.superContributionPerYearCents').label).toBe(
      'Super contribution a year (override)',
    );
    expect(settingDef('fire.inflationRate').label).toBe('Inflation rate');
    expect(settingDef('fire.withdrawalRate').label).toBe('Withdrawal rate');
  });

  it('names each what-if field the same way in Settings (the label starts with its words)', () => {
    for (const [field, key] of Object.entries(FIRE_WHAT_IF_FIELDS)) {
      const words = FIRE_FIELD_LABELS[field as keyof typeof FIRE_FIELD_LABELS];
      expect(settingDef(key).label.startsWith(words), `${field} → ${key}`).toBe(true);
    }
  });

  it('makes 62 of 63 keys editable, the two new keys last', () => {
    expect(EDITABLE_SETTING_KEYS).toHaveLength(62);
    expect(EDITABLE_SETTING_KEYS.slice(-2)).toEqual([
      'fire.marketReturn',
      'fire.extraSavingsPerYearCents',
    ]);
    expect(EDITABLE_SETTING_KEYS.length).toBeLessThanOrEqual(SETTINGS_PATCH_MAX_KEYS);
  });

  it('groups the eight FIRE keys under "FIRE" in display order; the groups hold 63 keys', () => {
    const fire = SETTING_GROUPS.find((g) => g.id === 'fire')!;
    expect(fire.label).toBe('FIRE');
    expect(fire.keys).toEqual([...FIRE_KEYS]);
    const all = SETTING_GROUPS.flatMap((g) => [...g.keys]);
    expect(all).toHaveLength(63);
    expect(new Set(all)).toEqual(new Set(SETTING_KEYS));
    for (const key of FIRE_KEYS) expect(settingGroupOf(key)).toBe('fire');
  });

  it('lists 21 preference keys: the Stage 5 thirteen, then every fire.* key (D103)', () => {
    expect(PREFERENCE_SETTING_KEYS).toHaveLength(21);
    expect([...PREFERENCE_SETTING_KEYS.slice(13)].sort()).toEqual([...FIRE_KEYS].sort());
    expect(SETTING_KEYS.filter((k) => k.startsWith('fire.')).every(isPreferenceSettingKey)).toBe(
      true,
    );
    expect(isPreferenceSettingKey('returns.marketReturn')).toBe(false);
  });

  it('bounds the two new keys on write (at the bounds, one step past)', () => {
    expect(SETTING_WRITE_BOUNDS['fire.marketReturn']).toEqual({ min: -1, max: 1 });
    expect(patchIssues('fire.marketReturn', '-1')).toEqual([]);
    expect(patchIssues('fire.marketReturn', '1')).toEqual([]);
    expect(patchIssues('fire.marketReturn', '-1.0001')).toEqual([
      'values.fire.marketReturn: must be between -1 and 1',
    ]);
    expect(patchIssues('fire.marketReturn', '1.0001')).toEqual([
      'values.fire.marketReturn: must be between -1 and 1',
    ]);
    const max = FIRE_EXTRA_SAVINGS_MAX_CENTS;
    expect(patchIssues('fire.extraSavingsPerYearCents', max)).toEqual([]);
    expect(patchIssues('fire.extraSavingsPerYearCents', -max)).toEqual([]);
    expect(patchIssues('fire.extraSavingsPerYearCents', max + 1)).toEqual([
      `values.fire.extraSavingsPerYearCents: must be between ${-max} and ${max}`,
    ]);
    expect(patchIssues('fire.extraSavingsPerYearCents', -max - 1)).toEqual([
      `values.fire.extraSavingsPerYearCents: must be between ${-max} and ${max}`,
    ]);
    expect(patchIssues('fire.extraSavingsPerYearCents', 0.5)).toEqual([
      'values.fire.extraSavingsPerYearCents: must be whole cents',
    ]);
    expect(patchIssues('fire.marketReturn', null as never)).toEqual([]);
  });
});

describe('fireQuerySchema (§4.3)', () => {
  it('accepts an empty query and every field at its bounds, coercing the integers', () => {
    expect(fireQuerySchema.parse({})).toEqual({});
    expect(
      fireQuerySchema.parse({
        spend: '0',
        withdrawalRate: '1',
        inflationRate: '1',
        marketReturn: '1',
        accessAge: '30',
        extraSavings: String(-FIRE_EXTRA_SAVINGS_MAX_CENTS),
      }),
    ).toEqual({
      spend: 0,
      withdrawalRate: '1',
      inflationRate: '1',
      marketReturn: '1',
      accessAge: 30,
      extraSavings: -FIRE_EXTRA_SAVINGS_MAX_CENTS,
    });
    expect(
      fireQuerySchema.parse({
        spend: '10000000000',
        accessAge: '99',
        extraSavings: String(FIRE_EXTRA_SAVINGS_MAX_CENTS),
      }),
    ).toEqual({
      spend: 10_000_000_000,
      accessAge: 99,
      extraSavings: FIRE_EXTRA_SAVINGS_MAX_CENTS,
    });
  });

  it('normalises the ratio strings', () => {
    expect(fireQuerySchema.parse({ withdrawalRate: '0.040' }).withdrawalRate).toBe('0.04');
    expect(fireQuerySchema.parse({ marketReturn: '.07' }).marketReturn).toBe('0.07');
    expect(fireQuerySchema.parse({ inflationRate: ' -0.010 ' }).inflationRate).toBe('-0.01');
    expect(fireQuerySchema.parse({ withdrawalRate: '0.0375' }).withdrawalRate).toBe('0.0375');
  });

  it('rejects values one step past each bound, with the field path', () => {
    expect(issues(fireQuerySchema, { spend: '-1' })).toHaveLength(1);
    expect(issues(fireQuerySchema, { spend: '10000000001' })).toHaveLength(1);
    expect(issues(fireQuerySchema, { spend: '12.5' })).toHaveLength(1);
    expect(issues(fireQuerySchema, { withdrawalRate: '0' })).toEqual([
      'withdrawalRate: must be above 0',
    ]);
    expect(issues(fireQuerySchema, { withdrawalRate: '1.0001' })).toEqual([
      'withdrawalRate: must be at most 1',
    ]);
    expect(issues(fireQuerySchema, { inflationRate: '-1' })).toEqual([
      'inflationRate: must be above -1',
    ]);
    expect(ok(fireQuerySchema, { inflationRate: '-0.9999' })).toBe(true);
    expect(issues(fireQuerySchema, { marketReturn: '-1' })).toEqual([
      'marketReturn: must be above -1',
    ]);
    expect(issues(fireQuerySchema, { marketReturn: '1.01' })).toEqual([
      'marketReturn: must be at most 1',
    ]);
    expect(issues(fireQuerySchema, { accessAge: '29' })).toHaveLength(1);
    expect(issues(fireQuerySchema, { accessAge: '100' })).toHaveLength(1);
    expect(FIRE_QUERY_ACCESS_AGE_MAX).toBe(FIRE_HORIZON_AGE - 1);
    expect(issues(fireQuerySchema, { accessAge: '60.5' })).toHaveLength(1);
    expect(
      issues(fireQuerySchema, { extraSavings: String(FIRE_EXTRA_SAVINGS_MAX_CENTS + 1) }),
    ).toHaveLength(1);
    expect(
      issues(fireQuerySchema, { extraSavings: String(-FIRE_EXTRA_SAVINGS_MAX_CENTS - 1) }),
    ).toHaveLength(1);
    for (const issue of issues(fireQuerySchema, { accessAge: '101', spend: '-1' })) {
      expect(issue).toMatch(/^(accessAge|spend): /);
    }
  });

  it('rejects non-decimal ratios and unknown fields (strict)', () => {
    for (const bad of ['abc', '1e-2', '0,04', '4%', '', '-', '0.04.1', 'Infinity']) {
      expect(ok(fireQuerySchema, { withdrawalRate: bad }), bad).toBe(false);
    }
    expect(ok(fireQuerySchema, { withdrawalRate: '0.'.padEnd(31, '1') })).toBe(false);
    expect(issues(fireQuerySchema, { returnRate: '0.05' })).toHaveLength(1);
    expect(ok(fireQuerySchema, { spend: 'abc' })).toBe(false);
  });

  it('takes strict whole numbers: no blank, hex, exponent or plus sign (triage CODE-2)', () => {
    for (const bad of ['', ' ', '0x10', '1e5', '+5']) {
      expect(ok(fireQuerySchema, { spend: bad }), `spend ${JSON.stringify(bad)}`).toBe(false);
      expect(ok(fireQuerySchema, { extraSavings: bad }), `extraSavings ${bad}`).toBe(false);
      expect(ok(fireQuerySchema, { accessAge: bad }), `accessAge ${bad}`).toBe(false);
    }
    // A query string or a JS number (the web's what-if objects) both parse to a number.
    expect(fireQuerySchema.parse({ spend: '4250000' })).toEqual({ spend: 4_250_000 });
    expect(fireQuerySchema.parse({ spend: 4_250_000 })).toEqual({ spend: 4_250_000 });
    expect(fireQuerySchema.parse({ extraSavings: ' -500 ' })).toEqual({ extraSavings: -500 });
    expect(ok(fireQuerySchema, { spend: 12.5 })).toBe(false);
  });

  it('bounds the access age below the horizon, on the query and on write (triage SPEC-2)', () => {
    expect(ok(fireQuerySchema, { accessAge: '99' })).toBe(true);
    expect(ok(fireQuerySchema, { accessAge: '100' })).toBe(false);
    expect(SETTING_WRITE_BOUNDS['fire.preservationAge']).toEqual({ min: 0, max: 99 });
    expect(patchIssues('fire.preservationAge', 99)).toEqual([]);
    expect(patchIssues('fire.preservationAge', 100)).toEqual([
      'values.fire.preservationAge: must be between 0 and 99',
    ]);
  });
});
