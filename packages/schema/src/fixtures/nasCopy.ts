// NAS-copy fixtures (stage-8.md §3.5; D132: no heartbeat): typed, generic `nasCopy` blocks of
// `GET /api/backups`, the 202 bodies of `POST /api/backups/nas-copy` and the `/api/status`
// `nasCopy` states. No address, account, module or password appears anywhere: the DTOs have no
// field for one.
// No drizzle, no sqlite, no node imports: the web's Vitest (jsdom) imports this module.
//
// Common inputs (the Stage 7 fixtures' year and zone): the server zone `Australia/Melbourne`
// (+10:00 throughout September 2030; daylight saving starts on Sunday 06/10/2030); the reference
// slot is Sunday 15/09/2030 03:00 (= 2030-09-14T17:00Z), the previous one Sunday 08/09/2030 03:00;
// the local set is the Stage 7 `typical` folder (27 files, about 4.2 MB each).
// Time forms (§4): run times and `lastSuccessAt` are UTC with milliseconds and `Z`;
// `schedule.nextRunAt` and `detail.slot` carry the Melbourne offset of their date;
// `appStatusNasCopy.*.nasCopy.lastSuccessAt` is local with the offset (§3.4).
import type { AppStatus } from '../dto/status';
import type { NasCopyJobDetail, NasCopyNowResponse, NasCopyStatusDto } from '../dto/nasCopy';
import type { JobRunSummary } from '../dto/prices';
import {
  NAS_COPY_HOUR,
  NAS_COPY_MINUTE,
  NAS_COPY_WEEKDAY,
  nasCopyFailureMessage,
  type NasCopyFailureReason,
} from '../nasCopy';
import { appStatusPopulated } from './sampleDtos';

/** The server zone of every NAS-copy fixture (the same as the Stage 7 backups fixtures). */
export const NAS_COPY_FIXTURE_TIME_ZONE = 'Australia/Melbourne';

const schedule = (nextRunAt: string | null, enabled = true): NasCopyStatusDto['schedule'] => ({
  enabled,
  weekday: NAS_COPY_WEEKDAY,
  hour: NAS_COPY_HOUR,
  minute: NAS_COPY_MINUTE,
  timeZone: NAS_COPY_FIXTURE_TIME_ZONE,
  nextRunAt,
});

/** The 15/09 slot (local), the next two slots, and the previous week's success (UTC). */
const SLOT = '2030-09-15T03:00:00+10:00';
const PREV_SLOT = '2030-09-08T03:00:00+10:00';
const NEXT_SLOT = '2030-09-22T03:00:00+10:00';
const PREV_SUCCESS_AT = '2030-09-07T17:00:04.500Z';
const THIS_SUCCESS_AT = '2030-09-14T17:00:05.123Z';

/** A failed run's detail before it reached the far side (nothing planned, nothing read). */
const unplanned = (
  configured: NasCopyJobDetail['configured'],
  attempted: boolean,
  reason: NasCopyFailureReason,
  durationMs: number,
  extra: Partial<NasCopyJobDetail> = {},
): NasCopyJobDetail => ({
  configured,
  attempted,
  localFiles: 27,
  alreadyThere: 0,
  sent: 0,
  missingAfter: null,
  vanished: 0,
  onNas: null,
  bytes: 0,
  durationMs,
  reason,
  ...extra,
});

/** A failed `nas-copy` row; `error` is the §4.4 sentence of its detail. */
const failedRun = (
  id: number,
  trigger: JobRunSummary['trigger'],
  startedAt: string,
  finishedAt: string,
  detail: NasCopyJobDetail,
): JobRunSummary => ({
  id,
  job: 'nas-copy',
  trigger,
  startedAt,
  finishedAt,
  status: 'failed',
  detail: { ...detail },
  error: nasCopyFailureMessage(detail.reason!, {
    code: detail.exitCode,
    missing: detail.missingAfter ?? undefined,
    total: detail.missingAfter === null ? undefined : detail.sent + detail.missingAfter,
  }),
});

