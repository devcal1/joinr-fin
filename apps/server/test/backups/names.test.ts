// Backup file names (stage-7.md §5.2, §5.11): names ⇄ instants for every kind and offset, the
// legacy offset-less pre-import form (the earlier instant in the April repeat hour), suffix order,
// the local date and month taken from the name, the rejected names, the download prefix.
process.env.TZ = 'Australia/Melbourne';

import { BACKUP_KINDS } from '@joinr/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareBackupNames,
  formatBackupName,
  isBackupFileName,
  localIsoWithOffset,
  nextFreeBackupName,
  parseBackupName,
  stripDownloadPrefix,
  type ParsedBackupName,
} from '../../src/backups/names';

const parse = (name: string): ParsedBackupName => {
  const parsed = parseBackupName(name);
  if (parsed === null) throw new Error(`expected ${name} to parse`);
  return parsed;
};

afterEach(() => {
  process.env.TZ = 'Australia/Melbourne';
});

describe('formatBackupName / parseBackupName', () => {
  it('writes every kind with the local time and its offset, and reads it back', () => {
    const summer = new Date(2030, 2, 15, 2, 30, 0); // AEDT
    const winter = new Date(2030, 6, 15, 2, 30, 0); // AEST
    for (const kind of BACKUP_KINDS) {
      const a = formatBackupName(kind, summer);
      expect(a).toBe(`${kind}-20300315-023000+1100.db`);
      expect(parse(a).instant.getTime()).toBe(summer.getTime());
      expect(parse(a).kind).toBe(kind);
      expect(parse(a).createdAt).toBe('2030-03-15T02:30:00+11:00');
      const b = formatBackupName(kind, winter);
      expect(b).toBe(`${kind}-20300715-023000+1000.db`);
      expect(parse(b).instant.toISOString()).toBe('2030-07-14T16:30:00.000Z');
      expect(parse(b).offsetMinutes).toBe(600);
    }
  });

  it('writes a new pre-import name with the offset (§5.2)', () => {
    expect(formatBackupName('pre-import', new Date(2030, 0, 10, 9, 30, 0))).toBe(
      'pre-import-20300110-093000+1100.db',
    );
  });

  it('gives the two 02:30s of the April change different names and instants', () => {
    // 07/04/2030: 03:00 AEDT → 02:00 AEST. The first 02:30 is AEDT (15:30Z), the second AEST.
    const first = new Date(Date.UTC(2030, 3, 6, 15, 30));
    const second = new Date(Date.UTC(2030, 3, 6, 16, 30));
    const a = formatBackupName('nightly', first);
    const b = formatBackupName('nightly', second);
    expect(a).toBe('nightly-20300407-023000+1100.db');
    expect(b).toBe('nightly-20300407-023000+1000.db');
    expect(parse(a).instant.getTime()).toBe(first.getTime());
    expect(parse(b).instant.getTime()).toBe(second.getTime());
    expect(compareBackupNames(parse(a), parse(b))).toBeLessThan(0);
    expect(parse(a).localDate).toBe(parse(b).localDate);
  });

  it('reads offsets that are not the process zone (-0300, +0530)', () => {
    process.env.TZ = 'America/Sao_Paulo';
    const at = new Date(Date.UTC(2030, 5, 1, 12, 0, 0));
    const sp = formatBackupName('manual', at);
    expect(sp).toBe('manual-20300601-090000-0300.db');
    process.env.TZ = 'Asia/Kolkata';
    const ind = formatBackupName('manual', at);
    expect(ind).toBe('manual-20300601-173000+0530.db');
    process.env.TZ = 'Australia/Melbourne';
    // Parsing never depends on the process zone for offset names.
    expect(parse(sp).instant.getTime()).toBe(at.getTime());
    expect(parse(ind).instant.getTime()).toBe(at.getTime());
    expect(parse(sp).createdAt).toBe('2030-06-01T09:00:00-03:00');
    expect(parse(ind).createdAt).toBe('2030-06-01T17:30:00+05:30');
    expect(parse(sp).offsetMinutes).toBe(-180);
    expect(parse(ind).offsetMinutes).toBe(330);
  });

  it('takes the local date and month from the name, not the process zone', () => {
    process.env.TZ = 'UTC';
    const f = parse('nightly-20300301-003000+1100.db'); // 28/02 13:30 UTC
    expect(f.instant.toISOString()).toBe('2030-02-28T13:30:00.000Z');
    expect(f.localDate).toBe('20300301');
    expect(f.localMonth).toBe('203003');
  });

  it('reads the legacy offset-less pre-import form as local time', () => {
    const f = parse('pre-import-20300110-093000.db');
    expect(f.kind).toBe('pre-import');
    expect(f.offsetMinutes).toBeNull();
    expect(f.instant.getTime()).toBe(new Date(2030, 0, 10, 9, 30, 0).getTime());
    expect(f.createdAt).toBe('2030-01-10T09:30:00+11:00');
    // Stage 1 names still parse with a suffix.
    expect(parse('pre-import-20260101-000000-10.db').suffix).toBe(10);
  });

  it('takes the earlier instant for a legacy name in the April repeat hour', () => {
    const f = parse('pre-import-20300407-023000.db');
    expect(f.instant.toISOString()).toBe('2030-04-06T15:30:00.000Z'); // the first 02:30, AEDT
    expect(f.createdAt).toBe('2030-04-07T02:30:00+11:00');
    // A legacy name in the October gap resolves forwards (02:30 does not exist).
    const gap = parse('pre-import-20301006-023000.db');
    expect(gap.createdAt).toBe('2030-10-06T03:30:00+11:00');
  });

  it('orders by instant, then by suffix', () => {
    const names = [
      'manual-20300101-000000+1100-10.db',
      'manual-20300101-000000+1100-2.db',
      'manual-20300101-000000+1100.db',
      'manual-20291231-235959+1100.db',
    ];
    expect(
      names
        .map(parse)
        .sort(compareBackupNames)
        .map((f) => f.name),
    ).toEqual([
      'manual-20291231-235959+1100.db',
      'manual-20300101-000000+1100.db',
      'manual-20300101-000000+1100-2.db',
      'manual-20300101-000000+1100-10.db',
    ]);
  });

  it('finds the next free suffix in the same second', () => {
    const at = new Date(2030, 8, 15, 14, 32, 0);
    const taken = new Set([
      'manual-20300915-143200+1000.db',
      '.manual-20300915-143200+1000-2.db.partial',
    ]);
    expect(nextFreeBackupName('manual', at, (n) => taken.has(n))).toBe(
      'manual-20300915-143200+1000-3.db',
    );
    expect(nextFreeBackupName('manual', at, () => false)).toBe('manual-20300915-143200+1000.db');
    expect(() => nextFreeBackupName('manual', at, () => true)).toThrow();
  });

  it('writes local ISO with the offset', () => {
    expect(localIsoWithOffset(new Date(Date.UTC(2030, 8, 14, 16, 30)))).toBe(
      '2030-09-15T02:30:00+10:00',
    );
  });
});

