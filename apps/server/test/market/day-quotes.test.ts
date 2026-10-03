// The Stage 9 day-cache reads (stage-9.md §5.4, FROZEN signatures): `loadDayQuotes`,
// `loadSeriesDayQuotes` and `loadFxPreviousCloses`. Planted rows only (made-up symbols and prices).
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { dayQuotes, marketQuotes, seriesDayQuotes } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadDayQuotes,
  loadFxPreviousCloses,
  loadSeriesDayQuotes,
  parseDayPoints,
} from '../../src/db/queries/dayQuotes';

let t: TestDb;
let ids: Record<string, number>;

beforeEach(() => {
  t = createTestDb();
  ids = seedGenericData(t.db).instrumentIds;
});
afterEach(() => t.close());

const day = {
  sessionDate: '2030-09-12',
  timeZone: 'Australia/Sydney',
  granularity: '5m' as const,
  nativeCurrency: 'AUD',
  previousClose: '50',
  regularStart: '2030-09-12T00:00:00.000Z',
  regularEnd: '2030-09-12T06:00:00.000Z',
  source: 'fake' as const,
  fetchedAt: '2030-09-12T05:20:00.000Z',
};

describe('parseDayPoints', () => {
  it('reads [[unixSeconds, "price"], …] and refuses anything else', () => {
    expect(parseDayPoints('[]')).toEqual([]);
    expect(parseDayPoints('[[1915400000,"50.5"],[1915400300,"50.6"]]')).toEqual([
      [1915400000, '50.5'],
      [1915400300, '50.6'],
    ]);
    for (const bad of [
      '',
      '{',
      '{}',
      '[[1,2]]',
      '[["1","2"]]',
      '[[1915400000,"50.50"]]',
      '[[0,"1"]]',
      '[[1.5,"1"]]',
      '[[1,"1",2]]',
    ])
      expect(parseDayPoints(bad), bad).toBeNull();
  });
});

describe('loadDayQuotes', () => {
  it('returns each instrument row with its points parsed; none → empty map', () => {
    expect(loadDayQuotes(t.db).size).toBe(0);
    const abc = ids['ASX:ABC']!;
    t.db
      .insert(dayQuotes)
      .values({ instrumentId: abc, ...day, points: '[[1915400000,"50.5"]]' })
      .run();
    const rows = loadDayQuotes(t.db);
    expect([...rows.keys()]).toEqual([abc]);
    expect(rows.get(abc)).toEqual({ ...day, points: [[1915400000, '50.5']] });
  });

  it('reads a malformed points value as none and warns with the id only', () => {
    const abc = ids['ASX:ABC']!;
    t.db
      .insert(dayQuotes)
      .values({ instrumentId: abc, ...day, points: 'not json' })
      .run();
    const warn = vi.fn();
    const rows = loadDayQuotes(t.db, { warn });
    expect(rows.get(abc)!.points).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ instrumentId: abc });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('not json');
    // Without a logger it still reads.
    expect(loadDayQuotes(t.db).get(abc)!.points).toEqual([]);
  });
});

describe('loadSeriesDayQuotes', () => {
  it('keys the bullion rows by series id', () => {
    t.db
      .insert(seriesDayQuotes)
      .values([
        {
          seriesId: 'XAU_AUD_OZ',
          ...day,
          timeZone: 'Australia/Melbourne',
          previousClose: '3076.923076923077',
          points: '[[1915365600,"3076.923076923077"]]',
        },
        {
          seriesId: 'GC_USD_OZ',
          ...day,
          timeZone: 'Australia/Melbourne',
          nativeCurrency: 'USD',
          previousClose: '2000',
          points: '[]',
        },
      ])
      .run();
    const rows = loadSeriesDayQuotes(t.db);
    expect([...rows.keys()].sort()).toEqual(['GC_USD_OZ', 'XAU_AUD_OZ']);
    expect(rows.get('XAU_AUD_OZ')!.points).toEqual([[1915365600, '3076.923076923077']]);
    expect(rows.get('GC_USD_OZ')).toMatchObject({
      nativeCurrency: 'USD',
      previousClose: '2000',
      points: [],
    });
  });
});

describe('loadFxPreviousCloses', () => {
  it('returns only the series with both a previous close and its date', () => {
    expect(loadFxPreviousCloses(t.db).size).toBe(0);
    t.db
      .update(marketQuotes)
      .set({ previousClose: '0.64', previousCloseDate: '2030-09-11' })
      .where(eq(marketQuotes.seriesId, 'AUDUSD'))
      .run();
    t.db
      .update(marketQuotes)
      .set({ previousClose: '30', previousCloseDate: null })
      .where(eq(marketQuotes.seriesId, 'SI_USD_OZ'))
      .run();
    expect(loadFxPreviousCloses(t.db)).toEqual(
      new Map([['AUDUSD', { value: '0.64', date: '2030-09-11' }]]),
    );
  });
});