/** The 08/09 slot's copy: 6 new files sent, 21 already there. */
const PREV_SUCCESS_RUN = {
  id: 11,
  job: 'nas-copy',
  trigger: 'schedule',
  startedAt: '2030-09-07T17:00:00.010Z',
  finishedAt: PREV_SUCCESS_AT,
  status: 'succeeded',
  detail: {
    configured: 'ready',
    attempted: true,
    slot: PREV_SLOT,
    attempt: 1,
    localFiles: 27,
    alreadyThere: 21,
    sent: 6,
    missingAfter: 0,
    vanished: 0,
    onNas: 27,
    bytes: 25_200_000,
    durationMs: 4490,
  } satisfies NasCopyJobDetail,
  error: null,
} satisfies JobRunSummary;

/** The 15/09 slot's copy: 5 sent, 22 already there, 27 on the NAS afterwards. */
const THIS_SUCCESS_RUN = {
  id: 13,
  job: 'nas-copy',
  trigger: 'schedule',
  startedAt: '2030-09-14T17:00:00.012Z',
  finishedAt: THIS_SUCCESS_AT,
  status: 'succeeded',
  detail: {
    configured: 'ready',
    attempted: true,
    slot: SLOT,
    attempt: 1,
    localFiles: 27,
    alreadyThere: 22,
    sent: 5,
    missingAfter: 0,
    vanished: 0,
    onNas: 27,
    bytes: 21_000_000,
    durationMs: 5098,
  } satisfies NasCopyJobDetail,
  error: null,
} satisfies JobRunSummary;

/** "Copy to NAS now" at 14:40 on 15/09, in flight. */
const RUNNING_RUN = {
  id: 15,
  job: 'nas-copy',
  trigger: 'manual',
  startedAt: '2030-09-15T04:40:00.000Z',
  finishedAt: null,
  status: 'running',
  detail: null,
  error: null,
} satisfies JobRunSummary;

/** The status fields every ready, unlocked state shares. */
const ready = (): Pick<
  NasCopyStatusDto,
  'configured' | 'configReason' | 'missing' | 'blockedUntilFilesChange'
> => ({
  configured: 'ready',
  configReason: null,
  missing: [],
  blockedUntilFilesChange: false,
});

