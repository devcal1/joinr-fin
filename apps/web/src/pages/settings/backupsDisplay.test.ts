// The Backups and About words and formats (stage-7.md §6.2, §6.3, §4.3's frozen badge mapping): every
// time in the server's zone whatever the machine's zone, the schedule and "Next" lines, the last-run
// view for each fixture, the space and retention lines from the numbers given, the Monthly pill
// rule, the encoded download link, the result and empty texts, and the version note.
import {
  BACKUP_RETENTION,
  BACKUP_FAILURE_MESSAGES,
  type BackupFileDto,
  type JobRunSummary,
} from '@joinr/schema';
import {
  BACKUPS_FIXTURE_TIME_ZONE,
  backupNowResponses,
  backupsPages,
} from '@joinr/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUPS_SHOWN,
  backupNowText,
  downloadHref,
  downloadLabel,
  emptyText,
  formatServerDateTime,
  formatSpace,
  lastRunView,
  nextRunText,
  restoredText,
  retentionText,
  scheduleText,
  scheduleTime,
  serverMonth,
  showAllText,
  showsMonthlyPill,
  spaceText,
  versionMismatchText,
} from './backupsDisplay';

const TZ = BACKUPS_FIXTURE_TIME_ZONE;
const savedTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = savedTz;
});

