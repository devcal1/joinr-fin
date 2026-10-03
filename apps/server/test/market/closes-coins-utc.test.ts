// Stage 10 (stage-10.md §5.3): `coinClosesFrom` with the process in UTC gives the same Melbourne
// closes (the zone is a parameter; the process TZ is never read). Made-up values; no network.
process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import { coinClosesFrom } from '../../src/market/closes/coins';
import { everyStep } from './closesHelpers';

const HOUR = 3_600_000;
const ms = (iso: string) => Date.parse(iso);

it('runs with the process in UTC (the TZ line above)', () => {
  expect(new Date(2030, 9, 7).toISOString()).toBe('2030-10-07T00:00:00.000Z');
});

describe('coinClosesFrom in a UTC process', () => {
  it('still takes 00:00 Melbourne across the October and April changes', () => {
    const points = (from: string, to: string) =>
      everyStep(ms(from), ms(to), HOUR).map((t): [number, number] => [t, t / HOUR]);
    const oct = coinClosesFrom(
      points('2030-10-04T00:00:00Z', '2030-10-08T00:00:00Z'),
      'Australia/Melbourne',
      '2030-10-05',
      '2030-10-07',
      false,
    );
    expect(oct.map((c) => Number(c.close) * HOUR)).toEqual([
      ms('2030-10-05T14:00:00Z'),
      ms('2030-10-06T13:00:00Z'),
    ]);
    const apr = coinClosesFrom(
      points('2031-04-04T00:00:00Z', '2031-04-08T00:00:00Z'),
      'Australia/Melbourne',
      '2031-04-05',
      '2031-04-07',
      false,
    );
    expect(apr.map((c) => Number(c.close) * HOUR)).toEqual([
      ms('2031-04-05T13:00:00Z'),
      ms('2031-04-06T14:00:00Z'),
    ]);
  });
});
