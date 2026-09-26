import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  BUDGET_AUTO_KINDS,
  BUDGET_ITEM_KINDS,
  derivePriceSource,
  EDITABLE_NOTE_KINDS,
  EDITABLE_SETTING_KEYS,
  isEditableSettingKey,
  isRecordEntityId,
  isSettingKey,
  isWorkbookSetting,
  JOB_NAMES,
  PERIOD_NOTE_KINDS,
  settingDef,
  looksLikeYahooSymbol,
  MARKET_SERIES,
  normaliseSheetLabel,
  RECORD_ENTITIES,
  RECORD_ENTITY_IDS,
  RECORD_ENTITY_TABLES,
  RECORD_GROUPS,
  SETTING_BY_SHEET_OPTIONS_ID,
  SETTING_KEYS,
  SETTINGS,
  settingValueSchema,
  SHEET_OPTIONS_IDS,
  SHEET_OPTIONS_NOT_IMPORTED,
  SHEET_OPTIONS_VALIDATED,
  SNAPSHOT_VALUE_COLUMNS,
} from '../src/index';
import { getTableName } from 'drizzle-orm';
import { tables } from '../src/db/index';

describe('settings registry', () => {
  it('has unique keys in SETTING_KEYS order', () => {
    expect(SETTINGS.map((s) => s.key)).toEqual([...SETTING_KEYS]);
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length);
    expect(isSettingKey('pay.dayOfMonth')).toBe(true);
    expect(isSettingKey('nope')).toBe(false);
  });

  it('accounts for every SheetOptions ID 1–44 exactly once, each with a label', () => {
    const owners = new Map<number, string[]>();
    const add = (id: number, where: string, label: string) => {
      expect(label.trim(), `label of ID ${id}`).not.toBe('');
      owners.set(id, [...(owners.get(id) ?? []), where]);
    };
    for (const s of SETTINGS) {
      if (s.source && 'id' in s.source) add(s.source.id, s.key, s.source.sheetLabel);
    }
    for (const [id, v] of Object.entries(SHEET_OPTIONS_NOT_IMPORTED))
      add(Number(id), 'not-imported', v.sheetLabel);
    for (const [id, v] of Object.entries(SHEET_OPTIONS_VALIDATED))
      add(Number(id), 'validated', v.sheetLabel);
    expect([...owners.keys()].sort((a, b) => a - b)).toEqual([...SHEET_OPTIONS_IDS]);
    for (const [id, where] of owners) expect(where, `ID ${id}`).toHaveLength(1);
    expect(SETTING_BY_SHEET_OPTIONS_ID.get(2)?.key).toBe('pay.dayOfMonth');
  });

  it('flags the two secret IDs and never stores them', () => {
    const secret = Object.entries(SHEET_OPTIONS_NOT_IMPORTED)
      .filter(([, v]) => v.secret)
      .map(([id]) => Number(id));
    expect(secret.sort((a, b) => a - b)).toEqual([1, 29]);
    expect(SHEET_OPTIONS_NOT_IMPORTED[1]?.reasonCode).toBe('secret_not_imported');
    expect(SHEET_OPTIONS_NOT_IMPORTED[29]?.reasonCode).toBe('secret_not_imported');
    expect(SHEET_OPTIONS_VALIDATED[22]?.expected).toBe('AUD');
    expect(SHEET_OPTIONS_VALIDATED[39]?.expected).toBe('AUD');
  });

  it('marks the three "only when typed" overrides', () => {
    expect(SETTINGS.filter((s) => s.onlyWhenTyped).map((s) => s.key)).toEqual([
      'budget.emergencyFundOverrideCents',
      'charts.unitCount',
      'fire.yearlySpendOverrideCents',
    ]);
  });

  it('validates values by type', () => {
    expect(settingValueSchema('pay.dayOfMonth').safeParse(28).success).toBe(true);
    expect(settingValueSchema('pay.dayOfMonth').safeParse(29).success).toBe(false);
    expect(settingValueSchema('pay.netPayCents').safeParse(123456).success).toBe(true);
    expect(settingValueSchema('pay.netPayCents').safeParse(12.5).success).toBe(false);
    expect(settingValueSchema('allocation.etf').safeParse('0.6').success).toBe(true);
    expect(settingValueSchema('allocation.etf').safeParse('0.60').success).toBe(false);
    expect(settingValueSchema('pay.frequency').safeParse('fortnightly').success).toBe(true);
    expect(settingValueSchema('pay.frequency').safeParse('2-weeks').success).toBe(false);
    expect(settingValueSchema('pay.jobStartDate').safeParse('2026-02-30').success).toBe(false);
    expect(settingValueSchema('features.cash').safeParse(true).success).toBe(true);
    expect(settingValueSchema('charts.unitCount').safeParse(0).success).toBe(false);
  });
});

