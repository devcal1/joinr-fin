// Retention (stage-7.md §5.3, §5.11, D115): examples A–E exactly (the kept set and each file's
// keptAs), same-date duplicates, the month window at year ends, each non-nightly kind's count,
// foreign files never touched, a file dated next year, and the same result under TZ=UTC (grouping
// is by the date written in the name).
process.env.TZ = 'Australia/Melbourne';

import { BACKUP_KEEP_BY_KIND, type BackupKeptAs, type BackupKind } from '@joinr/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { formatBackupName, localCompactDate } from '../../src/backups/names';
import { retain, type RetentionRef } from '../../src/backups/retention';

afterEach(() => {
  process.env.TZ = 'Australia/Melbourne';
});

/** One nightly copy a day at 02:30 local, from `from` to `to` inclusive (y, m1, d). */
function dailies(from: [number, number, number], to: [number, number, number]): string[] {
  const out: string[] = [];
  const end = new Date(to[0], to[1] - 1, to[2], 2, 30);
  for (let d = new Date(from[0], from[1] - 1, from[2], 2, 30); d <= end;) {
    out.push(formatBackupName('nightly', d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 2, 30);
  }
  return out;
}

const nightly = (y: number, m: number, d: number, h = 2, min = 30): string =>
  formatBackupName('nightly', new Date(y, m - 1, d, h, min));

function refAt(y: number, m: number, d: number, h = 2, min = 31): RetentionRef {
  const instant = new Date(y, m - 1, d, h, min);
  return { instant, localDate: localCompactDate(instant) };
}

/** The keep map as a plain object sorted by name. */
function kept(map: Map<string, BackupKeptAs>): Record<string, BackupKeptAs> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** `nightly-YYYYMMDD-…` → `DD/MM/YYYY` for readable expectations. */
const dateOf = (name: string): string => {
  const m = /-(\d{4})(\d{2})(\d{2})-/.exec(name)!;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

function keptByDate(map: Map<string, BackupKeptAs>): Record<string, BackupKeptAs> {
  const out: Record<string, BackupKeptAs> = {};
  for (const [name, why] of map) out[dateOf(name)] = why;
  return out;
}

describe('retain: nightly (§5.3 worked examples)', () => {
  it('A: dailies 01/01/2030 → 15/09/2030, now 15/09/2030', () => {
    const files = dailies([2030, 1, 1], [2030, 9, 15]);
    const r = retain(files, 'nightly', refAt(2030, 9, 15));
    const expected: Record<string, BackupKeptAs> = {};
    for (let d = 2; d <= 14; d++) expected[`${String(d).padStart(2, '0')}/09/2030`] = 'daily';
    expected['15/09/2030'] = 'daily_and_monthly';
    for (const md of ['31/01', '28/02', '31/03', '30/04', '31/05', '30/06', '31/07', '31/08']) {
      expected[`${md}/2030`] = 'monthly';
    }
    expect(keptByDate(r.keep)).toEqual(expected);
    expect(r.keep.size).toBe(22);
    expect(r.remove).toHaveLength(files.length - 22);
    expect(r.future).toEqual([]);
    // Removed oldest first.
    expect(dateOf(r.remove[0]!)).toBe('01/01/2030');
  });

  it('B: one year on, dailies to 15/09/2031', () => {
    const files = dailies([2030, 1, 1], [2031, 9, 15]);
    const r = retain(files, 'nightly', refAt(2031, 9, 15));
    const expected: Record<string, BackupKeptAs> = {};
    for (let d = 2; d <= 14; d++) expected[`${String(d).padStart(2, '0')}/09/2031`] = 'daily';
    expected['15/09/2031'] = 'daily_and_monthly';
    for (const md of ['31/10/2030', '30/11/2030', '31/12/2030']) expected[md] = 'monthly';
    for (const md of ['31/01', '28/02', '31/03', '30/04', '31/05', '30/06', '31/07', '31/08']) {
      expected[`${md}/2031`] = 'monthly';
    }
    expect(keptByDate(r.keep)).toEqual(expected);
    expect(r.keep.size).toBe(25);
    // Every September 2030 copy falls out.
    expect(r.remove.filter((n) => n.includes('-203009')).length).toBe(30);
  });

  it('C: off 04/09 → 13/09, a catch-up at 10:02 on 14/09, then 02:30 on 15/09', () => {
    const files = [
      ...dailies([2030, 1, 1], [2030, 9, 3]),
      nightly(2030, 9, 14, 10, 2),
      nightly(2030, 9, 15),
    ];
    const r = retain(files, 'nightly', refAt(2030, 9, 15));
    const expected: Record<string, BackupKeptAs> = {
      '15/09/2030': 'daily_and_monthly',
      '14/09/2030': 'daily',
      '03/09/2030': 'daily',
      '02/09/2030': 'daily',
      '01/09/2030': 'daily',
      '31/08/2030': 'daily_and_monthly',
    };
    for (let d = 23; d <= 30; d++) expected[`${d}/08/2030`] = 'daily';
    for (const md of ['31/01', '28/02', '31/03', '30/04', '31/05', '30/06', '31/07']) {
      expected[`${md}/2030`] = 'monthly';
    }
    expect(keptByDate(r.keep)).toEqual(expected);
    expect(r.keep.size).toBe(21);
    expect(r.keep.get(nightly(2030, 9, 14, 10, 2))).toBe('daily');
  });

  it('D: two copies on 15/09 (a 02:05 catch-up, then 02:30): only 02:30 is kept', () => {
    const files = [
      ...dailies([2030, 9, 2], [2030, 9, 14]),
      nightly(2030, 9, 15, 2, 5),
      nightly(2030, 9, 15),
    ];
    const r = retain(files, 'nightly', refAt(2030, 9, 15));
    expect(r.keep.has(nightly(2030, 9, 15))).toBe(true);
    expect(r.keep.has(nightly(2030, 9, 15, 2, 5))).toBe(false);
    expect(r.remove).toEqual([nightly(2030, 9, 15, 2, 5)]);
  });

  it('E: the first nightly ever is the daily and the month copy', () => {
    const only = nightly(2030, 9, 15);
    const r = retain([only], 'nightly', refAt(2030, 9, 15));
    expect(kept(r.keep)).toEqual({ [only]: 'daily_and_monthly' });
    expect(r.remove).toEqual([]);
  });

  it('keeps the newest copy of a date (same-date duplicates, suffixes)', () => {
    const a = nightly(2030, 9, 15);
    const b = formatBackupName('nightly', new Date(2030, 8, 15, 2, 30), 2);
    const c = nightly(2030, 9, 15, 1, 0);
    const r = retain([a, b, c], 'nightly', refAt(2030, 9, 15));
    expect(kept(r.keep)).toEqual({ [b]: 'daily_and_monthly' });
    expect(r.remove).toEqual([c, a]);
  });

  it('spans the year end in the month window', () => {
    // Month-ends from 31/01/2030 to 31/12/2030 and dailies 01/01/2031 → 20/01/2031.
    const monthEnds = Array.from({ length: 12 }, (_, i) =>
      nightly(2030, i + 1, new Date(2030, i + 1, 0).getDate()),
    );
    const files = [...monthEnds, ...dailies([2031, 1, 1], [2031, 1, 20])];
    const r = retain(files, 'nightly', refAt(2031, 1, 20));
    // Window: Feb 2030 → Jan 2031. January 2030 falls out.
    expect(r.keep.has(nightly(2030, 1, 31))).toBe(false);
    expect(r.keep.get(nightly(2030, 2, 28))).toBe('monthly');
    expect(r.keep.get(nightly(2030, 12, 31))).toBe('monthly');
    expect(r.keep.get(nightly(2031, 1, 20))).toBe('daily_and_monthly');
    expect(r.keep.get(nightly(2031, 1, 7))).toBe('daily');
    expect(r.keep.has(nightly(2031, 1, 6))).toBe(false);
    expect(r.keep.size).toBe(14 + 11);
  });

  it('keeps a leap-year February month-end', () => {
    const files = dailies([2032, 1, 1], [2032, 3, 20]);
    const r = retain(files, 'nightly', refAt(2032, 3, 20));
    expect(r.keep.get(nightly(2032, 2, 29))).toBe('monthly');
    expect(r.keep.has(nightly(2032, 2, 28))).toBe(false);
  });

  it('never removes or counts a file dated next year (future)', () => {
    const next = nightly(2031, 9, 15);
    const files = [...dailies([2030, 9, 1], [2030, 9, 15]), next];
    const r = retain(files, 'nightly', refAt(2030, 9, 15));
    expect(r.future).toEqual([next]);
    expect(r.keep.has(next)).toBe(false);
    expect(r.remove).not.toContain(next);
    // It does not take a daily slot: the 14 newest real dates are kept.
    expect(r.keep.get(nightly(2030, 9, 2))).toBe('daily');
    expect(r.remove).toEqual([nightly(2030, 9, 1)]);
  });

  it('gives the same result under TZ=UTC (grouping by the name)', () => {
    const files = [
      ...dailies([2030, 1, 1], [2030, 9, 3]),
      nightly(2030, 9, 14, 10, 2),
      nightly(2030, 9, 15),
    ];
    const ref = refAt(2030, 9, 15);
    const melbourne = retain(files, 'nightly', ref);
    process.env.TZ = 'UTC';
    const utc = retain(files, 'nightly', ref);
    expect(kept(utc.keep)).toEqual(kept(melbourne.keep));
    expect(utc.remove).toEqual(melbourne.remove);
  });
});

describe('retain: the other kinds', () => {
  it.each(Object.entries(BACKUP_KEEP_BY_KIND))(
    'keeps the newest %s copies by count',
    (kind, keep) => {
      const k = kind as Exclude<BackupKind, 'nightly'>;
      const files = Array.from({ length: keep + 3 }, (_, i) =>
        formatBackupName(k, new Date(2030, 0, 1 + i, 12, 0)),
      );
      const r = retain(files, k, refAt(2030, 6, 1));
      expect(r.keep.size).toBe(keep);
      expect([...r.keep.values()].every((v) => v === 'recent')).toBe(true);
      expect(r.remove).toEqual(files.slice(0, 3));
    },
  );

  it('prunes the legacy offset-less pre-import names with the new ones', () => {
    const legacy = ['pre-import-20290101-120000.db', 'pre-import-20290101-120000-2.db'];
    const current = Array.from({ length: 10 }, (_, i) =>
      formatBackupName('pre-import', new Date(2030, 0, 1 + i, 12, 0)),
    );
    const r = retain([...legacy, ...current], 'pre-import', refAt(2030, 6, 1));
    expect(r.remove).toEqual(legacy);
  });

  it('never touches another kind, a foreign file or a folder-like name', () => {
    const files = [
      'manual-copy.db',
      'x.db',
      'pre-stage7-2030-09-15',
      '.nightly-20300915-023000+1000.db.partial',
      nightly(2020, 1, 1),
      formatBackupName('manual', new Date(2020, 0, 1)),
      ...Array.from({ length: 12 }, (_, i) =>
        formatBackupName('pre-restore', new Date(2030, 0, 1 + i)),
      ),
    ];
    const r = retain(files, 'pre-restore', refAt(2030, 6, 1));
    expect(r.remove).toHaveLength(7);
    for (const name of r.remove) expect(name.startsWith('pre-restore-')).toBe(true);
  });

  it('reports a future copy of another kind and never removes it', () => {
    const future = formatBackupName('manual', new Date(2031, 0, 1));
    const files = [
      future,
      ...Array.from({ length: 11 }, (_, i) => formatBackupName('manual', new Date(2030, 0, 1 + i))),
    ];
    const r = retain(files, 'manual', refAt(2030, 6, 1));
    expect(r.future).toEqual([future]);
    expect(r.keep.size).toBe(10);
    expect(r.remove).toHaveLength(1);
  });
});
