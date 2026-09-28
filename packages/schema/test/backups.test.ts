// The Stage 7 backups contract (stage-7.md §3.2–§3.4, §4.3): the constants, the file-name rule, the
// appended enum and error codes, and the Backups fixtures (names, order, sums, the status rules and
// coverage). The `keptAs` values are re-derived with the server's real `retain` in a server test
// (§8.2 step 7); here they are only checked for shape.
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  BACKUP_DOWNLOAD_PREFIX,
  BACKUP_DUE_SLACK_MS,
  BACKUP_FAILURE_MESSAGES,
  BACKUP_FILE_NAME_MAX,
  BACKUP_FILE_NAME_RE,
  BACKUP_FUTURE_TOLERANCE_MS,
  BACKUP_KEEP_BY_KIND,
  BACKUP_KIND_LABELS,
  BACKUP_KINDS,
  BACKUP_NIGHTLY_HOUR,
  BACKUP_NIGHTLY_MINUTE,
  BACKUP_RETENTION,
  BACKUP_STALE_HOURS,
  JOB_NAMES,
  JOB_STATUSES,
  isApiErrorBody,
  type BackupFailureReason,
  type BackupJobDetail,
  type BackupsResponse,
} from '../src/index';
import * as f from '../src/fixtures/index';

describe('backup constants (§3.2)', () => {
  it('has the five kinds, the 02:30 schedule and the D115 retention', () => {
    expect(BACKUP_KINDS).toEqual(['nightly', 'manual', 'pre-import', 'pre-restore', 'pre-migrate']);
    expect([BACKUP_NIGHTLY_HOUR, BACKUP_NIGHTLY_MINUTE]).toEqual([2, 30]);
    expect(BACKUP_RETENTION).toEqual({
      dailyCopies: 14,
      monthlyMonths: 12,
      manual: 10,
      preImport: 10,
      preRestore: 5,
      preMigrate: 5,
    });
    expect(BACKUP_KEEP_BY_KIND).toEqual({
      manual: 10,
      'pre-import': 10,
      'pre-restore': 5,
      'pre-migrate': 5,
    });
    expect(Object.keys(BACKUP_KEEP_BY_KIND).sort()).toEqual(
      BACKUP_KINDS.filter((k) => k !== 'nightly').sort(),
    );
  });

  it('has the thresholds, the labels and the download prefix', () => {
    expect(BACKUP_STALE_HOURS).toBe(48);
    expect(BACKUP_FUTURE_TOLERANCE_MS).toBe(86_400_000);
    expect(BACKUP_DUE_SLACK_MS).toBe(600_000);
    expect(Object.keys(BACKUP_KIND_LABELS)).toEqual([...BACKUP_KINDS]);
    expect(BACKUP_KIND_LABELS).toEqual({
      nightly: 'Nightly',
      manual: 'By hand',
      'pre-import': 'Before import',
      'pre-restore': 'Before restore',
      'pre-migrate': 'Before update',
    });
    expect(BACKUP_DOWNLOAD_PREFIX).toBe('joinr-finance-');
    expect(BACKUP_FILE_NAME_MAX).toBe(64);
  });

  it('has the three failure messages of §4.1', () => {
    expect(BACKUP_FAILURE_MESSAGES).toEqual({
      no_space: 'Not enough free space on the server',
      verify_failed: 'The copy failed its check',
      io: 'The copy could not be written',
    });
  });
});