describe('settings registry: Stage 3 (stage-3.md §3.3)', () => {
  it('adds the app-only year basis, default FY', () => {
    expect(settingDef('savings.yearBasis')).toMatchObject({
      label: 'Year for the cash figures',
      category: 'savings',
      type: 'enum',
      enumValues: ['fy', 'calendar'],
      source: null,
      defaultValue: 'fy',
    });
    expect(settingValueSchema('savings.yearBasis').safeParse('calendar').success).toBe(true);
    expect(settingValueSchema('savings.yearBasis').safeParse('month').success).toBe(false);
    expect(settingDef('goals.houseDepositInvestmentShare').label).toBe(
      'Savings goals: share of investments counted',
    );
  });

  it('lists the editable keys: registry keys, the nine Budget ones first', () => {
    expect(new Set(EDITABLE_SETTING_KEYS).size).toBe(15);
    for (const key of EDITABLE_SETTING_KEYS) expect(isSettingKey(key), key).toBe(true);
    expect(EDITABLE_SETTING_KEYS.slice(0, 9).every((k) => /^(pay|budget)./.test(k))).toBe(true);
    expect(isEditableSettingKey('savings.yearBasis')).toBe(true);
    expect(isEditableSettingKey('allocation.etf')).toBe(false);
    expect(isEditableSettingKey(42)).toBe(false);
  });

  it('tells workbook keys from app-only keys', () => {
    expect(isWorkbookSetting('savings.yearBasis')).toBe(false);
    for (const key of EDITABLE_SETTING_KEYS.filter((k) => k !== 'savings.yearBasis')) {
      expect(isWorkbookSetting(key), key).toBe(true);
    }
    expect(SETTINGS.filter((s) => s.source === null).map((s) => s.key)).toEqual([
      'savings.yearBasis',
    ]);
  });

  it('appends the Stage 3 enums and codes as subsets where they must be', () => {
    for (const k of BUDGET_AUTO_KINDS) expect(BUDGET_ITEM_KINDS).toContain(k);
    for (const k of EDITABLE_NOTE_KINDS) expect(PERIOD_NOTE_KINDS).toContain(k);
    expect(JOB_NAMES).toEqual(['prices', 'dividends']);
    expect(API_ERROR_CODES.slice(-3)).toEqual([
      'ACCOUNT_IN_USE',
      'STREAM_IN_USE',
      'LAST_BALANCE_ENTRY',
    ]);
  });
});

describe('normaliseSheetLabel', () => {
  it('handles an internal newline and a parenthesised suffix', () => {
    expect(normaliseSheetLabel('Net Regular Income\n(What hits your bank)')).toBe(
      'net regular income (what hits your bank)',
    );
    expect(normaliseSheetLabel('Net Regular Income\r\n  (What hits your bank)')).toBe(
      normaliseSheetLabel('Net Regular Income (what hits your bank)'),
    );
  });

  it('strips one trailing colon', () => {
    expect(normaliseSheetLabel('Job Start Date:')).toBe('job start date');
    expect(normaliseSheetLabel('Job Start Date :')).toBe('job start date');
    expect(normaliseSheetLabel('Ratio::')).toBe('ratio:');
  });

  it('treats a hyphen and en/em dashes alike', () => {
    const hyphen = normaliseSheetLabel('Asset Allocations - ETFs');
    expect(normaliseSheetLabel('Asset Allocations – ETFs')).toBe(hyphen);
    expect(normaliseSheetLabel('Asset Allocations — ETFs')).toBe(hyphen);
  });

  it('collapses extra spaces and trims', () => {
    expect(normaliseSheetLabel('  House   Price\tTarget  ')).toBe('house price target');
  });
});

