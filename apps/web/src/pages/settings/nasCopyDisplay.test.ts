// The "Copy to the NAS" block's words (stage-8.md §8.2, §4.5, §8.1; D132: no heartbeat) on every
// `nasCopyStates` fixture: the Copy row from the configuration state, `configReason` and the lock
// (never from the last run's error), the Next row, the §4.5 badge mapping and texts (vanished and
// the NAS count), Last success, the button's availability, the result texts and the frozen follow
// rule. Times in the fixtures' server zone whatever the machine's zone.
import { nasCopyFailureMessage, type JobRunSummary, type NasCopyStatusDto } from '@joinr/schema';
import { nasCopyNowResponses, nasCopyStates } from '@joinr/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NAS_COPY_BLOCKED_TEXT,
  NAS_COPY_OFF_TEXT,
  NAS_COPY_SCHEDULE_OFF_TEXT,
  copyDoneText,
  copyRowView,
  copyStartedText,
  followedCopyDone,
  lastCopyView,
  lastSuccessText,
  nasCopyAvailable,
  nasNextText,
  nasScheduleText,
  succeededText,
  weekdayName,
} from './nasCopyDisplay';

const TZ = nasCopyStates.succeeded.schedule.timeZone;
const savedTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = savedTz;
});

describe('the Copy row (§8.2 item 1)', () => {
  it('ready and on: the weekly line, built from the schedule', () => {
    expect(copyRowView(nasCopyStates.succeeded)).toEqual({
      text: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
      stop: false,
    });
    expect(
      nasScheduleText({ ...nasCopyStates.succeeded.schedule, weekday: 3, hour: 4, minute: 5 }),
    ).toBe('Weekly, Wednesday at 04:05 (Australia/Melbourne)');
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(6)).toBe('Saturday');
    expect(weekdayName(9)).toBe('Sunday');
  });

  it('ready and off in the server settings', () => {
    expect(copyRowView(nasCopyStates.scheduleOff).text).toBe(NAS_COPY_SCHEDULE_OFF_TEXT);
    expect(NAS_COPY_SCHEDULE_OFF_TEXT).toBe(
      'Weekly copy off (turned off in the server settings); Copy to NAS now still works',
    );
    expect(NAS_COPY_SCHEDULE_OFF_TEXT).not.toMatch(/WEEKLY_NAS_COPY/);
  });

  it('off: not set up', () => {
    expect(copyRowView(nasCopyStates.off)).toEqual({ text: NAS_COPY_OFF_TEXT, stop: false });
    expect(NAS_COPY_OFF_TEXT).toBe(
      'Not set up: the NAS files are not on the server. Place them with the NAS set-up helper (see the runbook).',
    );
  });

  it.each([
    ['partialUrl', 'Half set up: nas-url is missing. Nothing is copied.'],
    ['partialPassword', 'Half set up: nas-password is missing. Nothing is copied.'],
    ['invalidUrl', 'The NAS address in nas-url is not usable. Nothing is copied.'],
    ['invalidPassword', 'The password file nas-password is not usable. Nothing is copied.'],
  ] as const)('%s: from configReason', (name, text) => {
    expect(copyRowView(nasCopyStates[name])).toEqual({ text, stop: false });
  });

  it('never from the last run: invalidPassword keeps an older success as its last run', () => {
    expect(nasCopyStates.invalidPassword.lastRun?.status).toBe('succeeded');
    expect(copyRowView(nasCopyStates.invalidPassword).text).toMatch(/nas-password is not usable/);
    // A half-set-up status whose last run failed for another reason still reads configReason.
    const stale: NasCopyStatusDto = {
      ...nasCopyStates.partialPassword,
      configReason: 'url_missing',
      missing: ['nas-url'],
    };
    expect(copyRowView(stale).text).toBe('Half set up: nas-url is missing. Nothing is copied.');
  });

  it('blocked: the stop tint and the helper sentence', () => {
    expect(copyRowView(nasCopyStates.blocked)).toEqual({ text: NAS_COPY_BLOCKED_TEXT, stop: true });
    expect(NAS_COPY_BLOCKED_TEXT).toBe(
      'Stopped: the NAS refused the password or module. Place the NAS files again with the NAS set-up helper first.',
    );
  });
});

describe('availability (§8.2 item 2)', () => {
  it.each(Object.entries(nasCopyStates))('%s', (_name, status) => {
    expect(nasCopyAvailable(status)).toBe(
      status.configured === 'ready' && !status.blockedUntilFilesChange,
    );
  });

  it('blocked, off, partial and invalid are unavailable', () => {
    for (const name of ['blocked', 'off', 'partialUrl', 'partialPassword', 'invalidUrl'] as const) {
      expect(nasCopyAvailable(nasCopyStates[name])).toBe(false);
    }
    expect(nasCopyAvailable(nasCopyStates.succeeded)).toBe(true);
  });
});

describe('Next (only when a run is planned)', () => {
  it('in the server zone whatever the machine zone', () => {
    process.env.TZ = 'UTC';
    expect(nasNextText(nasCopyStates.succeeded.schedule)).toBe('22/09/2030 03:00');
    expect(nasNextText(nasCopyStates.failedUnreachable.schedule)).toBe('15/09/2030 06:00');
    expect(nasNextText(nasCopyStates.stopped.schedule)).toBe('15/09/2030 09:00');
  });

  it('left out when null', () => {
    for (const name of ['off', 'blocked', 'scheduleOff', 'partialPassword'] as const) {
      expect(nasNextText(nasCopyStates[name].schedule)).toBeNull();
    }
  });
});

