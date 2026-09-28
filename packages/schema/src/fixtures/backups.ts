// Backups fixtures (stage-7.md §3.4): typed, generic `GET /api/backups` and `POST /api/backups`
// responses for the Settings Backups and About sections, plus the stale-backup `/api/status` states.
// Literal rows produced by a scratch script that applies the §5.2 name rule and the §5.3 retention
// in `Australia/Melbourne` (offsets +1100 before 03:00 on Sun 07/04/2030, +1000 from then until
// 02:00 on Sun 06/10/2030); test/backups.test.ts re-checks names, order, sums and coverage, and a
// server test re-derives every `keptAs` with the real `retain` at the §4.3 reference instant.
// No drizzle, no sqlite, no node imports: the web's Vitest (jsdom) imports this module.
//
// Common inputs: dates in 2030; the server zone `Australia/Melbourne`; one nightly copy a day at
// 02:30 from 01/01/2030; app version 1.0.0 at database level 6; round sizes.
// Stage 8 (stage-8.md §3.5): every state carries `nasCopy: nasCopyStates.off`; `nasReady` is `typical`
// with the 15/09 NAS copy succeeded.
import { BACKUP_NIGHTLY_HOUR, BACKUP_NIGHTLY_MINUTE, BACKUP_RETENTION } from '../backups';
import type { BackupFileDto, BackupNowResponse, BackupsResponse } from '../dto/backups';
import type { AppStatus } from '../dto/status';
import { nasCopyStates } from './nasCopy';
import { appStatusPopulated } from './sampleDtos';

/** The server zone of every fixture. */
export const BACKUPS_FIXTURE_TIME_ZONE = 'Australia/Melbourne';

const schedule = (nextRunAt: string | null, enabled = true) => ({
  enabled,
  hour: BACKUP_NIGHTLY_HOUR,
  minute: BACKUP_NIGHTLY_MINUTE,
  timeZone: BACKUPS_FIXTURE_TIME_ZONE,
  nextRunAt,
});

const APP = { version: '1.0.0', migrations: 6, restoredFrom: null };

/**
 * §5.3 example A as the folder holds it after the 15/09/2030 02:30 run: the dailies 02/09 → 15/09
 * (15/09 is also September's newest), the month-ends Jan → Aug 2030, two by hand, two before an
 * import (one a legacy Stage 1 name without an offset), one before an update. 27 files.
 */
