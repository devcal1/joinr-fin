// The Stage 5 schema additions (stage-5.md §3.2–3.3, §4.3): the request schemas (bounds, strictness,
// blank text → null, unique months, the month bound with an injected clock, the correctable columns
// and their sign bounds, the required reason, the query coercion), the settings registry (60
// editable keys, the groups, the labels, the write-only bounds, the preference keys), the ATO
// tables and the history constants.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CASHFLOW_MONEY_MAX,
  CORRECTABLE_SNAPSHOT_COLUMNS,
  CORRECTION_SIGN_BOUNDS,
  EDITABLE_SETTING_KEYS,
  historySeriesQuerySchema,
  isPreferenceSettingKey,
  isWorkbookSetting,
  LITO_PHASE_OUT_FROM_CENTS,
  LITO_PHASE_OUT_TO_CENTS,
  makeRecordRequestSchema,
  MEDICARE_LEVY_RATIO,
  MEDICARE_LOW_INCOME_THRESHOLDS,
  MEDICARE_SHADE_IN_FACTOR,
  MEDICARE_SHADE_IN_RATIO,
  monthEndOf,
  NET_WORTH_CLASS_SLOTS,
  NET_WORTH_CLASSES,
  NET_WORTH_LIABILITIES,
  NET_WORTH_PROJECTION_MONTHS,
  NET_WORTH_STACK_ORDER,
  netWorthQuerySchema,
  PREFERENCE_SETTING_KEYS,
  RECORD_MONTHS_MAX,
  RECORD_TRIGGERS,
  recordRequestSchema,
  RESIDENT_TAX_TABLES,
  SETTING_GROUPS,
  SETTING_KEYS,
  SETTING_WRITE_BOUNDS,
  settingDef,
  settingGroupOf,
  SETTINGS,
  settingsPatchSchema,
  SETTINGS_PATCH_MAX_KEYS,
  SNAPSHOT_AUDIT_ACTIONS,
  SNAPSHOT_CHECK_COLUMNS,
  SNAPSHOT_COLUMN_LABELS,
  SNAPSHOT_COLUMN_MODES,
  SNAPSHOT_FIGURE_COLUMNS,
  SNAPSHOT_OFFSET_EXTRAS,
  SNAPSHOT_RECORD_HOUR,
  SNAPSHOT_SOURCES,
  snapshotCorrectionSchema,
  TAX_RATES_CHECKED_ON,
  type EditableSettingKey,
  type SettingKey,
  type SettingValue,
} from '../src/index';
import { optionalText, signedCents } from '../src/dto/fields';

/** Thu 24/09/2026 14:32 local: the as-of month is Sep 2026. */
const now = () => new Date(2026, 8, 24, 14, 32);