describe('enums and error codes (§3.3)', () => {
  it("appends the 'backup' job and the two Stage 7 codes", () => {
    // Stage 8 appends 'nas-copy' and two codes after these (test/nasCopy.test.ts).
    expect(JOB_NAMES.slice(0, 4)).toEqual(['prices', 'dividends', 'snapshot', 'backup']);
    expect(API_ERROR_CODES.slice(-4, -2)).toEqual(['BACKUP_FAILED', 'CROSS_SITE_REQUEST']);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('has an error body for each Stage 7 code', () => {
    const bodies = [f.apiErrors.backupFailed, f.apiErrors.crossSiteRequest];
    for (const body of bodies) expect(isApiErrorBody(body)).toBe(true);
    expect(bodies.map((b) => b.error.code)).toEqual(API_ERROR_CODES.slice(-4, -2));
    expect(Object.values(BACKUP_FAILURE_MESSAGES)).toContain(
      f.apiErrors.backupFailed.error.message,
    );
  });
});

describe('BACKUP_FILE_NAME_RE (§3.2, §5.2)', () => {
  const accepted = [
    'nightly-20300315-023000+1100.db',
    'nightly-20300715-023000+1000.db',
    'manual-20300915-143200+1000.db',
    'pre-restore-20300915-105900+1000.db',
    'pre-migrate-20300601-100000+1000.db',
    'pre-import-20300301-101500+1100.db',
    // The legacy Stage 1 form: no offset, pre-import only.
    'pre-import-20260924-030000.db',
    'nightly-20300315-023000-0300.db',
    'nightly-20300315-023000+0530.db',
    // Collision suffixes: -2 … -9, then -10 … -999.
    'manual-20300915-143200+1000-2.db',
    'manual-20300915-143200+1000-9.db',
    'manual-20300915-143200+1000-10.db',
    'manual-20300915-143200+1000-999.db',
    'pre-import-20260924-030000-2.db',
    'pre-restore-20300915-105900+1000-12.db',
  ];
  const rejected = [
    '',
    'finance.db',
    'finance.db-wal',
    '.nightly-20300315-023000+1100.db.partial',
    '.nightly-20300315-023000+1100.db',
    'nightly-20300315-023000+1100.db.partial',
    'nightly-20300315-023000.db', // an offset is required for every kind but pre-import
    'manual-20300315-023000.db',
    'pre-restore-20300315-023000.db',
    'pre-migrate-20300315-023000.db',
    'Nightly-20300315-023000+1100.db',
    'NIGHTLY-20300315-023000+1100.DB',
    'nightly-20300315-023000+1100.DB',
    'daily-20300315-023000+1100.db',
    'monthly-20300315-023000+1100.db',
    'nightly-2030315-023000+1100.db',
    'nightly-20300315-02300+1100.db',
    'nightly-20300315-023000+110.db',
    'nightly-20300315-023000+11:00.db',
    'nightly-20300315T023000+1100.db',
    'nightly-20300315-023000_1100.db',
    'nightly-20300315-023000+1100-1.db',
    'nightly-20300315-023000+1100-01.db',
    'nightly-20300315-023000+1100-0.db',
    'nightly-20300315-023000+1100-1000.db',
    'nightly-20300315-023000+1100-2',
    'nightly-20300315-023000+1100.sqlite',
    'nightly-20300315-023000+1100.db.db',
    'joinr-finance-nightly-20300315-023000+1100.db',
    '../finance.db',
    '..%2Ffinance.db',
    '%2e%2e%2ffinance.db',
    '..%5cfinance.db',
    '%252e%252e%252ffinance.db',
    '..\\finance.db',
    'backups/nightly-20300315-023000+1100.db',
    '/data/backups/nightly-20300315-023000+1100.db',
    'C:\\data\\nightly-20300315-023000+1100.db',
    './nightly-20300315-023000+1100.db',
    'nightly-20300315-023000+1100.db/',
    'nightly-20300315-023000+1100.db\0',
    'nightly-20300315-023000+1100.db\n',
    '\nnightly-20300315-023000+1100.db',
    ' nightly-20300315-023000+1100.db',
    'nightly-20300315-023000+1100.db ',
    'nightly-20300315-023000%2B1100.db',
    `nightly-20300315-023000+1100${'-2'.repeat(20)}.db`,
    `${'x'.repeat(60)}-20300315-023000+1100.db`,
  ];

  it.each(accepted)('accepts %s', (name) => {
    expect(BACKUP_FILE_NAME_RE.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(BACKUP_FILE_NAME_MAX);
  });

  it(`rejects ${rejected.length} other names`, () => {
    expect(rejected.length).toBeGreaterThanOrEqual(30);
    for (const name of rejected)
      expect(BACKUP_FILE_NAME_RE.test(name), JSON.stringify(name)).toBe(false);
  });

  it('never accepts a name longer than the maximum, a separator or a second dot', () => {
    // The longest form the rule allows is well under the limit.
    expect('pre-restore-20300915-105900+1000-999.db'.length).toBeLessThan(BACKUP_FILE_NAME_MAX);
    for (const name of accepted) {
      expect(name).not.toMatch(/[\\/\0]/);
      expect(name.split('.')).toHaveLength(2);
    }
  });

  it('is stateless (no g or y flag) and a stripped download name matches', () => {
    expect(BACKUP_FILE_NAME_RE.flags).toBe('');
    const download = `${BACKUP_DOWNLOAD_PREFIX}nightly-20300315-023000+1100.db`;
    expect(BACKUP_FILE_NAME_RE.test(download)).toBe(false);
    expect(BACKUP_FILE_NAME_RE.test(download.slice(BACKUP_DOWNLOAD_PREFIX.length))).toBe(true);
  });
});

// ─── Fixtures (§3.4) ─────────────────────────────────────────────────────────────────────────────

const NAME_PARTS =
  /^([a-z-]+?)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})([+-]\d{4})?(?:-\d+)?\.db$/;
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}):(\d{2})$/;
const pages = Object.entries(f.backupsPages) as [f.BackupsPageFixture, BackupsResponse][];

