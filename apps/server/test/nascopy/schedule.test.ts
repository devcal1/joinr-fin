// The weekly slot and the rules (stage-8.md §5.9, §5.13), in Melbourne time: W(t) and
// nextSlotAfter on an ordinary week and on both DST Sundays (2030, and 2026/2027), Sunday 02:59 /
// 03:00 / 03:01, Saturday 23:59, the 167 h and 169 h weeks; planNext with each gate and the
// 1-hour cap; the settled rules (a)–(d), the attempt count, the refusal lock and the stale rule.
process.env.TZ = 'Australia/Melbourne';

import type { NasCopyJobDetail } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import { NAS_COPY_FUTURE_SLACK_MS, NAS_COPY_WAKE_MAX_MS } from '../../src/nascopy/constants';
import {
  attemptsFor,
  isBlocked,
  isSettled,
  isStale,
  nextSlotAfter,
  planNext,
  slotAt,
  slotIso,
  type NasRun,
} from '../../src/nascopy/schedule';

const local = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, d, h, min);
const H = 3_600_000;

describe('W(t) and nextSlotAfter (§5.9 table)', () => {
  it('an ordinary Sunday, 15/09/2030: 03:00 AEST = 14/09 17:00Z', () => {
    const w = slotAt(local(2030, 9, 18, 12));
    expect(w.toISOString()).toBe('2030-09-14T17:00:00.000Z');
    expect(slotIso(w)).toBe('2030-09-15T03:00:00+10:00');
    expect(nextSlotAfter(local(2030, 9, 18, 12)).toISOString()).toBe('2030-09-21T17:00:00.000Z');
  });

  it('Sunday 02:59 is last week, 03:00 and 03:01 this week; Saturday 23:59 is last Sunday', () => {
    expect(slotIso(slotAt(local(2030, 9, 15, 2, 59)))).toBe('2030-09-08T03:00:00+10:00');
    expect(slotIso(slotAt(local(2030, 9, 15, 3, 0)))).toBe('2030-09-15T03:00:00+10:00');
    expect(slotIso(slotAt(local(2030, 9, 15, 3, 1)))).toBe('2030-09-15T03:00:00+10:00');
    expect(slotIso(slotAt(local(2030, 9, 21, 23, 59)))).toBe('2030-09-15T03:00:00+10:00');
    expect(slotIso(nextSlotAfter(local(2030, 9, 15, 2, 59)))).toBe('2030-09-15T03:00:00+10:00');
    expect(slotIso(nextSlotAfter(local(2030, 9, 15, 3, 0)))).toBe('2030-09-22T03:00:00+10:00');
  });

  it('the October change, Sunday 06/10/2030: 03:00 AEDT = 05/10 16:00Z', () => {
    const w = slotAt(new Date('2030-10-05T16:30:00Z'));
    expect(w.toISOString()).toBe('2030-10-05T16:00:00.000Z');
    expect(slotIso(w)).toBe('2030-10-06T03:00:00+11:00');
    // The gap: 02:30 does not exist; the first instant after 02:00 AEST is 03:00 AEDT.
    expect(slotIso(slotAt(new Date('2030-10-05T15:59:59Z')))).toBe('2030-09-29T03:00:00+10:00');
  });

  it('the October change, Sunday 04/10/2026 (the first slot after this release)', () => {
    expect(slotAt(new Date('2026-10-04T00:00:00Z')).toISOString()).toBe('2026-10-03T16:00:00.000Z');
    expect(nextSlotAfter(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe(
      '2026-10-03T16:00:00.000Z',
    );
  });

  it('the April change, Sunday 07/04/2030 and 04/04/2027: 03:00 AEST, once', () => {
    expect(slotAt(new Date('2030-04-06T17:00:00Z')).toISOString()).toBe('2030-04-06T17:00:00.000Z');
    expect(slotIso(slotAt(new Date('2030-04-06T17:00:00Z')))).toBe('2030-04-07T03:00:00+10:00');
    // Both 02:30s (AEDT 15:30Z, AEST 16:30Z) are before the slot: W is last Sunday.
    expect(slotIso(slotAt(new Date('2030-04-06T15:30:00Z')))).toBe('2030-03-31T03:00:00+11:00');
    expect(slotIso(slotAt(new Date('2030-04-06T16:30:00Z')))).toBe('2030-03-31T03:00:00+11:00');
    expect(slotAt(new Date('2027-04-04T12:00:00Z')).toISOString()).toBe('2027-04-03T17:00:00.000Z');
  });

  it('the weeks that contain a change are 167 h (October) and 169 h (April) long', () => {
    const oct = local(2030, 9, 29, 3);
    expect(nextSlotAfter(oct).getTime() - oct.getTime()).toBe(167 * H);
    const apr = local(2030, 3, 31, 3);
    expect(nextSlotAfter(apr).getTime() - apr.getTime()).toBe(169 * H);
    const plain = local(2030, 9, 15, 3);
    expect(nextSlotAfter(plain).getTime() - plain.getTime()).toBe(168 * H);
  });
});

describe('planNext', () => {
  const at = local(2030, 9, 18, 12);
  const base = { enabled: true, due: false, retryAt: null, catchUpAt: null };

  it('does nothing when disabled', () => {
    expect(planNext(at, { ...base, enabled: false, due: true })).toEqual({
      runNow: false,
      wakeAt: null,
      nextRunAt: null,
    });
  });

  it('wakes within the hour when nothing is due; next run is the next slot', () => {
    const plan = planNext(at, base);
    expect(plan.runNow).toBe(false);
    expect(plan.wakeAt?.getTime()).toBe(at.getTime() + NAS_COPY_WAKE_MAX_MS);
    expect(slotIso(plan.nextRunAt!)).toBe('2030-09-22T03:00:00+10:00');
    const late = local(2030, 9, 22, 2, 30);
    expect(planNext(late, base).wakeAt?.getTime()).toBe(local(2030, 9, 22, 3).getTime());
  });

  it('runs a due slot now with no gate', () => {
    expect(planNext(at, { ...base, due: true })).toEqual({
      runNow: true,
      wakeAt: at,
      nextRunAt: at,
    });
  });

  it('holds a due slot until a pending retry and until the armed catch-up', () => {
    const retryAt = new Date(at.getTime() + 2 * H);
    const retry = planNext(at, { ...base, due: true, retryAt });
    // The 1-hour cap wakes before a 2-hour retry; the next run is the retry.
    expect(retry).toEqual({
      runNow: false,
      wakeAt: new Date(at.getTime() + NAS_COPY_WAKE_MAX_MS),
      nextRunAt: retryAt,
    });
    const soon = new Date(at.getTime() + H / 4);
    expect(planNext(at, { ...base, due: true, retryAt: soon }).wakeAt).toEqual(soon);
    const catchUpAt = new Date(at.getTime() + 5 * 60_000);
    const catchUp = planNext(at, { ...base, due: true, catchUpAt, retryAt });
    expect(catchUp.runNow).toBe(false);
    expect(catchUp.wakeAt).toEqual(catchUpAt);
    expect(catchUp.nextRunAt).toEqual(retryAt);
    // The catch-up is re-checked when it comes due even when nothing is due.
    expect(planNext(at, { ...base, catchUpAt }).wakeAt).toEqual(catchUpAt);
  });

  it('ignores a retry when the slot is not due, and a gate already passed', () => {
    const past = new Date(at.getTime() - H);
    expect(planNext(at, { ...base, due: true, retryAt: past, catchUpAt: past }).runNow).toBe(true);
    expect(
      planNext(at, { ...base, retryAt: new Date(at.getTime() + H / 2) }).wakeAt?.getTime(),
    ).toBe(at.getTime() + NAS_COPY_WAKE_MAX_MS);
  });
});

// ─── The rules over runs ────────────────────────────────────────────────────────────────────────

let nextId = 1;
function run(
  status: 'succeeded' | 'failed' | 'running',
  startedAt: Date,
  detail: Partial<NasCopyJobDetail> | null = {},
  finishedAt: Date | null = new Date(startedAt.getTime() + 5_000),
): NasRun {
  return {
    id: nextId++,
    trigger: 'schedule',
    startedMs: startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt?.toISOString() ?? null,
    status,
    detail,
  };
}

const W = local(2030, 9, 15, 3);
const WISO = slotIso(W);
const T = local(2030, 9, 15, 12);
const attempted = (reason: NasCopyJobDetail['reason'], extra: Partial<NasCopyJobDetail> = {}) =>
  ({ attempted: true, slot: WISO, reason, ...extra }) as Partial<NasCopyJobDetail>;

describe('settled (§5.9 rules a–d)', () => {
  it('(a) a success of any trigger started at or after W (not in the future)', () => {
    expect(
      isSettled([run('succeeded', local(2030, 9, 15, 3, 0), { attempted: true })], W, T, 'ready'),
    ).toBe(true);
    expect(
      isSettled([run('succeeded', local(2030, 9, 15, 2, 59), { attempted: true })], W, T, 'ready'),
    ).toBe(false);
    const future = new Date(T.getTime() + NAS_COPY_FUTURE_SLACK_MS + 1);
    expect(isSettled([run('succeeded', future, {})], W, T, 'ready')).toBe(false);
    const edge = new Date(T.getTime() + NAS_COPY_FUTURE_SLACK_MS);
    expect(isSettled([run('succeeded', edge, {})], W, T, 'ready')).toBe(true);
  });

  it('(b) no_rsync settles the slot', () => {
    expect(isSettled([run('failed', T, attempted('no_rsync'))], W, T, 'ready')).toBe(true);
  });

  it('(c) a configuration failure settles only while not ready', () => {
    const r = run('failed', T, { attempted: false, slot: WISO, reason: 'password_missing' });
    expect(isSettled([r], W, T, 'partial')).toBe(true);
    expect(isSettled([r], W, T, 'invalid')).toBe(true);
    expect(isSettled([r], W, T, 'ready')).toBe(false);
  });

  it('(d) four real attempts; stops and configuration failures do not count', () => {
    const three = [1, 2, 3].map((i) =>
      run('failed', local(2030, 9, 15, 3 + i), attempted('unreachable')),
    );
    expect(isSettled(three, W, T, 'ready')).toBe(false);
    expect(attemptsFor(three, W)).toBe(3);
    const stops = [1, 2, 3].map((i) =>
      run('failed', local(2030, 9, 15, 3, i), attempted('stopped')),
    );
    const config = run('failed', T, { attempted: false, slot: WISO, reason: 'url_invalid' });
    expect(attemptsFor([...three, ...stops, config], W)).toBe(3);
    expect(isSettled([...three, ...stops], W, T, 'ready')).toBe(false);
    const four = [...three, run('failed', local(2030, 9, 15, 10), attempted('timeout'))];
    expect(isSettled(four, W, T, 'ready')).toBe(true);
  });

  it('a refusal settles nothing by itself', () => {
    expect(isSettled([run('failed', T, attempted('auth'))], W, T, 'ready')).toBe(false);
  });

  it('a run for another slot counts for nothing', () => {
    const other = {
      attempted: true,
      slot: '2030-09-08T03:00:00+10:00',
      reason: 'no_rsync' as const,
    };
    expect(isSettled([run('failed', T, other)], W, T, 'ready')).toBe(false);
  });
});

describe('the refusal lock (§5.9)', () => {
  const files = (m: number | null) => ({ url: m, password: m });
  const refused = run('failed', local(2030, 9, 15, 3), attempted('auth'));
  const before = refused.startedMs - 1;

  it('holds after auth, unknown_module or refused until a file changes', () => {
    for (const reason of ['auth', 'unknown_module', 'refused'] as const) {
      const r = run('failed', local(2030, 9, 15, 3), attempted(reason));
      expect(isBlocked([r], T, files(before))).toBe(true);
      expect(isBlocked([r], T, { url: before, password: r.startedMs + 1 })).toBe(false);
      expect(isBlocked([r], T, { url: r.startedMs + 1, password: before })).toBe(false);
    }
    expect(isBlocked([refused], T, files(refused.startedMs))).toBe(true);
  });

  it('looks only at the newest attempted run (a later success, a later config failure)', () => {
    const later = run('succeeded', local(2030, 9, 15, 9), { attempted: true });
    expect(isBlocked([refused, later], T, files(before))).toBe(false);
    const config = run('failed', local(2030, 9, 15, 9), {
      attempted: false,
      reason: 'url_missing',
    });
    expect(isBlocked([refused, config], T, files(before))).toBe(true);
    const running = run('running', local(2030, 9, 15, 11), null, null);
    expect(isBlocked([refused, running], T, files(before))).toBe(true);
  });

  it('ignores a future-dated refused row', () => {
    const future = run(
      'failed',
      new Date(T.getTime() + NAS_COPY_FUTURE_SLACK_MS + 1),
      attempted('auth'),
    );
    expect(isBlocked([future], T, files(before))).toBe(false);
  });

  it('does not hold for other failures', () => {
    for (const reason of ['unreachable', 'other', 'no_rsync', 'stopped'] as const) {
      expect(isBlocked([run('failed', T, attempted(reason))], T, files(before))).toBe(false);
    }
  });
});

describe('stale (§5.9)', () => {
  const now = local(2030, 9, 24, 12);
  const stale = (runs: NasRun[], o: { enabled?: boolean; configured?: 'ready' | 'partial' } = {}) =>
    isStale({ runs, now, enabled: o.enabled ?? true, configured: o.configured ?? 'ready' });
  const successAt = (ms: number) => run('succeeded', new Date(ms - 5_000), {}, new Date(ms));

  it('is false with no run at all (the within-the-hour copy decides)', () => {
    expect(stale([])).toBe(false);
  });

  it('turns on after 8 days since the last success', () => {
    expect(stale([successAt(now.getTime() - (7 * 24 + 23) * H)])).toBe(false);
    expect(stale([successAt(now.getTime() - (8 * 24 + 1) * H)])).toBe(true);
  });

  it('is false when not ready or the schedule is off', () => {
    const old = [successAt(now.getTime() - 30 * 24 * H)];
    expect(stale(old, { enabled: false })).toBe(false);
    expect(stale(old, { configured: 'partial' })).toBe(false);
  });

  it('ignores a future-dated success', () => {
    const old = successAt(now.getTime() - 9 * 24 * H);
    const future = successAt(now.getTime() + 2 * NAS_COPY_FUTURE_SLACK_MS);
    expect(stale([old, future])).toBe(true);
  });

  it('never succeeded: from the oldest attempted run; half-set-up rows do not count', () => {
    const partials = Array.from({ length: 10 }, (_, i) =>
      run('failed', new Date(now.getTime() - (10 - i) * 24 * H), {
        attempted: false,
        reason: 'password_missing',
      }),
    );
    expect(stale(partials)).toBe(false);
    const firstReal = run('failed', new Date(now.getTime() - 7 * 24 * H), attempted('unreachable'));
    expect(stale([...partials, firstReal])).toBe(false);
    const oldReal = run(
      'failed',
      new Date(now.getTime() - (8 * 24 + 1) * H),
      attempted('unreachable'),
    );
    expect(stale([...partials, oldReal, firstReal])).toBe(true);
  });
});