describe('formatServerDateTime (§6.2 "Times")', () => {
  it.each([
    ['2030-09-15T02:30:00+10:00', '15/09/2030 02:30'],
    ['2030-03-31T02:30:00+11:00', '31/03/2030 02:30'],
    // 16:30Z on 14/09 is 02:30 on 15/09 in Melbourne (AEST).
    ['2030-09-14T16:30:00.000Z', '15/09/2030 02:30'],
    // Midnight is 00, never 24.
    ['2030-09-15T00:05:00+10:00', '15/09/2030 00:05'],
  ])('%s → %s in Australia/Melbourne', (iso, text) => {
    expect(formatServerDateTime(iso, TZ)).toBe(text);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Kolkata'])(
    'gives the server-zone time whatever the machine zone (%s)',
    (machine) => {
      process.env.TZ = machine;
      expect(formatServerDateTime('2030-09-15T02:30:00+10:00', TZ)).toBe('15/09/2030 02:30');
      expect(formatServerDateTime('2030-01-10T09:30:00+11:00', TZ)).toBe('10/01/2030 09:30');
    },
  );

  it('falls back to the browser zone for an unknown zone name', () => {
    process.env.TZ = 'UTC';
    expect(formatServerDateTime('2030-09-15T02:30:00+10:00', 'Not/AZone')).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });

  it('shows a dash for a missing or unparseable time', () => {
    expect(formatServerDateTime(null, TZ)).toBe('—');
    expect(formatServerDateTime('not a date', TZ)).toBe('—');
  });

  it('gives the server month for the Monthly pill', () => {
    expect(serverMonth(new Date('2030-08-31T16:30:00Z'), TZ)).toBe('2030-09');
    expect(serverMonth(new Date('2030-08-31T13:00:00Z'), TZ)).toBe('2030-08');
  });
});

describe('the schedule line and Next (§6.2 item 1)', () => {
  it('reads the time and the zone from the schedule', () => {
    expect(scheduleText(backupsPages.typical.schedule)).toBe(
      'Nightly at 02:30 (Australia/Melbourne)',
    );
    expect(
      scheduleText({ ...backupsPages.typical.schedule, hour: 3, minute: 5, timeZone: 'UTC' }),
    ).toBe('Nightly at 03:05 (UTC)');
    expect(scheduleTime({ hour: 2, minute: 30 })).toBe('02:30');
  });

  it('keeps the time when the schedule is off, without a variable name', () => {
    const text = scheduleText(backupsPages.scheduleOff.schedule);
    expect(text).toBe(
      'Off (turned off in the server settings); would run at 02:30 (Australia/Melbourne)',
    );
    expect(text).not.toMatch(/NIGHTLY_BACKUPS/);
  });

  it('Next is the actual next run: a slot, a retry or the start-up catch-up', () => {
    expect(nextRunText(backupsPages.typical.schedule)).toBe('16/09/2030 02:30');
    expect(nextRunText(backupsPages.skippedImport.schedule)).toBe('16/09/2030 02:45');
    expect(nextRunText(backupsPages.empty.schedule)).toBe('15/09/2030 10:02');
    expect(nextRunText(backupsPages.scheduleOff.schedule)).toBe('Not scheduled');
  });
});

describe('lastRunView: the frozen §4.3 mapping', () => {
  it.each([
    ['typical', 'go', 'Succeeded', null, null, '15/09/2030 02:30'],
    ['running', 'pending', 'Running', null, null, '16/09/2030 02:30'],
    ['lastFailed', 'failed', 'Failed', null, BACKUP_FAILURE_MESSAGES.no_space, '15/09/2030 03:00'],
    ['skippedEmpty', 'pending', 'Skipped', 'nothing to back up yet', null, '15/09/2030 02:30'],
    ['skippedImport', 'pending', 'Skipped', 'an import was running', null, '16/09/2030 02:30'],
    ['scheduleOff', 'go', 'Succeeded', null, null, '14/09/2030 17:45'],
  ] as const)('%s → %s "%s"', (fixture, status, label, reason, error, at) => {
    const page = backupsPages[fixture];
    expect(lastRunView(page.lastRun, page.schedule.timeZone)).toEqual({
      status,
      label,
      reason,
      error,
      at,
    });
  });

  it('is null before any run', () => {
    expect(lastRunView(null, TZ)).toBeNull();
  });

  it('never shows raw error text: a failed run shows its category message', () => {
    for (const message of Object.values(BACKUP_FAILURE_MESSAGES)) {
      const run: JobRunSummary = { ...backupsPages.lastFailed.lastRun, error: message };
      expect(lastRunView(run, TZ)?.error).toBe(message);
    }
  });
});

describe('space and retention (§6.2 items 1–2)', () => {
  it('writes the space used, the count and the free space', () => {
    const t = backupsPages.typical;
    expect(spaceText(t.totalBytes, t.backups.length, t.freeBytes)).toBe(
      '110.0 MB in 27 backups · 120.0 GB free on the server',
    );
    expect(spaceText(4_200_000, 1, null)).toBe('4.2 MB in 1 backup');
    expect(spaceText(0, 0, 6_000_000)).toBe('0 B in 0 backups · 6.0 MB free on the server');
    expect(formatSpace(2_500_000_000_000)).toBe('2.5 TB');
  });

  it('builds the retention line from the numbers (never hard-coded)', () => {
    expect(retentionText(BACKUP_RETENTION)).toBe(
      'Keeps the newest nightly copy of each of the last 14 days it ran and of each of the last 12 months, plus the newest 10 by hand, 10 before an import, 5 before a restore and 5 before an update.',
    );
    expect(
      retentionText({
        dailyCopies: 7,
        monthlyMonths: 6,
        manual: 3,
        preImport: 4,
        preRestore: 2,
        preMigrate: 1,
      } as unknown as typeof BACKUP_RETENTION),
    ).toBe(
      'Keeps the newest nightly copy of each of the last 7 days it ran and of each of the last 6 months, plus the newest 3 by hand, 4 before an import, 2 before a restore and 1 before an update.',
    );
  });
});

describe('the Monthly pill (§6.2 item 5)', () => {
  const file = (keptAs: BackupFileDto['keptAs'], createdAt: string): BackupFileDto => ({
    name: 'nightly-20300915-023000+1000.db',
    kind: 'nightly',
    createdAt,
    sizeBytes: 1,
    keptAs,
  });

  it('shows on a month-end copy and on an earlier month’s daily-and-monthly copy', () => {
    expect(showsMonthlyPill(file('monthly', '2030-08-31T02:30:00+10:00'), '2030-09')).toBe(true);
    expect(
      showsMonthlyPill(file('daily_and_monthly', '2030-08-31T02:30:00+10:00'), '2030-09'),
    ).toBe(true);
  });

  it('does not show on this month’s newest copy, a daily, a recent or a future file', () => {
    expect(
      showsMonthlyPill(file('daily_and_monthly', '2030-09-15T02:30:00+10:00'), '2030-09'),
    ).toBe(false);
    expect(showsMonthlyPill(file('daily', '2030-09-10T02:30:00+10:00'), '2030-09')).toBe(false);
    expect(showsMonthlyPill(file('recent', '2030-06-10T02:30:00+10:00'), '2030-09')).toBe(false);
    expect(showsMonthlyPill(file('future', '2031-09-15T02:30:00+10:00'), '2030-09')).toBe(false);
  });
});

describe('downloads, results and the empty table', () => {
  it('encodes the name in the link (the offset’s + becomes %2B)', () => {
    expect(downloadHref('nightly-20300915-023000+1000.db')).toBe(
      '/api/backups/nightly-20300915-023000%2B1000.db',
    );
    expect(downloadHref('pre-import-20300110-093000.db')).toBe(
      '/api/backups/pre-import-20300110-093000.db',
    );
    expect(downloadLabel(backupsPages.typical.backups[0]!, TZ)).toBe(
      'Download the backup of 15/09/2030 02:30:00',
    );
  });

  it('writes the result of "Back up now"', () => {
    expect(backupNowText(backupNowResponses.created, TZ)).toBe(
      'Backup taken: 15/09/2030 14:32, 4.2 MB.',
    );
    expect(backupNowText(backupNowResponses.joined, TZ)).toBe(
      'A backup was already running; it finished: 16/09/2030 02:30, 4.2 MB.',
    );
  });

  it('writes the empty texts', () => {
    expect(emptyText(backupsPages.empty.schedule)).toBe(
      'No backups yet. The first nightly backup runs at 02:30.',
    );
    expect(emptyText(backupsPages.scheduleOff.schedule)).toBe(
      'No backups yet. Nightly backups are off.',
    );
  });

  it('names the disclosure', () => {
    expect(BACKUPS_SHOWN).toBe(12);
    expect(showAllText(false, 27)).toBe('Show all 27 backups');
    expect(showAllText(true, 27)).toBe('Show the newest 12');
  });
});

describe('About (§6.3)', () => {
  it('notes a version mismatch only', () => {
    expect(versionMismatchText('1.0.0', '1.0.0')).toBeNull();
    expect(versionMismatchText('1.0.0', '1.0.1')).toBe(
      'This page is from v1.0.0; the server runs v1.0.1. Reload to get the new version.',
    );
  });

  it('writes the restored line in the server zone', () => {
    const restored = backupsPages.restored.app.restoredFrom;
    expect(restoredText(restored, TZ)).toBe(
      'from manual-20300910-180500+1000.db on 15/09/2030 11:00',
    );
  });
});