describe('record registry', () => {
  it('describes every entity with unique column ids and a real table', () => {
    const sqlTables = new Set<string>(Object.values(tables).map((t) => getTableName(t)));
    expect(Object.keys(RECORD_ENTITIES)).toEqual([...RECORD_ENTITY_IDS]);
    const groups = RECORD_GROUPS.map((g) => g.id);
    for (const id of RECORD_ENTITY_IDS) {
      const meta = RECORD_ENTITIES[id];
      expect(meta.id).toBe(id);
      expect(groups).toContain(meta.group);
      const ids = meta.columns.map((c) => c.id);
      expect(new Set(ids).size, id).toBe(ids.length);
      expect(ids, `${id} default sort`).toContain(meta.defaultSort.columnId);
      expect(sqlTables.has(RECORD_ENTITY_TABLES[id]), `${id} → ${RECORD_ENTITY_TABLES[id]}`).toBe(
        true,
      );
      for (const c of meta.columns) expect(c.label).toMatch(/^[A-Z]/);
    }
    expect(isRecordEntityId('trades')).toBe(true);
    expect(isRecordEntityId('users')).toBe(false);
  });

  it('lists the Stage 3 entities and the side-income deposits (stage-3.md §3.2)', () => {
    expect(RECORD_ENTITY_IDS.slice(-4)).toEqual([
      'cash-balance-entries',
      'savings-adjustments',
      'savings-goals',
      'dividend-events',
    ]);
    expect(RECORD_ENTITY_TABLES['side-income']).toBe('side_income_deposits');
    expect(RECORD_ENTITIES['side-income'].columns.map((c) => c.id)).toEqual([
      'date',
      'stream',
      'amount',
      'note',
      'sheetRef',
    ]);
    expect(RECORD_ENTITIES['savings-adjustments'].group).toBe('history');
    expect(RECORD_ENTITIES['dividend-events'].group).toBe('investments');
    expect(RECORD_ENTITIES['cash-balance-entries'].defaultSort).toEqual({
      columnId: 'asOf',
      desc: true,
    });
  });

  it('lists the 36 History value columns B…AK', () => {
    expect(SNAPSHOT_VALUE_COLUMNS).toHaveLength(36);
    expect(SNAPSHOT_VALUE_COLUMNS[0]).toMatchObject({
      historyColumn: 'B',
      id: 'stocksValue',
      type: 'money',
    });
    expect(SNAPSHOT_VALUE_COLUMNS[35]).toMatchObject({ historyColumn: 'AK', id: 'otherGain' });
    expect(SNAPSHOT_VALUE_COLUMNS.filter((c) => c.type === 'ratio')).toHaveLength(7);
    expect(RECORD_ENTITIES.snapshots.columns).toHaveLength(39);
  });
});

describe('derivePriceSource', () => {
  it.each([
    [{ kind: 'stock', symbol: 'ASX:ABC', exchange: 'ASX', code: 'ABC' }, 'yahoo', 'ABC.AX'],
    [{ kind: 'etf', symbol: 'ASX:XYZ', exchange: 'ASX', code: 'XYZ' }, 'yahoo', 'XYZ.AX'],
    [{ kind: 'etf', symbol: 'NYSEARCA:XYZ', exchange: 'NYSEARCA', code: 'XYZ' }, 'yahoo', 'XYZ'],
    [{ kind: 'stock', symbol: 'LON:ABC', exchange: 'LON', code: 'ABC' }, 'yahoo', 'ABC.L'],
    [{ kind: 'stock', symbol: 'XXX:ABC', exchange: 'XXX', code: 'ABC' }, 'none', null],
    [{ kind: 'stock', symbol: 'ABC', exchange: null, code: 'ABC' }, 'none', null],
    [{ kind: 'stock', symbol: 'toString:ABC', exchange: 'toString', code: 'ABC' }, 'none', null],
    [
      { kind: 'managed_fund', symbol: 'EXAMPLEFUND', exchange: null, code: 'EXAMPLEFUND' },
      'none',
      null,
    ],
    [{ kind: 'managed_fund', symbol: 'ABC.AX', exchange: null, code: 'ABC.AX' }, 'yahoo', 'ABC.AX'],
    [{ kind: 'managed_fund', symbol: 'SI=F', exchange: null, code: 'SI=F' }, 'yahoo', 'SI=F'],
    [
      { kind: 'managed_fund', symbol: '0P0000ABCD.AX', exchange: null, code: '0P0000ABCD.AX' },
      'yahoo',
      '0P0000ABCD.AX',
    ],
    [{ kind: 'crypto', symbol: 'BTC', exchange: null, code: 'BTC' }, 'coingecko', 'bitcoin'],
    [{ kind: 'crypto', symbol: 'ETH', exchange: null, code: 'ETH' }, 'coingecko', 'ethereum'],
    [{ kind: 'crypto', symbol: 'ZZZ', exchange: null, code: 'ZZZ' }, 'coingecko', null],
  ] as const)('%o → %s %s', (input, provider, providerSymbol) => {
    expect(derivePriceSource(input)).toEqual({ provider, providerSymbol });
  });

  it('recognises Yahoo-like managed-fund ids', () => {
    expect(looksLikeYahooSymbol('GC=F')).toBe(true);
    expect(looksLikeYahooSymbol('AUDUSD=X')).toBe(true);
    expect(looksLikeYahooSymbol('0P0000ABCD')).toBe(true);
    expect(looksLikeYahooSymbol('EXAMPLEFUND')).toBe(false);
    expect(looksLikeYahooSymbol('abc.ax')).toBe(false);
  });

  it('derives the bullion AUD series from the USD ones', () => {
    expect(MARKET_SERIES.XAG_AUD_OZ.derivedFrom).toEqual(['SI_USD_OZ', 'AUDUSD']);
    expect(MARKET_SERIES.XAU_AUD_OZ.derivedFrom).toEqual(['GC_USD_OZ', 'AUDUSD']);
    expect(MARKET_SERIES.AUDUSD.yahoo).toBe('AUDUSD=X');
  });
});