/** `path: message` lines, as the server's 400 formats them. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
}
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('netWorthQuerySchema / historySeriesQuerySchema (§4.3)', () => {
  it('coerces the count, bounds it 1–240 and takes a chart unit', () => {
    expect(netWorthQuerySchema.parse({})).toEqual({});
    expect(netWorthQuerySchema.parse({ unit: 'quarterly', count: '8' })).toEqual({
      unit: 'quarterly',
      count: 8,
    });
    expect(netWorthQuerySchema.parse({ count: '240' })).toEqual({ count: 240 });
    for (const count of ['0', '241', '1.5', 'many']) {
      expect(ok(netWorthQuerySchema, { count }), count).toBe(false);
    }
    expect(ok(netWorthQuerySchema, { unit: 'weekly' })).toBe(false);
    expect(ok(netWorthQuerySchema, { unit: 'monthly', view: 'all' })).toBe(false);
    expect(historySeriesQuerySchema).toBe(netWorthQuerySchema);
  });
});

describe('recordRequestSchema (§4.3)', () => {
  const schema = makeRecordRequestSchema(now);

  it('takes 1–24 distinct months up to the as-of month, and a note (blank → null)', () => {
    expect(schema.parse({ periodMonths: ['2026-08', '2026-09'], note: '  Holiday  ' })).toEqual({
      periodMonths: ['2026-08', '2026-09'],
      note: 'Holiday',
    });
    expect(schema.parse({ periodMonths: ['2026-09'], note: '' })).toEqual({
      periodMonths: ['2026-09'],
      note: null,
    });
    expect(schema.parse({ periodMonths: ['2026-09'], note: null }).note).toBeNull();
    expect(issues(schema, { periodMonths: [], note: null })).toEqual([
      'periodMonths: must list at least one month',
    ]);
    const many = Array.from({ length: RECORD_MONTHS_MAX + 1 }, (_, i) =>
      monthEndOf(
        `20${String(10 + Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, '0')}`,
      ).slice(0, 7),
    );
    expect(issues(schema, { periodMonths: many, note: null })).toEqual([
      `periodMonths: must list at most ${RECORD_MONTHS_MAX} months`,
    ]);
    expect(ok(schema, { periodMonths: many.slice(0, RECORD_MONTHS_MAX), note: null })).toBe(true);
  });

  it('refuses a month twice, a month after this month and a malformed month', () => {
    expect(issues(schema, { periodMonths: ['2026-08', '2026-08'], note: null })).toEqual([
      'periodMonths: a month appears twice',
    ]);
    expect(issues(schema, { periodMonths: ['2026-09', '2026-10'], note: null })).toEqual([
      'periodMonths.1: after this month',
    ]);
    expect(ok(schema, { periodMonths: ['2026-13'], note: null })).toBe(false);
    expect(ok(schema, { periodMonths: ['2026-9'], note: null })).toBe(false);
  });

  it('reads the clock at parse time (the month bound follows an injected now)', () => {
    const october = makeRecordRequestSchema(() => new Date(2026, 9, 1, 0, 5));
    expect(ok(october, { periodMonths: ['2026-10'], note: null })).toBe(true);
    expect(ok(schema, { periodMonths: ['2026-10'], note: null })).toBe(false);
  });

  it('is strict and bounds the note at 200 characters', () => {
    expect(ok(schema, { periodMonths: ['2026-09'], note: null, source: 'late' })).toBe(false);
    expect(ok(schema, { periodMonths: ['2026-09'] })).toBe(false);
    expect(issues(schema, { periodMonths: ['2026-09'], note: 'x'.repeat(201) })).toEqual([
      'note: must be at most 200 characters',
    ]);
    expect(ok(recordRequestSchema, { periodMonths: ['2000-01'], note: null })).toBe(true);
  });
});

describe('snapshotCorrectionSchema (§4.3)', () => {
  it('takes the correctable columns (null clears a cell) and a reason', () => {
    expect(
      snapshotCorrectionSchema.parse({
        values: { cashValueCents: 250000, superGainCents: null, mortgageBalanceCents: -100 },
        note: '  From the statement ',
      }),
    ).toEqual({
      values: { cashValueCents: 250000, superGainCents: null, mortgageBalanceCents: -100 },
      note: 'From the statement',
    });
    const every = Object.fromEntries(CORRECTABLE_SNAPSHOT_COLUMNS.map((c) => [c, 0]));
    expect(ok(snapshotCorrectionSchema, { values: every, note: 'All' })).toBe(true);
    expect(CORRECTABLE_SNAPSHOT_COLUMNS).toHaveLength(24);
  });

  it('refuses no figure, a derived or movement column, and an unknown column', () => {
    expect(issues(snapshotCorrectionSchema, { values: {}, note: 'Why' })).toEqual([
      'values: name at least one figure',
    ]);
    for (const column of [...SNAPSHOT_CHECK_COLUMNS, 'nope', 'superMeasuredThrough']) {
      expect(ok(snapshotCorrectionSchema, { values: { [column]: 1 }, note: 'Why' }), column).toBe(
        false,
      );
    }
  });

  it('keeps the stored signs: offsets ≥ 0, accounts in debit and the mortgage ≤ 0', () => {
    expect(CORRECTION_SIGN_BOUNDS).toEqual({
      offsetCents: 'non_negative',
      mortgageOffsetCents: 'non_negative',
      cashDebtCents: 'non_positive',
      mortgageBalanceCents: 'non_positive',
    });
    const bad = {
      offsetCents: -1,
      mortgageOffsetCents: -1,
      cashDebtCents: 1,
      mortgageBalanceCents: 1,
    };
    expect(issues(snapshotCorrectionSchema, { values: bad, note: 'Why' })).toEqual([
      'values.offsetCents: must not be negative',
      'values.mortgageOffsetCents: must not be negative',
      'values.cashDebtCents: must not be positive',
      'values.mortgageBalanceCents: must not be positive',
    ]);
    const edge = {
      offsetCents: 0,
      mortgageOffsetCents: 0,
      cashDebtCents: 0,
      mortgageBalanceCents: 0,
    };
    expect(ok(snapshotCorrectionSchema, { values: edge, note: 'Why' })).toBe(true);
    // Other columns take either sign (a loss, a negative cash balance).
    expect(ok(snapshotCorrectionSchema, { values: { cashValueCents: -5 }, note: 'Why' })).toBe(
      true,
    );
  });

  it('requires a reason, bounds money and is strict', () => {
    expect(issues(snapshotCorrectionSchema, { values: { cashValueCents: 1 }, note: '  ' })).toEqual(
      ['note: say why'],
    );
    expect(ok(snapshotCorrectionSchema, { values: { cashValueCents: 1 } })).toBe(false);
    expect(
      issues(snapshotCorrectionSchema, { values: { cashValueCents: 1 }, note: 'x'.repeat(201) }),
    ).toEqual(['note: must be at most 200 characters']);
    expect(
      ok(snapshotCorrectionSchema, {
        values: { cashValueCents: CASHFLOW_MONEY_MAX + 1 },
        note: 'y',
      }),
    ).toBe(false);
    expect(ok(snapshotCorrectionSchema, { values: { cashValueCents: 1.5 }, note: 'y' })).toBe(
      false,
    );
    expect(
      ok(snapshotCorrectionSchema, { values: { cashValueCents: 1 }, note: 'y', revision: 2 }),
    ).toBe(false);
  });

  it('the shared field schemas keep their Stage 4 behaviour (dto/fields.ts)', () => {
    expect(optionalText(5).parse('  ')).toBeNull();
    expect(ok(optionalText(5), 'toolong')).toBe(false);
    expect(signedCents.parse(-CASHFLOW_MONEY_MAX)).toBe(-CASHFLOW_MONEY_MAX);
    expect(ok(signedCents, CASHFLOW_MONEY_MAX + 1)).toBe(false);
  });
});

describe('settings registry: Stage 5 (stage-5.md §3.3)', () => {
  it('holds 61 keys: history.autoRecord appended, app-only, default off', () => {
    // Stage 6 (stage-6.md §3.3) appends two more keys after it (63).
    expect(SETTING_KEYS.indexOf('history.autoRecord')).toBe(60);
    expect(SETTINGS.map((s) => s.key)).toEqual([...SETTING_KEYS]);
    expect(settingDef('history.autoRecord')).toMatchObject({
      label: 'Record each month automatically on its last day',
      category: 'history',
      type: 'boolean',
      source: null,
      defaultValue: false,
    });
    expect(isWorkbookSetting('history.autoRecord')).toBe(false);
  });

  it('makes 60 keys editable: every key but super.concessionalCapFy, the Stage 3–4 order kept', () => {
    // Stage 6 (stage-6.md §3.3) appends its two app-only keys (62).
    expect(EDITABLE_SETTING_KEYS).toHaveLength(62);
    expect(new Set(EDITABLE_SETTING_KEYS).size).toBe(62);
    expect(
      SETTING_KEYS.filter((k) => !(EDITABLE_SETTING_KEYS as readonly string[]).includes(k)),
    ).toEqual(['super.concessionalCapFy']);
    expect(EDITABLE_SETTING_KEYS.slice(0, 22)).toEqual([
      'pay.frequency',
      'pay.netPayCents',
      'pay.dayOfMonth',
      'pay.jobStartDate',
      'budget.includeSideIncome',
      'budget.emergencyFundMonths',
      'budget.emergencyFundOverrideCents',
      'budget.autoInvestSplit',
      'budget.useForInvestAmount',
      'goals.cashSavingsTargetCents',
      'goals.eoyCashGoalCents',
      'goals.houseDepositInvestmentShare',
      'savings.includeMortgagePrincipal',
      'savings.yearBasis',
      'property.offsetsIncludeEmergencyFund',
      'pay.grossAnnualSalaryCents',
      'tax.marginalRate',
      'otherAssets.stalePriceDays',
      'super.sgRate',
      'super.contributionsTaxRate',
      'super.concessionalCapCents',
      'super.importedContributionType',
    ]);
    // The rest in registry order, then the auto-record switch (and the two Stage 6 keys).
    const rest = EDITABLE_SETTING_KEYS.slice(22, -3);
    const order = (k: string) => SETTING_KEYS.indexOf(k as SettingKey);
    expect([...rest].sort((a, b) => order(a) - order(b))).toEqual(rest);
    expect(EDITABLE_SETTING_KEYS.at(-3)).toBe('history.autoRecord');
  });

  it('partitions every key into the eleven groups (the cap FY in Super)', () => {
    expect(SETTING_GROUPS.map((g) => [g.id, g.keys.length])).toEqual([
      ['pay', 6],
      ['budget', 5],
      ['cash', 6],
      ['allocation', 6],
      ['investing', 6],
      ['super', 5],
      ['assets', 1],
      ['history', 3],
      ['features', 11],
      ['fire', 8],
      ['unused', 6],
    ]);
    const all = SETTING_GROUPS.flatMap((g) => [...g.keys]);
    expect(all).toHaveLength(63);
    expect(new Set(all)).toEqual(new Set(SETTING_KEYS));
    expect(settingGroupOf('super.concessionalCapFy')).toBe('super');
    expect(settingGroupOf('history.autoRecord')).toBe('history');
    expect(settingGroupOf('goals.housePriceTargetCents')).toBe('unused');
    for (const g of SETTING_GROUPS) expect(g.label.trim(), g.id).not.toBe('');
  });

  it('gives every key a distinct, non-empty label (one label per key, D86)', () => {
    const labels = SETTINGS.map((s) => s.label.trim());
    for (const [i, label] of labels.entries()) expect(label, SETTINGS[i]!.key).not.toBe('');
    expect(new Set(labels).size).toBe(labels.length);
    expect(settingDef('pay.dayOfMonth').label).toBe('Pay day (day of the month)');
    expect(settingDef('savings.yearBasis').label).toBe('Year basis');
    expect(settingDef('savings.includeMortgagePrincipal').label).toBe(
      'Count mortgage principal as savings',
    );
    expect(settingDef('features.retirement').label).toBe('Show the Super page');
    for (const key of SETTING_KEYS.filter((k) => k.startsWith('features.'))) {
      expect(settingDef(key).label, key).toMatch(/^Show the .+ page$/);
    }
  });

  it('lists the 13 preference keys (D95): the two chart keys and the eleven page switches', () => {
    // Stage 6 (D103, stage-6.md §3.3) adds the eight fire.* keys (21).
    expect(PREFERENCE_SETTING_KEYS.slice(0, 13)).toHaveLength(13);
    expect([...PREFERENCE_SETTING_KEYS.slice(0, 13)].sort()).toEqual(
      SETTING_KEYS.filter((k) => k.startsWith('charts.') || k.startsWith('features.')).sort(),
    );
    expect(isPreferenceSettingKey('features.crypto')).toBe(true);
    expect(isPreferenceSettingKey('history.autoRecord')).toBe(false);
    // Every Stage 5 preference key is a workbook key (so the rule is needed).
    for (const k of PREFERENCE_SETTING_KEYS.slice(0, 13))
      expect(isWorkbookSetting(k), k).toBe(true);
  });

  it('holds every editable key in one PATCH (60 ≤ 64)', () => {
    expect(EDITABLE_SETTING_KEYS.length).toBeLessThanOrEqual(SETTINGS_PATCH_MAX_KEYS);
    const all = Object.fromEntries(EDITABLE_SETTING_KEYS.map((k) => [k, null]));
    expect(Object.keys(settingsPatchSchema.parse({ values: all }).values)).toHaveLength(62);
  });

  const patchIssues = (key: EditableSettingKey, value: SettingValue) =>
    issues(settingsPatchSchema, { values: { [key]: value } });

  it('applies the write-only bounds (SETTING_WRITE_BOUNDS) on top of the registry', () => {
    expect(SETTING_WRITE_BOUNDS).toEqual({
      'charts.unitCount': { min: 1, max: 240 },
      'returns.cashInterestRate': { min: -1, max: 1 },
      'returns.marketReturn': { min: -1, max: 1 },
      'fire.inflationRate': { min: -1, max: 1 },
      'fire.withdrawalRate': { min: 0, max: 1 },
      'fire.preservationAge': { min: 0, max: 99 },
      // Stage 6 (stage-6.md §3.3).
      'fire.marketReturn': { min: -1, max: 1 },
      'fire.extraSavingsPerYearCents': { min: -1_000_000_000, max: 1_000_000_000 },
    });
    expect(patchIssues('charts.unitCount', 240)).toEqual([]);
    expect(patchIssues('charts.unitCount', 241)).toEqual([
      'values.charts.unitCount: must be between 1 and 240',
    ]);
    expect(patchIssues('charts.unitCount', 0)).toHaveLength(1);
    for (const key of [
      'returns.cashInterestRate',
      'returns.marketReturn',
      'fire.inflationRate',
    ] as const) {
      expect(patchIssues(key, '-1'), key).toEqual([]);
      expect(patchIssues(key, '1'), key).toEqual([]);
      expect(patchIssues(key, '-1.01'), key).toEqual([`values.${key}: must be between -1 and 1`]);
      expect(patchIssues(key, '1.5'), key).toEqual([`values.${key}: must be between -1 and 1`]);
    }
    expect(patchIssues('fire.withdrawalRate', '0')).toEqual([]);
    expect(patchIssues('fire.withdrawalRate', '-0.01')).toEqual([
      'values.fire.withdrawalRate: must be between 0 and 1',
    ]);
    // The registry reader stays lenient: an imported value outside the write bounds still parses.
    expect(settingDef('charts.unitCount').max).toBeUndefined();
  });

  it('accepts the six unused workbook keys (D91) at their registry bounds and refuses one step past', () => {
    expect(patchIssues('goals.houseDepositRatio', '0')).toEqual([]);
    expect(patchIssues('goals.houseDepositRatio', '1')).toEqual([]);
    expect(patchIssues('goals.houseDepositRatio', '1.01')).toHaveLength(1);
    expect(patchIssues('goals.houseDepositRatio', '-0.01')).toHaveLength(1);
    for (const key of [
      'goals.housePriceTargetCents',
      'goals.houseSavingsPerYearCents',
      'investing.parcelAmountCents',
    ] as const) {
      expect(patchIssues(key, 0), key).toEqual([]);
      expect(patchIssues(key, CASHFLOW_MONEY_MAX), key).toEqual([]);
      expect(patchIssues(key, -1), key).toHaveLength(1);
      expect(patchIssues(key, CASHFLOW_MONEY_MAX + 1), key).toEqual([
        `values.${key}: is too large`,
      ]);
    }
    expect(patchIssues('investing.parcelFrequencyMonths', 0)).toEqual([]);
    expect(patchIssues('investing.parcelFrequencyMonths', 1200)).toEqual([]);
    expect(patchIssues('investing.parcelFrequencyMonths', -1)).toHaveLength(1);
    expect(patchIssues('investing.parcelFrequencyMonths', 1201)).toEqual([
      'values.investing.parcelFrequencyMonths: must be at most 1200',
    ]);
    expect(patchIssues('savings.includeRetirementContributions', true)).toEqual([]);
    expect(patchIssues('savings.includeRetirementContributions', 'yes')).toHaveLength(1);
  });

  it('bounds the other newly editable keys by the registry', () => {
    expect(patchIssues('allocation.etf', '1')).toEqual([]);
    expect(patchIssues('allocation.etf', '1.2')).toEqual([
      'values.allocation.etf: must be between 0 and 1',
    ]);
    expect(patchIssues('fire.birthYear', 1899)).toHaveLength(1);
    expect(patchIssues('investing.allocationAggressiveness', 'wild')).toHaveLength(1);
    expect(patchIssues('history.autoRecord', true)).toEqual([]);
    expect(patchIssues('features.crypto', false)).toEqual([]);
  });
});

describe('ATO tables (src/tax.ts, §3.2)', () => {
  it('holds ascending bands per FY with the legislated second-band cuts', () => {
    expect(Object.keys(RESIDENT_TAX_TABLES).map(Number)).toEqual([2024, 2025, 2026, 2027]);
    for (const [fy, bands] of Object.entries(RESIDENT_TAX_TABLES)) {
      expect(bands[0], fy).toEqual({ thresholdCents: 0, ratio: '0' });
      for (let i = 1; i < bands.length; i += 1) {
        expect(bands[i]!.thresholdCents, fy).toBeGreaterThan(bands[i - 1]!.thresholdCents);
        expect(Number(bands[i]!.ratio), fy).toBeGreaterThan(Number(bands[i - 1]!.ratio));
      }
      expect(
        bands.map((b) => b.thresholdCents),
        fy,
      ).toEqual([0, 1_820_000, 4_500_000, 13_500_000, 19_000_000]);
      expect(
        bands.slice(2).map((b) => b.ratio),
        fy,
      ).toEqual(['0.3', '0.37', '0.45']);
    }
    expect(RESIDENT_TAX_TABLES[2024]![1]!.ratio).toBe('0.16');
    expect(RESIDENT_TAX_TABLES[2025]![1]!.ratio).toBe('0.16');
    expect(RESIDENT_TAX_TABLES[2026]![1]!.ratio).toBe('0.15');
    expect(RESIDENT_TAX_TABLES[2027]![1]!.ratio).toBe('0.14');
  });

  it('holds the Medicare levy, its shade-in, the thresholds and the LITO range', () => {
    expect(MEDICARE_LEVY_RATIO).toBe('0.02');
    expect(MEDICARE_SHADE_IN_RATIO).toBe('0.1');
    expect(MEDICARE_SHADE_IN_FACTOR).toBe('1.25');
    expect(MEDICARE_LOW_INCOME_THRESHOLDS).toEqual({ 2024: 2_722_200, 2025: 2_801_100 });
    expect(LITO_PHASE_OUT_FROM_CENTS).toBe(3_750_000);
    expect(LITO_PHASE_OUT_TO_CENTS).toBe(6_666_700);
    expect(LITO_PHASE_OUT_TO_CENTS).toBeGreaterThan(LITO_PHASE_OUT_FROM_CENTS);
    expect(TAX_RATES_CHECKED_ON).toBe('2026-09-26');
  });
});

describe('history constants (src/history.ts, §3.2)', () => {
  it('monthEndOf gives the last day, leap years included', () => {
    expect(monthEndOf('2027-02')).toBe('2027-02-28');
    expect(monthEndOf('2028-02')).toBe('2028-02-29');
    expect(monthEndOf('2100-02')).toBe('2100-02-28');
    expect(monthEndOf('2000-02')).toBe('2000-02-29');
    expect(monthEndOf('2026-06')).toBe('2026-06-30');
    expect(monthEndOf('2026-12')).toBe('2026-12-31');
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-31']) {
      expect(() => monthEndOf(bad), bad).toThrow(RangeError);
    }
  });

  it('draws the eight classes in one stack order with a slot each (a bijection onto 1–8)', () => {
    expect(NET_WORTH_STACK_ORDER).toEqual([
      'stock',
      'etf',
      'crypto',
      'cash',
      'managed_fund',
      'other_assets',
      'super',
      'property',
    ]);
    for (const c of NET_WORTH_STACK_ORDER) expect(NET_WORTH_CLASSES).toContain(c);
    expect(
      NET_WORTH_CLASSES.filter((c) => !(NET_WORTH_STACK_ORDER as readonly string[]).includes(c)),
    ).toEqual(['offsets']);
    expect(Object.keys(NET_WORTH_CLASS_SLOTS).sort()).toEqual([...NET_WORTH_STACK_ORDER].sort());
    expect(Object.values(NET_WORTH_CLASS_SLOTS).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    // D93: no folded class.
    expect(NET_WORTH_CLASSES).toHaveLength(9);
    expect((NET_WORTH_CLASSES as readonly string[]).includes('other_classes')).toBe(false);
    expect(NET_WORTH_LIABILITIES).toEqual(['mortgages', 'cash_debit', 'other_debts']);
  });

  it('records at 23:00 (D89), up to 24 months per request, 12 projected rows', () => {
    expect(SNAPSHOT_RECORD_HOUR).toBe(23);
    expect(RECORD_MONTHS_MAX).toBe(24);
    expect(NET_WORTH_PROJECTION_MONTHS).toBe(12);
  });

  it('describes every figure column once: modes, labels, correctable columns', () => {
    expect(SNAPSHOT_FIGURE_COLUMNS).toHaveLength(40);
    expect(new Set(SNAPSHOT_FIGURE_COLUMNS).size).toBe(40);
    expect(Object.keys(SNAPSHOT_COLUMN_MODES)).toEqual([...SNAPSHOT_FIGURE_COLUMNS]);
    expect(Object.keys(SNAPSHOT_COLUMN_LABELS)).toEqual([...SNAPSHOT_FIGURE_COLUMNS]);
    const labels = Object.values(SNAPSHOT_COLUMN_LABELS).map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(SNAPSHOT_COLUMN_LABELS.stocksValueCents.historyColumn).toBe('B');
    expect(SNAPSHOT_COLUMN_LABELS.otherGainCents.historyColumn).toBe('AK');
    expect(
      SNAPSHOT_FIGURE_COLUMNS.filter((c) => SNAPSHOT_COLUMN_LABELS[c].historyColumn === null),
    ).toEqual(['offsetCents', 'mortgageOffsetCents', 'cashDebtCents', 'superMeasuredThrough']);
    const byMode = (m: string) =>
      SNAPSHOT_FIGURE_COLUMNS.filter((c) => SNAPSHOT_COLUMN_MODES[c] === m);
    expect(byMode('sum')).toEqual([
      'stocksMovementsCents',
      'etfMovementsCents',
      'cryptoMovementsCents',
      'cashGainCents',
      'superContribCents',
      'salaryMonthlyCents',
      'mfMovementsCents',
    ]);
    expect(byMode('ratio')).toHaveLength(7);
    for (const c of byMode('ratio')) expect(c).toMatch(/Ratio$/);
    for (const c of CORRECTABLE_SNAPSHOT_COLUMNS) {
      expect(SNAPSHOT_FIGURE_COLUMNS, c).toContain(c);
      expect(SNAPSHOT_CHECK_COLUMNS as readonly string[], c).not.toContain(c);
    }
    expect([...SNAPSHOT_OFFSET_EXTRAS]).toEqual([
      'offsetCents',
      'mortgageOffsetCents',
      'cashDebtCents',
    ]);
    for (const c of SNAPSHOT_CHECK_COLUMNS) expect(SNAPSHOT_FIGURE_COLUMNS, c).toContain(c);
  });

  it('appends the Stage 5 enums', () => {
    expect(SNAPSHOT_SOURCES).toEqual(['migrated', 'recorded', 'lookback', 'late']);
    expect(SNAPSHOT_AUDIT_ACTIONS).toEqual(['record', 'correct', 'delete']);
    expect(RECORD_TRIGGERS).toEqual(['manual', 'schedule', 'startup']);
    expect(SNAPSHOT_CHECK_COLUMNS).toHaveLength(13);
  });
});