describe('the name rule', () => {
  it.each([
    'nightly-20300315-023000+1100.db',
    'manual-20300315-023000-0300.db',
    'pre-restore-20300315-023000+0530.db',
    'pre-migrate-20300315-023000+1000-2.db',
    'pre-import-20300315-023000.db',
    'pre-import-20300315-023000+1100.db',
    'pre-import-20300315-023000-999.db',
    'nightly-20300228-023000+1100.db',
    'nightly-20320229-023000+1100.db', // a leap day
  ])('accepts %s', (name) => {
    expect(isBackupFileName(name)).toBe(true);
  });

  it.each([
    '../finance.db',
    '..%2Ffinance.db',
    '%2e%2e%2ffinance.db',
    '..\\finance.db',
    '/data/finance.db',
    'C:\\data\\nightly-20300315-023000+1100.db',
    'backups/nightly-20300315-023000+1100.db',
    'finance.db',
    'finance.db-wal',
    '.nightly-20300315-023000+1100.db.partial',
    'nightly-20300315-023000+1100.db.partial',
    '.finance.db.restoring',
    'NIGHTLY-20300315-023000+1100.db',
    'nightly-20300315-023000+1100.DB',
    'nightly-20300315-023000+1100.db ',
    ' nightly-20300315-023000+1100.db',
    'nightly-20300315-023000+1100-1.db',
    'nightly-20300315-023000+1100-01.db',
    'nightly-20300315-023000+1100-1000.db',
    'nightly-20300315-023000.db', // the offset is optional for pre-import only
    'manual-20300315-023000.db',
    'pre-restore-20300315-023000.db',
    'pre-migrate-20300315-023000.db',
    'weekly-20300315-023000+1100.db',
    'nightly-2030315-023000+1100.db',
    'nightly-20300315-23000+1100.db',
    'nightly-20300315-023000+110.db',
    'nightly-20300315-023000+11:00.db',
    'nightly-20300315-023000+1100.sqlite',
    'nightly-20300315-023000+1100.db\u0000',
    'nightly-20300315-023000+1100\n.db',
    'nightly-20301315-023000+1100.db', // month 13
    'nightly-20300230-023000+1100.db', // 30 February
    'nightly-20310229-023000+1100.db', // not a leap year
    'nightly-20300315-243000+1100.db', // hour 24
    'nightly-20300315-026000+1100.db', // minute 60
    'nightly-20300315-023000+1500.db', // offset beyond ±14:59
    'nightly-20300315-023000+1060.db',
    `nightly-20300315-023000+1100-2${'x'.repeat(60)}.db`,
    '',
  ])('rejects %j', (name) => {
    expect(isBackupFileName(name)).toBe(false);
    expect(parseBackupName(name)).toBeNull();
  });

  it('rejects anything over 64 characters', () => {
    expect('pre-migrate-20300315-023000+1000-999.db'.length).toBeLessThanOrEqual(64);
    expect(parseBackupName(`${'a'.repeat(62)}.db`)).toBeNull();
  });
});

describe('stripDownloadPrefix', () => {
  it('strips the joinr-finance- prefix of a downloaded backup', () => {
    expect(stripDownloadPrefix('joinr-finance-manual-20300915-143200+1000.db')).toBe(
      'manual-20300915-143200+1000.db',
    );
    expect(stripDownloadPrefix('manual-20300915-143200+1000.db')).toBe(
      'manual-20300915-143200+1000.db',
    );
    // Only when the rest is a backup name.
    expect(stripDownloadPrefix('joinr-finance-export.db')).toBe('joinr-finance-export.db');
    expect(stripDownloadPrefix('joinr-finance-../x.db')).toBe('joinr-finance-../x.db');
  });
});