/** Every state the "Copy to the NAS" block draws (§3.5, minus the heartbeat states: D132). */
export const nasCopyStates = {
  /** The NAS files are not on the server: silence, no row, no sentence (D126). */
  off: {
    configured: 'off',
    configReason: null,
    missing: [],
    blockedUntilFilesChange: false,
    schedule: schedule(null),
    running: false,
    lastRun: null,
    lastSuccessAt: null,
    stale: false,
  },
  /** Only nas-url was placed: the 15/09 slot recorded one configuration failure (S12). */
  partialPassword: {
    configured: 'partial',
    configReason: 'password_missing',
    missing: ['nas-password'],
    blockedUntilFilesChange: false,
    schedule: schedule(null),
    running: false,
    lastRun: failedRun(
      3,
      'schedule',
      '2030-09-14T17:00:00.008Z',
      '2030-09-14T17:00:00.020Z',
      unplanned('partial', false, 'password_missing', 12, { slot: SLOT, attempt: 1 }),
    ),
    lastSuccessAt: null,
    stale: false,
  },
  /** Only nas-password is there (the helper places both, so a hand edit); no slot has passed since. */
  partialUrl: {
    configured: 'partial',
    configReason: 'url_missing',
    missing: ['nas-url'],
    blockedUntilFilesChange: false,
    schedule: schedule(null),
    running: false,
    lastRun: null,
    lastSuccessAt: null,
    stale: false,
  },
  /** nas-url is not an rsync address (a user:password@ form, say): the slot failed without rsync. */
  invalidUrl: {
    configured: 'invalid',
    configReason: 'url_invalid',
    missing: [],
    blockedUntilFilesChange: false,
    schedule: schedule(null),
    running: false,
    lastRun: failedRun(
      4,
      'schedule',
      '2030-09-14T17:00:00.008Z',
      '2030-09-14T17:00:00.019Z',
      unplanned('invalid', false, 'url_invalid', 11, { slot: SLOT, attempt: 1 }),
    ),
    lastSuccessAt: null,
    stale: false,
  },
  /**
   * The password file was replaced on Wednesday with an unusable one: the Copy row comes from
   * `configReason`, never from `lastRun` (still the 08/09 success).
   */
  invalidPassword: {
    configured: 'invalid',
    configReason: 'password_invalid',
    missing: [],
    blockedUntilFilesChange: false,
    schedule: schedule(null),
    running: false,
    lastRun: PREV_SUCCESS_RUN,
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: false,
  },
  /** The NAS refused the password at the 15/09 slot: the refusal lock holds (S6). */
  blocked: {
    ...ready(),
    blockedUntilFilesChange: true,
    schedule: schedule(null),
    running: false,
    lastRun: failedRun(
      12,
      'schedule',
      '2030-09-14T17:00:00.010Z',
      '2030-09-14T17:00:00.310Z',
      unplanned('ready', true, 'auth', 300, { slot: SLOT, attempt: 1, exitCode: 5 }),
    ),
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: false,
  },
  /** Placed at 02:10 on Sunday 15/09: the timer's armed wake is the 03:00 slot. */
  readyNever: {
    ...ready(),
    schedule: schedule(SLOT),
    running: false,
    lastRun: null,
    lastSuccessAt: null,
    stale: false,
  },
  /** The 15/09 slot's copy succeeded: 5 sent, 22 already there, 27 on the NAS. */
  succeeded: {
    ...ready(),
    schedule: schedule(NEXT_SLOT),
    running: false,
    lastRun: THIS_SUCCESS_RUN,
    lastSuccessAt: THIS_SUCCESS_AT,
    stale: false,
  },
  /** A click at 14:32 succeeded; one intended file was pruned here meanwhile; the NAS count unread. */
  succeededNoOnNas: {
    ...ready(),
    schedule: schedule(NEXT_SLOT),
    running: false,
    lastRun: {
      id: 14,
      job: 'nas-copy',
      trigger: 'manual',
      startedAt: '2030-09-15T04:32:00.000Z',
      finishedAt: '2030-09-15T04:32:04.250Z',
      status: 'succeeded',
      detail: {
        configured: 'ready',
        attempted: true,
        localFiles: 27,
        alreadyThere: 20,
        sent: 6,
        missingAfter: 0,
        vanished: 1,
        onNas: null,
        bytes: 25_200_000,
        durationMs: 4250,
      } satisfies NasCopyJobDetail,
      error: null,
    },
    lastSuccessAt: '2030-09-15T04:32:04.250Z',
    stale: false,
  },
  /** "Copy to NAS now" in flight. */
  running: {
    ...ready(),
    schedule: schedule(NEXT_SLOT),
    running: true,
    lastRun: RUNNING_RUN,
    lastSuccessAt: THIS_SUCCESS_AT,
    stale: false,
  },
  /** The 15/09 slot's second attempt (04:00): the NAS did not answer; the retry is 2 h later. */
  failedUnreachable: {
    ...ready(),
    schedule: schedule('2030-09-15T06:00:10+10:00'),
    running: false,
    lastRun: failedRun(
      16,
      'schedule',
      '2030-09-14T18:00:00.020Z',
      '2030-09-14T18:00:10.070Z',
      unplanned('ready', true, 'unreachable', 10_050, { slot: SLOT, attempt: 2, exitCode: 35 }),
    ),
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: false,
  },
  /** A click on Saturday 14/09: rsync said yes, but 1 of the 5 files is not on the NAS afterwards. */
  notVerified: {
    ...ready(),
    schedule: schedule(SLOT),
    running: false,
    lastRun: failedRun(17, 'manual', '2030-09-14T00:10:00.000Z', '2030-09-14T00:10:04.800Z', {
      configured: 'ready',
      attempted: true,
      localFiles: 27,
      alreadyThere: 22,
      sent: 4,
      missingAfter: 1,
      vanished: 0,
      onNas: 26,
      bytes: 16_800_000,
      durationMs: 4800,
      reason: 'not_verified',
    }),
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: false,
  },
  /** The NAS has been off since Saturday: the 15/09 slot gave up after 4 attempts (S5); 9 days since the last success. */
  stale: {
    ...ready(),
    schedule: schedule(NEXT_SLOT),
    running: false,
    lastRun: failedRun(
      21,
      'schedule',
      '2030-09-15T00:00:00.015Z',
      '2030-09-15T00:00:10.060Z',
      unplanned('ready', true, 'unreachable', 10_045, { slot: SLOT, attempt: 4, exitCode: 35 }),
    ),
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: true,
  },
  /** WEEKLY_NAS_COPY=false: no timer; the last copy was a click. */
  scheduleOff: {
    ...ready(),
    schedule: schedule(null, false),
    running: false,
    lastRun: {
      id: 22,
      job: 'nas-copy',
      trigger: 'manual',
      startedAt: '2030-09-14T07:50:00.000Z',
      finishedAt: '2030-09-14T07:50:03.900Z',
      status: 'succeeded',
      detail: {
        configured: 'ready',
        attempted: true,
        localFiles: 4,
        alreadyThere: 3,
        sent: 1,
        missingAfter: 0,
        vanished: 0,
        onNas: 4,
        bytes: 4_200_000,
        durationMs: 3900,
      } satisfies NasCopyJobDetail,
      error: null,
    },
    lastSuccessAt: '2030-09-14T07:50:03.900Z',
    stale: false,
  },
  /**
   * The 15/09 slot's run was left `running` by a crash and marked `interrupted` at the 08:55
   * restart; the status shows it as the `stopped` sentence. The catch-up is armed for 09:00.
   */
  stopped: {
    ...ready(),
    schedule: schedule('2030-09-15T09:00:00+10:00'),
    running: false,
    lastRun: {
      id: 18,
      job: 'nas-copy',
      trigger: 'schedule',
      startedAt: '2030-09-14T17:00:00.011Z',
      finishedAt: '2030-09-14T22:55:00.000Z',
      status: 'failed',
      detail: null,
      error: nasCopyFailureMessage('stopped'),
    },
    lastSuccessAt: PREV_SUCCESS_AT,
    stale: false,
  },
} satisfies Record<string, NasCopyStatusDto>;

