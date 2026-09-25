// readSettings (stage-2.md §4.5 step 2, §7.4 step 1): valid values parse with the registry schema;
// invalid JSON and wrong types read as null with a warning that never carries the value.
import { SETTING_KEYS } from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  booleanSetting,
  chartDateUnitSetting,
  numberSetting,
  payFrequencySetting,
  readSettings,
  stringSetting,
} from '../../src/db/queries/settings';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.close());

function put(key: string, valueJson: string): void {
  t.db
    .insert(settings)
    .values({ key, valueJson, updatedAt: '2026-09-24T00:00:00.000Z', origin: 'import' })
    .run();
}

describe('readSettings', () => {
  it('returns every registry key, null when unset', () => {
    const s = readSettings(t.db);
    expect(Object.keys(s).sort()).toEqual([...SETTING_KEYS].sort());
    expect(Object.values(s).every((v) => v === null)).toBe(true);
  });

  it('parses valid values of each type', () => {
    put('pay.netPayCents', '300000');
    put('pay.frequency', '"fortnightly"');
    put('allocation.etf', '"0.6"');
    put('budget.autoInvestSplit', 'true');
    put('charts.dateUnit', '"quarterly"');
    put('pay.jobStartDate', '"2020-01-06"');
    const s = readSettings(t.db);
    expect(numberSetting(s, 'pay.netPayCents')).toBe(300000);
    expect(payFrequencySetting(s)).toBe('fortnightly');
    expect(stringSetting(s, 'allocation.etf')).toBe('0.6');
    expect(booleanSetting(s, 'budget.autoInvestSplit')).toBe(true);
    expect(chartDateUnitSetting(s)).toBe('quarterly');
    expect(stringSetting(s, 'pay.jobStartDate')).toBe('2020-01-06');
  });

  it('reads invalid JSON and wrong types as null and warns without the value', () => {
    put('pay.netPayCents', '{not json');
    put('pay.frequency', '"hourly"');
    put('allocation.etf', '0.6');
    put('budget.autoInvestSplit', '"yes"');
    put('pay.dayOfMonth', '12.5');
    put('investing.etfLimit', 'null');
    put('unknown.key', '"ignored"');
    const warn = vi.fn();
    const s = readSettings(t.db, { warn });
    expect(s['pay.netPayCents']).toBeNull();
    expect(s['pay.frequency']).toBeNull();
    expect(s['allocation.etf']).toBeNull();
    expect(s['budget.autoInvestSplit']).toBeNull();
    expect(s['pay.dayOfMonth']).toBeNull();
    expect(s['investing.etfLimit']).toBeNull();
    expect('unknown.key' in s).toBe(false);
    expect(warn).toHaveBeenCalledTimes(5);
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of ['not json', 'hourly', '12.5', '"yes"']) {
      expect(logged).not.toContain(secret);
    }
    expect(warn.mock.calls.map((c) => (c[0] as { key: string }).key).sort()).toEqual([
      'allocation.etf',
      'budget.autoInvestSplit',
      'pay.dayOfMonth',
      'pay.frequency',
      'pay.netPayCents',
    ]);
  });

  it('works inside a transaction handle', () => {
    put('crypto.feeRate', '"0.005"');
    const s = t.db.transaction((tx) => readSettings(tx));
    expect(stringSetting(s, 'crypto.feeRate')).toBe('0.005');
  });
});
