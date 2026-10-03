// The ASX market state (stage-9.md §6.6; pure, the zone passed in). The process runs in Melbourne
// (the backup.test.ts pattern) but every call passes its zone explicitly; Sydney and Melbourne give
// the same local times on every DST change date 2026–2030.
process.env.TZ = 'Australia/Melbourne';

import { wallTimeInZone } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import { asxMarketState, newestSessionDate } from '../../src/mobile/market';

const MEL = 'Australia/Melbourne';
const SYD = 'Australia/Sydney';

/** The UTC instant of a Melbourne wall time (AEST +10 or AEDT +11, given). */
const at = (local: string, offset: '+10:00' | '+11:00') => Date.parse(`${local}${offset}`);

const state = (nowMs: number, dates: string[] = [], yahooCooling = false, timeZone = MEL) =>
  asxMarketState({ nowMs, timeZone, heldAsxSessionDates: dates, yahooCooling });

describe('the process zone', () => {
  it('this file runs in Melbourne (fails if the TZ line is missing)', () => {
    expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
  });
});

describe('asxMarketState', () => {
  // Thursday 12/09/2030 (AEST).
  it('weekday: pre_open 07:00–10:00, open 10:00–16:12, closed otherwise', () => {
    expect(state(at('2030-09-12T06:59:00', '+10:00'))).toBe('closed');
    expect(state(at('2030-09-12T07:00:00', '+10:00'))).toBe('pre_open');
    expect(state(at('2030-09-12T09:59:00', '+10:00'))).toBe('pre_open');
    expect(state(at('2030-09-12T10:00:00', '+10:00'))).toBe('open');
    expect(state(at('2030-09-12T16:11:00', '+10:00'))).toBe('open');
    expect(state(at('2030-09-12T16:12:00', '+10:00'))).toBe('closed');
    expect(state(at('2030-09-12T23:00:00', '+10:00'))).toBe('closed');
  });

  it('weekends are closed', () => {
    expect(state(at('2030-09-14T11:00:00', '+10:00'))).toBe('closed');
    expect(state(at('2030-09-15T08:00:00', '+10:00'))).toBe('closed');
  });

  it('a holiday: after 10:30 with held day rows and none dated today → closed', () => {
    const t1029 = at('2030-09-18T10:29:00', '+10:00');
    const t1030 = at('2030-09-18T10:30:00', '+10:00');
    expect(state(t1029, ['2030-09-17'])).toBe('open'); // within the grace
    expect(state(t1030, ['2030-09-17'])).toBe('closed');
    expect(state(t1030, ['2030-09-17', '2030-09-18'])).toBe('open');
    expect(state(t1030, [])).toBe('open'); // no held ASX rows: no evidence
    expect(state(t1030, ['2030-09-17'], true)).toBe('open'); // a Yahoo cool-down: no evidence
  });

  it('the zone is an input: the same instant in New York is a different state', () => {
    const t = at('2030-09-12T11:00:00', '+10:00'); // 21:00 Wednesday in New York
    expect(state(t)).toBe('open');
    expect(state(t, [], false, 'America/New_York')).toBe('closed');
  });

  it('Sydney and Melbourne give the same local times on every DST change date 2026–2030', () => {
    // The first Sunday of April and of October, each year.
    const firstSunday = (y: number, m: number) => {
      for (let d = 1; d <= 7; d += 1)
        if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) return d;
      throw new Error('no Sunday');
    };
    for (let y = 2026; y <= 2030; y += 1) {
      for (const m of [4, 10]) {
        const d = firstSunday(y, m);
        const startUtc = Date.UTC(y, m - 1, d - 1, 12); // the evening before, UTC
        for (let i = 0; i < 24 * 12; i += 1) {
          const ms = startUtc + i * 5 * 60_000;
          expect(wallTimeInZone(ms, SYD), `${y}-${m} ${i}`).toEqual(wallTimeInZone(ms, MEL));
          expect(state(ms, [], false, SYD)).toBe(state(ms, [], false, MEL));
        }
      }
    }
  });

  it('newestSessionDate', () => {
    expect(newestSessionDate([])).toBeNull();
    expect(newestSessionDate(['2030-09-11', '2030-09-12', '2030-09-10'])).toBe('2030-09-12');
  });
});