export type NasCopyStateFixture = keyof typeof nasCopyStates;

/** Each fixture's `now` (server-local ISO): the instant its status was taken. */
export const nasCopyFixtureNow: Record<NasCopyStateFixture, string> = {
  off: '2030-09-15T14:30:00+10:00',
  partialPassword: '2030-09-15T09:00:00+10:00',
  partialUrl: '2030-09-16T12:00:00+10:00',
  invalidUrl: '2030-09-15T09:00:00+10:00',
  invalidPassword: '2030-09-11T12:00:00+10:00',
  blocked: '2030-09-15T09:00:00+10:00',
  readyNever: '2030-09-15T02:10:00+10:00',
  succeeded: '2030-09-15T14:30:00+10:00',
  succeededNoOnNas: '2030-09-15T14:35:00+10:00',
  running: '2030-09-15T14:40:01+10:00',
  failedUnreachable: '2030-09-15T04:30:00+10:00',
  notVerified: '2030-09-14T10:15:00+10:00',
  stale: '2030-09-17T03:30:00+10:00',
  scheduleOff: '2030-09-15T10:00:00+10:00',
  stopped: '2030-09-15T08:56:00+10:00',
};

/** "Copy to NAS now" (§4.2, 202): a new copy, and a click that joined the copy in flight. */
export const nasCopyNowResponses = {
  started: { joined: false, nasCopy: nasCopyStates.running },
  joined: { joined: true, nasCopy: nasCopyStates.running },
} satisfies Record<string, NasCopyNowResponse>;

/** `/api/status` with the Stage 8 `nasCopy` block (§3.4); `lastSuccessAt` is local with its offset. */
export const appStatusNasCopy = {
  ok: {
    ...appStatusPopulated,
    nasCopy: {
      configured: 'ready',
      configReason: null,
      blocked: false,
      stale: false,
      lastSuccessAt: '2030-09-15T03:00:05+10:00',
    },
  },
  stale: {
    ...appStatusPopulated,
    nasCopy: {
      configured: 'ready',
      configReason: null,
      blocked: false,
      stale: true,
      lastSuccessAt: '2030-09-15T03:00:05+10:00',
    },
  },
  partial: {
    ...appStatusPopulated,
    nasCopy: {
      configured: 'partial',
      configReason: 'password_missing',
      blocked: false,
      stale: false,
      lastSuccessAt: null,
    },
  },
  invalidPassword: {
    ...appStatusPopulated,
    nasCopy: {
      configured: 'invalid',
      configReason: 'password_invalid',
      blocked: false,
      stale: false,
      lastSuccessAt: '2030-09-08T03:00:04+10:00',
    },
  },
  blocked: {
    ...appStatusPopulated,
    nasCopy: {
      configured: 'ready',
      configReason: null,
      blocked: true,
      stale: false,
      lastSuccessAt: '2030-09-08T03:00:04+10:00',
    },
  },
} satisfies Record<string, AppStatus>;
