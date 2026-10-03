// The Stage 10 closes reads (stage-10.md §5.9, FROZEN signatures): `loadInstrumentCloses`,
// `loadInstrumentSplits`, `loadSeriesCloses` and `closesThrough`. Planted rows only (the seed's
// generic instruments, made-up closes, 2030 dates).
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { instrumentCloses, instrumentSplits, instruments, seriesCloses } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closesThrough,
  loadInstrumentCloses,
  loadInstrumentSplits,
  loadSeriesCloses,
} from '../../src/db/queries/closes';

let t: TestDb;
let abc: number;
let xyz: number;
let btc: number;
const fetchedAt = '2030-09-12T06:52:00.000Z';

beforeEach(() => {
  t = createTestDb();
  const ids = seedGenericData(t.db).instrumentIds;
  abc = ids['ASX:ABC']!;
  xyz = ids['ASX:XYZ']!;
  btc = ids.BTC!;
});
afterEach(() => t.close());

function plantClose(instrumentId: number, date: string, close: string, currency = 'AUD'): void {
  t.db
    .insert(instrumentCloses)
    .values({ instrumentId, date, close, currency, source: 'fake', fetchedAt })
    .run();
}

function plantSeries(seriesId: string, date: string, value: string): void {
  t.db.insert(seriesCloses).values({ seriesId, date, value, source: 'fake', fetchedAt }).run();
}

describe('loadInstrumentCloses', () => {
  it('reads ascending closes from a date, by instrument; absent ids are absent', () => {
    plantClose(abc, '2030-09-10', '50.1');
    plantClose(abc, '2030-09-05', '50');
    plantClose(abc, '2030-09-06', '50.2');
    plantClose(abc, '2030-08-01', '48');
    plantClose(btc, '2030-09-11', '160000');
    const out = loadInstrumentCloses(t.db, [abc, btc, xyz], '2030-09-05');
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([abc, btc].sort((a, b) => a - b));
    expect(out.get(abc)).toEqual({
      currency: 'AUD',
      closes: [
        ['2030-09-05', '50'],
        ['2030-09-06', '50.2'],
        ['2030-09-10', '50.1'],
      ],
    });
    expect(out.get(btc)?.closes).toEqual([['2030-09-11', '160000']]);
    expect(loadInstrumentCloses(t.db, [], '2030-01-01').size).toBe(0);
  });

  it("skips rows whose currency differs from the newest row's", () => {
    plantClose(xyz, '2030-09-04', '30', 'USD');
    plantClose(xyz, '2030-09-05', '45', 'AUD');
    plantClose(xyz, '2030-09-06', '46', 'AUD');
    expect(loadInstrumentCloses(t.db, [xyz], '2030-01-01').get(xyz)).toEqual({
      currency: 'AUD',
      closes: [
        ['2030-09-05', '45'],
        ['2030-09-06', '46'],
      ],
    });
  });

  it('goes with the instrument (ON DELETE CASCADE)', () => {
    plantClose(abc, '2030-09-05', '50');
    t.db
      .insert(instrumentSplits)
      .values({
        instrumentId: abc,
        date: '2030-09-10',
        numerator: '2',
        denominator: '1',
        fetchedAt,
      })
      .run();
    t.db.delete(instruments).where(eq(instruments.id, abc)).run();
    expect(loadInstrumentCloses(t.db, [abc], '2030-01-01').size).toBe(0);
    expect(loadInstrumentSplits(t.db, [abc]).size).toBe(0);
  });
});

describe('loadInstrumentSplits', () => {
  it('reads each instrument’s split dates ascending', () => {
    for (const date of ['2030-09-10', '2030-03-02'])
      t.db
        .insert(instrumentSplits)
        .values({ instrumentId: xyz, date, numerator: '2', denominator: '1', fetchedAt })
        .run();
    expect(loadInstrumentSplits(t.db, [xyz, abc])).toEqual(
      new Map([[xyz, ['2030-03-02', '2030-09-10']]]),
    );
    expect(loadInstrumentSplits(t.db, []).size).toBe(0);
  });
});

describe('loadSeriesCloses', () => {
  it('reads ascending values from a date, by series', () => {
    plantSeries('AUDUSD', '2030-09-06', '0.64');
    plantSeries('AUDUSD', '2030-09-05', '0.645');
    plantSeries('AUDUSD', '2030-08-01', '0.66');
    plantSeries('XAG_AUD_OZ', '2030-09-05', '50');
    const out = loadSeriesCloses(t.db, ['AUDUSD', 'XAG_AUD_OZ', 'GC_USD_OZ'], '2030-09-01');
    expect(out).toEqual(
      new Map([
        [
          'AUDUSD',
          [
            ['2030-09-05', '0.645'],
            ['2030-09-06', '0.64'],
          ],
        ],
        ['XAG_AUD_OZ', [['2030-09-05', '50']]],
      ]),
    );
    expect(loadSeriesCloses(t.db, [], '2030-01-01').size).toBe(0);
  });
});

describe('closesThrough', () => {
  it('is the oldest of the per-series newest dates; series without rows are ignored', () => {
    expect(closesThrough(t.db, [abc, btc], ['AUDUSD'])).toBeNull();
    plantClose(abc, '2030-09-10', '50');
    plantClose(abc, '2030-09-11', '50.3');
    plantClose(btc, '2030-09-09', '150000');
    plantClose(btc, '2030-09-11', '160000');
    plantSeries('AUDUSD', '2030-09-04', '0.64');
    plantSeries('AUDUSD', '2030-09-10', '0.64');
    expect(closesThrough(t.db, [abc, btc, xyz], [])).toBe('2030-09-11');
    expect(closesThrough(t.db, [abc, btc, xyz], ['AUDUSD', 'GC_USD_OZ'])).toBe('2030-09-10');
    expect(closesThrough(t.db, [xyz], ['GC_USD_OZ'])).toBeNull();
    expect(closesThrough(t.db, [], [])).toBeNull();
  });
});