describe('backupsPages', () => {
  it('has every state of §3.4', () => {
    expect(Object.keys(f.backupsPages).sort()).toEqual(
      [
        'typical',
        'empty',
        'running',
        'lastFailed',
        'skippedEmpty',
        'skippedImport',
        'scheduleOff',
        'restored',
        'versionMismatch',
        'future',
        'nasReady',
      ].sort(),
    );
    expect(Object.keys(f.backupsFixtureNow).sort()).toEqual(Object.keys(f.backupsPages).sort());
  });

  for (const [id, p] of pages) {
    describe(id, () => {
      const now = Date.parse(f.backupsFixtureNow[id]);

      it('lists well-formed, unique names whose kind and createdAt come from the name', () => {
        const names = p.backups.map((b) => b.name);
        expect(new Set(names).size).toBe(names.length);
        for (const b of p.backups) {
          expect(BACKUP_FILE_NAME_RE.test(b.name), b.name).toBe(true);
          expect(b.name.length).toBeLessThanOrEqual(BACKUP_FILE_NAME_MAX);
          const m = NAME_PARTS.exec(b.name)!;
          expect(m[1]).toBe(b.kind);
          const c = ISO_LOCAL.exec(b.createdAt)!;
          expect(c, b.createdAt).not.toBeNull();
          expect(c.slice(1, 7)).toEqual(m.slice(2, 8));
          // The offset in the name is the createdAt offset; a legacy name takes Melbourne's.
          const offset = `${c[7]}${c[8]}`;
          if (m[8] !== undefined) expect(m[8]).toBe(offset);
          else {
            expect(b.kind).toBe('pre-import');
            expect(['+1000', '+1100']).toContain(offset);
          }
          expect(Number.isInteger(b.sizeBytes) && b.sizeBytes > 0).toBe(true);
        }
      });

      it('is newest first and sums its sizes', () => {
        const instants = p.backups.map((b) => Date.parse(b.createdAt));
        for (let j = 1; j < instants.length; j++) {
          expect(instants[j]!, p.backups[j]!.name).toBeLessThanOrEqual(instants[j - 1]!);
        }
        expect(p.totalBytes).toBe(p.backups.reduce((s, b) => s + b.sizeBytes, 0));
        if (p.freeBytes !== null) expect(p.freeBytes).toBeGreaterThan(0);
      });

      it('marks only nightly files daily or monthly, and future ones future', () => {
        for (const b of p.backups) {
          const future = Date.parse(b.createdAt) > now + BACKUP_FUTURE_TOLERANCE_MS;
          if (b.kind !== 'nightly') expect(b.keptAs, b.name).toBe('recent');
          else if (future) expect(b.keptAs, b.name).toBe('future');
          else expect(['daily', 'monthly', 'daily_and_monthly'], b.name).toContain(b.keptAs);
        }
        const kept = p.backups.filter((b) => b.kind === 'nightly' && b.keptAs !== 'future');
        const daily = kept.filter((b) => b.keptAs !== 'monthly').map((b) => b.name.slice(8, 16));
        const monthly = kept.filter((b) => b.keptAs !== 'daily').map((b) => b.name.slice(8, 14));
        expect(daily.length).toBeLessThanOrEqual(BACKUP_RETENTION.dailyCopies);
        expect(new Set(daily).size).toBe(daily.length);
        expect(monthly.length).toBeLessThanOrEqual(BACKUP_RETENTION.monthlyMonths);
        expect(new Set(monthly).size).toBe(monthly.length);
        for (const kind of BACKUP_KINDS.filter((k) => k !== 'nightly')) {
          const count = p.backups.filter((b) => b.kind === kind).length;
          expect(count, kind).toBeLessThanOrEqual(BACKUP_KEEP_BY_KIND[kind]);
        }
      });

      it('has the schedule, the retention and the app block', () => {
        expect(p.schedule).toMatchObject({
          hour: BACKUP_NIGHTLY_HOUR,
          minute: BACKUP_NIGHTLY_MINUTE,
          timeZone: f.BACKUPS_FIXTURE_TIME_ZONE,
        });
        if (p.schedule.enabled) {
          expect(p.schedule.nextRunAt).toMatch(ISO_LOCAL);
          expect(Date.parse(p.schedule.nextRunAt!)).toBeGreaterThan(now);
        } else expect(p.schedule.nextRunAt).toBeNull();
        expect(p.retention).toEqual(BACKUP_RETENTION);
        expect(p.app.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
        expect(p.app.migrations).toBe(6);
        if (p.app.restoredFrom) {
          expect(BACKUP_FILE_NAME_RE.test(p.app.restoredFrom.name)).toBe(true);
          expect(p.app.restoredFrom.at).toMatch(ISO_LOCAL);
        }
      });

      it('keeps running, the last run and its detail consistent (§4.3)', () => {
        expect(p.running).toBe(p.lastRun?.status === 'running');
        if (p.lastRun === null) return;
        expect(p.lastRun.job).toBe('backup');
        expect(Date.parse(p.lastRun.startedAt)).toBeLessThanOrEqual(now);
        const detail = p.lastRun.detail as BackupJobDetail | null;
        if (p.lastRun.status === 'running') {
          expect(p.lastRun.finishedAt).toBeNull();
          return;
        }
        expect(p.lastRun.finishedAt).not.toBeNull();
        expect(detail).not.toBeNull();
        expect(BACKUP_KINDS).toContain(detail!.kind);
        if (p.lastRun.status === 'failed') {
          const reason = detail!.reason as BackupFailureReason;
          expect(p.lastRun.error).toBe(BACKUP_FAILURE_MESSAGES[reason]);
        } else expect(p.lastRun.error).toBeNull();
        if (detail!.skipped !== undefined) {
          expect(['succeeded', 'partial']).toContain(p.lastRun.status);
          expect(detail!.name).toBeUndefined();
        }
        if (detail!.name !== undefined) {
          expect(BACKUP_FILE_NAME_RE.test(detail!.name)).toBe(true);
        }
        if (detail!.slot !== undefined) expect(detail!.slot).toMatch(/T02:30:00\+1[01]:00$/);
      });

      it('derives lastBackupAt and stale from the files (§5.4)', () => {
        const fresh = p.backups
          .filter((b) => b.kind === 'nightly' || b.kind === 'manual')
          .filter((b) => b.keptAs !== 'future')
          .map((b) => b.createdAt);
        expect(p.lastBackupAt).toBe(fresh[0] ?? null);
        if (p.lastBackupAt !== null) {
          const old = now - Date.parse(p.lastBackupAt) > BACKUP_STALE_HOURS * 3_600_000;
          expect(p.stale).toBe(p.schedule.enabled && old);
        }
        if (p.stale) expect(p.schedule.enabled).toBe(true);
      });
    });
  }

  it('draws each named state as described', () => {
    const b = f.backupsPages;
    expect(b.typical.backups.length).toBeGreaterThan(12);
    expect(b.empty.backups).toEqual([]);
    expect(b.empty.lastRun).toBeNull();
    expect(b.running.running).toBe(true);
    expect(b.lastFailed).toMatchObject({ stale: true, lastRun: { status: 'failed' } });
    expect(b.skippedEmpty.lastRun.detail.skipped).toBe('empty');
    expect(b.skippedEmpty.backups).toEqual([]);
    expect(b.skippedImport.lastRun).toMatchObject({
      status: 'partial',
      detail: { skipped: 'import_in_progress' },
    });
    // The retry 15 minutes after the skipped run.
    expect(
      Date.parse(b.skippedImport.schedule.nextRunAt!) -
        Date.parse(b.skippedImport.lastRun.startedAt),
    ).toBe(15 * 60_000);
    expect(b.scheduleOff.schedule).toMatchObject({ enabled: false, nextRunAt: null });
    expect(b.restored.app.restoredFrom?.name).toBe('manual-20300910-180500+1000.db');
    expect(b.restored.backups.map((x) => x.name)).toContain(b.restored.app.restoredFrom?.name);
    expect(b.restored.backups.some((x) => x.kind === 'pre-restore')).toBe(true);
    expect(b.versionMismatch.app.version).not.toBe(b.typical.app.version);
    expect(b.future.backups.filter((x) => x.keptAs === 'future')).toHaveLength(1);
    expect(b.future.backups[0]!.keptAs).toBe('future');
    expect(b.future.lastBackupAt).toBe(b.typical.lastBackupAt);
  });

  it('covers every kind, kept-as reason, run status and page skip reason', () => {
    const c = f.FIXTURE_COVERAGE;
    expect(new Set(c.backupKinds)).toEqual(new Set(BACKUP_KINDS));
    expect(new Set(c.backupKeptAs)).toEqual(
      new Set(['daily', 'monthly', 'daily_and_monthly', 'recent', 'future']),
    );
    expect(new Set(c.backupRunStatuses)).toEqual(new Set(JOB_STATUSES));
    expect(new Set(c.backupSkipReasons)).toEqual(new Set(['empty', 'import_in_progress']));
  });
});

describe('backupNowResponses and the status states', () => {
  it('has a new copy by hand and a joined nightly run', () => {
    const { created, joined } = f.backupNowResponses;
    expect(created).toMatchObject({ joined: false, backup: { kind: 'manual', keptAs: 'recent' } });
    expect(joined).toMatchObject({ joined: true, backup: { kind: 'nightly' } });
    for (const r of [created, joined]) expect(BACKUP_FILE_NAME_RE.test(r.backup.name)).toBe(true);
  });

  it('has fresh, stale and never-backed-up /api/status states', () => {
    const s = f.appStatusBackups;
    expect(s.fresh.backups.stale).toBe(false);
    expect(s.fresh.backups.lastBackupAt).toMatch(ISO_LOCAL);
    expect(s.stale.backups.stale).toBe(true);
    expect(s.stale.backups.lastBackupAt).toMatch(ISO_LOCAL);
    expect(s.never.backups).toEqual({ stale: true, lastBackupAt: null });
    // The Stage 1 fixtures still compile without the field (it is optional).
    expect(f.appStatusPopulated).not.toHaveProperty('backups');
  });
});