// prettier-ignore
const TYPICAL_FILES = [
  { name: 'nightly-20300915-023000+1000.db', kind: 'nightly', createdAt: '2030-09-15T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily_and_monthly' },
  { name: 'nightly-20300914-023000+1000.db', kind: 'nightly', createdAt: '2030-09-14T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300913-023000+1000.db', kind: 'nightly', createdAt: '2030-09-13T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300912-023000+1000.db', kind: 'nightly', createdAt: '2030-09-12T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300911-023000+1000.db', kind: 'nightly', createdAt: '2030-09-11T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'manual-20300910-180500+1000.db', kind: 'manual', createdAt: '2030-09-10T18:05:00+10:00', sizeBytes: 4_200_000, keptAs: 'recent' },
  { name: 'nightly-20300910-023000+1000.db', kind: 'nightly', createdAt: '2030-09-10T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300909-023000+1000.db', kind: 'nightly', createdAt: '2030-09-09T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300908-023000+1000.db', kind: 'nightly', createdAt: '2030-09-08T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300907-023000+1000.db', kind: 'nightly', createdAt: '2030-09-07T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300906-023000+1000.db', kind: 'nightly', createdAt: '2030-09-06T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300905-023000+1000.db', kind: 'nightly', createdAt: '2030-09-05T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300904-023000+1000.db', kind: 'nightly', createdAt: '2030-09-04T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300903-023000+1000.db', kind: 'nightly', createdAt: '2030-09-03T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300902-023000+1000.db', kind: 'nightly', createdAt: '2030-09-02T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300831-023000+1000.db', kind: 'nightly', createdAt: '2030-08-31T02:30:00+10:00', sizeBytes: 4_100_000, keptAs: 'monthly' },
  { name: 'manual-20300820-180500+1000.db', kind: 'manual', createdAt: '2030-08-20T18:05:00+10:00', sizeBytes: 4_100_000, keptAs: 'recent' },
  { name: 'nightly-20300731-023000+1000.db', kind: 'nightly', createdAt: '2030-07-31T02:30:00+10:00', sizeBytes: 4_100_000, keptAs: 'monthly' },
  { name: 'nightly-20300630-023000+1000.db', kind: 'nightly', createdAt: '2030-06-30T02:30:00+10:00', sizeBytes: 4_000_000, keptAs: 'monthly' },
  { name: 'pre-migrate-20300601-100000+1000.db', kind: 'pre-migrate', createdAt: '2030-06-01T10:00:00+10:00', sizeBytes: 4_000_000, keptAs: 'recent' },
  { name: 'nightly-20300531-023000+1000.db', kind: 'nightly', createdAt: '2030-05-31T02:30:00+10:00', sizeBytes: 4_000_000, keptAs: 'monthly' },
  { name: 'nightly-20300430-023000+1000.db', kind: 'nightly', createdAt: '2030-04-30T02:30:00+10:00', sizeBytes: 4_000_000, keptAs: 'monthly' },
  { name: 'nightly-20300331-023000+1100.db', kind: 'nightly', createdAt: '2030-03-31T02:30:00+11:00', sizeBytes: 3_800_000, keptAs: 'monthly' },
  { name: 'pre-import-20300301-101500+1100.db', kind: 'pre-import', createdAt: '2030-03-01T10:15:00+11:00', sizeBytes: 3_700_000, keptAs: 'recent' },
  { name: 'nightly-20300228-023000+1100.db', kind: 'nightly', createdAt: '2030-02-28T02:30:00+11:00', sizeBytes: 3_800_000, keptAs: 'monthly' },
  { name: 'nightly-20300131-023000+1100.db', kind: 'nightly', createdAt: '2030-01-31T02:30:00+11:00', sizeBytes: 3_800_000, keptAs: 'monthly' },
  { name: 'pre-import-20300110-093000.db', kind: 'pre-import', createdAt: '2030-01-10T09:30:00+11:00', sizeBytes: 3_600_000, keptAs: 'recent' },
] satisfies BackupFileDto[];

/** The 15/09/2030 02:30 nightly run: succeeded, and pruned the 01/09 copy (no longer among the 14 newest dates, not September's newest). */
const TYPICAL_LAST_RUN = {
  id: 240,
  job: 'backup',
  trigger: 'schedule',
  startedAt: '2030-09-14T16:30:00.000Z',
  finishedAt: '2030-09-14T16:30:01.200Z',
  status: 'succeeded',
  detail: {
    kind: 'nightly',
    name: 'nightly-20300915-023000+1000.db',
    slot: '2030-09-15T02:30:00+10:00',
    sizeBytes: 4_200_000,
    durationMs: 1200,
    verified: true,
    pruned: ['nightly-20300901-023000+1000.db'],
  },
  error: null,
} satisfies BackupsResponse['lastRun'];

const TYPICAL = {
  backups: TYPICAL_FILES,
  totalBytes: 110_000_000,
  freeBytes: 120_000_000_000,
  schedule: schedule('2030-09-16T02:30:00+10:00'),
  running: false,
  lastRun: TYPICAL_LAST_RUN,
  lastBackupAt: '2030-09-15T02:30:00+10:00',
  stale: false,
  retention: BACKUP_RETENTION,
  app: APP,
  nasCopy: nasCopyStates.off,
} satisfies BackupsResponse;

/** A young install whose last three nightly slots failed: dailies 03/09 → 12/09 and the pre-import copy of the first import. */
// prettier-ignore
const LAST_FAILED_FILES = [
  { name: 'nightly-20300912-023000+1000.db', kind: 'nightly', createdAt: '2030-09-12T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily_and_monthly' },
  { name: 'nightly-20300911-023000+1000.db', kind: 'nightly', createdAt: '2030-09-11T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300910-023000+1000.db', kind: 'nightly', createdAt: '2030-09-10T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300909-023000+1000.db', kind: 'nightly', createdAt: '2030-09-09T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300908-023000+1000.db', kind: 'nightly', createdAt: '2030-09-08T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300907-023000+1000.db', kind: 'nightly', createdAt: '2030-09-07T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300906-023000+1000.db', kind: 'nightly', createdAt: '2030-09-06T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300905-023000+1000.db', kind: 'nightly', createdAt: '2030-09-05T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300904-023000+1000.db', kind: 'nightly', createdAt: '2030-09-04T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'nightly-20300903-023000+1000.db', kind: 'nightly', createdAt: '2030-09-03T02:30:00+10:00', sizeBytes: 4_200_000, keptAs: 'daily' },
  { name: 'pre-import-20300902-201500+1000.db', kind: 'pre-import', createdAt: '2030-09-02T20:15:00+10:00', sizeBytes: 4_100_000, keptAs: 'recent' },
] satisfies BackupFileDto[];

/** Backups by hand only, with the schedule turned off in the server settings. */
// prettier-ignore
const SCHEDULE_OFF_FILES = [
  { name: 'manual-20300914-174500+1000.db', kind: 'manual', createdAt: '2030-09-14T17:45:00+10:00', sizeBytes: 4_200_000, keptAs: 'recent' },
  { name: 'manual-20300908-090000+1000.db', kind: 'manual', createdAt: '2030-09-08T09:00:00+10:00', sizeBytes: 4_100_000, keptAs: 'recent' },
  { name: 'manual-20300901-090000+1000.db', kind: 'manual', createdAt: '2030-09-01T09:00:00+10:00', sizeBytes: 4_100_000, keptAs: 'recent' },
  { name: 'pre-import-20300830-200000+1000.db', kind: 'pre-import', createdAt: '2030-08-30T20:00:00+10:00', sizeBytes: 4_000_000, keptAs: 'recent' },
] satisfies BackupFileDto[];

/** The copy the restore CLI took before it restored the 10/09 backup by hand. */
const PRE_RESTORE_FILE = {
  name: 'pre-restore-20300915-105900+1000.db',
  kind: 'pre-restore',
  createdAt: '2030-09-15T10:59:00+10:00',
  sizeBytes: 4_200_000,
  keptAs: 'recent',
} satisfies BackupFileDto;

/** A nightly copy dated a year ahead (taken while the clock was wrong): never pruned, never counted. */
const FUTURE_FILE = {
  name: 'nightly-20310915-023000+1000.db',
  kind: 'nightly',
  createdAt: '2031-09-15T02:30:00+10:00',
  sizeBytes: 4_200_000,
  keptAs: 'future',
} satisfies BackupFileDto;

/** Every state the Backups and About sections draw (§3.4). */
export const backupsPages = {
  /** 27 files (more than the 12 rows shown before "Show all"); the last run succeeded. */
  typical: TYPICAL,
  /** A fresh install started at 10:00 before its first import: no files, the start-up catch-up armed for 10:02. */
  empty: {
    backups: [],
    totalBytes: 0,
    freeBytes: 120_000_000_000,
    schedule: schedule('2030-09-15T10:02:00+10:00'),
    running: false,
    lastRun: null,
    lastBackupAt: null,
    stale: false,
    retention: BACKUP_RETENTION,
    app: APP,
    nasCopy: nasCopyStates.off,
  },
  /** The 16/09 02:30 nightly run in flight (the list is still the 15/09 folder). */
  running: {
    ...TYPICAL,
    schedule: schedule('2030-09-17T02:30:00+10:00'),
    running: true,
    lastRun: {
      id: 241,
      job: 'backup',
      trigger: 'schedule',
      startedAt: '2030-09-15T16:30:00.000Z',
      finishedAt: null,
      status: 'running',
      detail: null,
      error: null,
    },
  },
  /** The third attempt at the 15/09 slot failed for want of space; no copy since 12/09 02:30 → stale. */
  lastFailed: {
    backups: LAST_FAILED_FILES,
    totalBytes: 46_100_000,
    freeBytes: 6_000_000,
    schedule: schedule('2030-09-16T02:30:00+10:00'),
    running: false,
    lastRun: {
      id: 58,
      job: 'backup',
      trigger: 'schedule',
      startedAt: '2030-09-14T17:00:00.000Z',
      finishedAt: '2030-09-14T17:00:00.400Z',
      status: 'failed',
      detail: {
        kind: 'nightly',
        slot: '2030-09-15T02:30:00+10:00',
        reason: 'no_space',
        attempt: 3,
      },
      error: 'Not enough free space on the server',
    },
    lastBackupAt: '2030-09-12T02:30:00+10:00',
    stale: true,
    retention: BACKUP_RETENTION,
    app: APP,
    nasCopy: nasCopyStates.off,
  },
  /** Nothing to back up yet: the 15/09 slot settled without a file. */
  skippedEmpty: {
    backups: [],
    totalBytes: 0,
    freeBytes: 120_000_000_000,
    schedule: schedule('2030-09-16T02:30:00+10:00'),
    running: false,
    lastRun: {
      id: 3,
      job: 'backup',
      trigger: 'schedule',
      startedAt: '2030-09-14T16:30:00.000Z',
      finishedAt: '2030-09-14T16:30:00.050Z',
      status: 'succeeded',
      detail: { kind: 'nightly', slot: '2030-09-15T02:30:00+10:00', skipped: 'empty' },
      error: null,
    },
    lastBackupAt: null,
    stale: false,
    retention: BACKUP_RETENTION,
    app: APP,
    nasCopy: nasCopyStates.off,
  },
  /** The 16/09 02:30 run found an import running: skipped, retried 15 minutes on. */
  skippedImport: {
    ...TYPICAL,
    schedule: schedule('2030-09-16T02:45:00+10:00'),
    lastRun: {
      id: 241,
      job: 'backup',
      trigger: 'schedule',
      startedAt: '2030-09-15T16:30:00.000Z',
      finishedAt: '2030-09-15T16:30:00.020Z',
      status: 'partial',
      detail: { kind: 'nightly', slot: '2030-09-16T02:30:00+10:00', skipped: 'import_in_progress' },
      error: null,
    },
  },
  /** Nightly backups off (the time is kept for the text); backups by hand only. */
  scheduleOff: {
    backups: SCHEDULE_OFF_FILES,
    totalBytes: 16_400_000,
    freeBytes: 120_000_000_000,
    schedule: schedule(null, false),
    running: false,
    lastRun: {
      id: 12,
      job: 'backup',
      trigger: 'manual',
      startedAt: '2030-09-14T07:45:00.000Z',
      finishedAt: '2030-09-14T07:45:01.100Z',
      status: 'succeeded',
      detail: {
        kind: 'manual',
        name: 'manual-20300914-174500+1000.db',
        sizeBytes: 4_200_000,
        durationMs: 1100,
        verified: true,
        pruned: [],
      },
      error: null,
    },
    lastBackupAt: '2030-09-14T17:45:00+10:00',
    stale: false,
    retention: BACKUP_RETENTION,
    app: APP,
    nasCopy: nasCopyStates.off,
  },
  /** The 10/09 backup by hand restored at 11:00 on 15/09: the restored database's own history, the pre-restore copy in the folder. */
  restored: {
    ...TYPICAL,
    backups: [PRE_RESTORE_FILE, ...TYPICAL_FILES],
    totalBytes: 114_200_000,
    lastRun: {
      id: 236,
      job: 'backup',
      trigger: 'manual',
      startedAt: '2030-09-10T08:05:00.000Z',
      finishedAt: '2030-09-10T08:05:01.100Z',
      status: 'succeeded',
      detail: {
        kind: 'manual',
        name: 'manual-20300910-180500+1000.db',
        sizeBytes: 4_200_000,
        durationMs: 1100,
        verified: true,
        pruned: [],
      },
      error: null,
    },
    app: {
      ...APP,
      restoredFrom: { name: 'manual-20300910-180500+1000.db', at: '2030-09-15T11:00:00+10:00' },
    },
  },
  /** The server runs a newer version than the page (the web test sets it relative to `__APP_VERSION__`). */
  versionMismatch: { ...TYPICAL, app: { ...APP, version: '1.0.1' } },
  /** A nightly copy dated next year sits in the folder: listed first, `future`, not counted in lastBackupAt. */
  future: {
    ...TYPICAL,
    backups: [FUTURE_FILE, ...TYPICAL_FILES],
    totalBytes: 114_200_000,
  },
  /** Stage 8: `typical` with the NAS copy set up and the 15/09 copy succeeded. */
  nasReady: { ...TYPICAL, nasCopy: nasCopyStates.succeeded },
} satisfies Record<string, BackupsResponse>;

export type BackupsPageFixture = keyof typeof backupsPages;

/**
 * Each fixture's `now` (server-local ISO): the instant its list and status were taken. The §4.3
 * `keptAs` reference is the newest non-future nightly file's instant, else this.
 */
export const backupsFixtureNow: Record<BackupsPageFixture, string> = {
  typical: '2030-09-15T14:30:00+10:00',
  empty: '2030-09-15T10:00:00+10:00',
  running: '2030-09-16T02:30:05+10:00',
  lastFailed: '2030-09-15T10:00:00+10:00',
  skippedEmpty: '2030-09-15T10:00:00+10:00',
  skippedImport: '2030-09-16T02:30:10+10:00',
  scheduleOff: '2030-09-15T10:00:00+10:00',
  restored: '2030-09-15T11:05:00+10:00',
  versionMismatch: '2030-09-15T14:30:00+10:00',
  future: '2030-09-15T14:30:00+10:00',
  nasReady: '2030-09-15T14:30:00+10:00',
};

/** "Back up now" (§4.2, 201). */
export const backupNowResponses = {
  /** A new copy by hand: "Backup taken: 15/09/2030 14:32, 4.2 MB." */
  created: {
    backup: {
      name: 'manual-20300915-143200+1000.db',
      kind: 'manual',
      createdAt: '2030-09-15T14:32:00+10:00',
      sizeBytes: 4_200_000,
      keptAs: 'recent',
    },
    joined: false,
  },
  /** The click joined the 16/09 02:30 nightly run already in flight. */
  joined: {
    backup: {
      name: 'nightly-20300916-023000+1000.db',
      kind: 'nightly',
      createdAt: '2030-09-16T02:30:00+10:00',
      sizeBytes: 4_200_000,
      keptAs: 'daily_and_monthly',
    },
    joined: true,
  },
} satisfies Record<string, BackupNowResponse>;

/** `/api/status` with the Stage 7 `backups` block (§3.3): fresh, stale since a date, never backed up. */
export const appStatusBackups = {
  fresh: {
    ...appStatusPopulated,
    backups: { stale: false, lastBackupAt: '2030-09-15T02:30:00+10:00' },
  },
  stale: {
    ...appStatusPopulated,
    backups: { stale: true, lastBackupAt: '2030-09-12T02:30:00+10:00' },
  },
  never: {
    ...appStatusPopulated,
    backups: { stale: true, lastBackupAt: null },
  },
} satisfies Record<string, AppStatus>;