describe('the last copy (§4.5, frozen)', () => {
  it('none yet', () => {
    expect(lastCopyView(null, TZ)).toBeNull();
  });

  it('succeeded: the go badge and the counts, with the NAS count', () => {
    process.env.TZ = 'America/New_York';
    expect(lastCopyView(nasCopyStates.succeeded.lastRun, TZ)).toEqual({
      status: 'go',
      label: 'Succeeded',
      at: '15/09/2030 03:00',
      text: '5 sent · 22 already there · proved on the NAS · 27 on the NAS',
      error: null,
    });
  });

  it('succeeded with a file removed here first and the NAS count unread', () => {
    expect(lastCopyView(nasCopyStates.succeededNoOnNas.lastRun, TZ)?.text).toBe(
      '6 sent · 20 already there · proved on the NAS · 1 removed here first',
    );
  });

  it('succeededText defaults', () => {
    expect(succeededText(null)).toBe('0 sent · 0 already there · proved on the NAS');
    expect(succeededText({ sent: 2, alreadyThere: 1, vanished: 0, onNas: 0 })).toBe(
      '2 sent · 1 already there · proved on the NAS · 0 on the NAS',
    );
  });

  it('running: the pending badge at its start', () => {
    expect(lastCopyView(nasCopyStates.running.lastRun, TZ)).toEqual({
      status: 'pending',
      label: 'Running',
      at: '15/09/2030 14:40',
      text: null,
      error: null,
    });
  });

  it.each([
    'partialPassword',
    'invalidUrl',
    'blocked',
    'failedUnreachable',
    'notVerified',
    'stale',
    'stopped',
  ] as const)('%s: the failed badge and the run’s sentence', (name) => {
    const run = nasCopyStates[name].lastRun;
    const view = lastCopyView(run, TZ)!;
    expect(view.status).toBe('failed');
    expect(view.label).toBe('Failed');
    expect(view.error).toBe(run.error);
    expect(view.error).toMatch(/The backups on the server are not affected\.$/);
  });

  it('the stopped fixture shows the stopped sentence', () => {
    expect(lastCopyView(nasCopyStates.stopped.lastRun, TZ)?.error).toBe(
      nasCopyFailureMessage('stopped'),
    );
  });

  it('a failed run without an error falls back to the generic sentence', () => {
    const run: JobRunSummary = { ...nasCopyStates.blocked.lastRun, error: null };
    expect(lastCopyView(run, TZ)?.error).toBe(nasCopyFailureMessage('other'));
  });
});

describe('Last success (only after a copy that did not succeed)', () => {
  it('the time, or Never', () => {
    expect(lastSuccessText(nasCopyStates.failedUnreachable)).toBe('08/09/2030 03:00');
    expect(lastSuccessText(nasCopyStates.partialPassword)).toBe('Never');
    expect(lastSuccessText(nasCopyStates.running)).toBe('15/09/2030 03:00');
  });

  it('left out after a success or before any copy', () => {
    expect(lastSuccessText(nasCopyStates.succeeded)).toBeNull();
    expect(lastSuccessText(nasCopyStates.off)).toBeNull();
    expect(lastSuccessText(nasCopyStates.readyNever)).toBeNull();
  });
});

describe('the result texts (§8.2 item 2)', () => {
  it('started and joined', () => {
    expect(copyStartedText(nasCopyNowResponses.started)).toBe('Copy started.');
    expect(copyStartedText(nasCopyNowResponses.joined)).toBe('A copy was already running.');
  });

  it('copied and failed', () => {
    expect(copyDoneText(nasCopyStates.succeeded.lastRun)).toEqual({
      ok: true,
      text: 'Copied: 5 sent, 22 already there.',
      visible: 'Copied: 5 sent, 22 already there.',
    });
    const failed = nasCopyStates.notVerified.lastRun;
    // The sentence is announced whole; on screen it is already in the Last copy row.
    expect(copyDoneText(failed)).toEqual({
      ok: false,
      text: `Copy failed: ${failed.error}`,
      visible: 'Copy failed: see Last copy above.',
    });
  });
});

describe('the follow rule (§8.1, frozen)', () => {
  const followId = nasCopyNowResponses.started.nasCopy.lastRun.id;
  const withRun = (run: JobRunSummary | null): NasCopyStatusDto => ({
    ...nasCopyStates.succeeded,
    lastRun: run,
  });

  it('not done while the followed run is running, or an older run is shown', () => {
    expect(followedCopyDone(nasCopyStates.running, followId)).toBeNull();
    expect(
      followedCopyDone(withRun({ ...nasCopyStates.succeeded.lastRun, id: 1 }), followId),
    ).toBeNull();
    expect(followedCopyDone(withRun(null), followId)).toBeNull();
  });

  it('done when the followed id has finished (the fast path too)', () => {
    const finished = { ...nasCopyStates.succeeded.lastRun, id: followId };
    expect(followedCopyDone(withRun(finished), followId)).toEqual({ run: finished });
    const failed = { ...nasCopyStates.notVerified.lastRun, id: followId };
    expect(followedCopyDone(withRun(failed), followId)).toEqual({ run: failed });
  });

  it('done when a newer id shows', () => {
    const newer = { ...nasCopyStates.succeeded.lastRun, id: followId + 1 };
    expect(followedCopyDone(withRun(newer), followId)).toEqual({ run: newer });
    const running = { ...nasCopyStates.running.lastRun, id: followId + 1 };
    expect(followedCopyDone(withRun(running), followId)).toEqual({ run: null });
  });
});
