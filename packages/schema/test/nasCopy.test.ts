// The Stage 8 NAS-copy contract (stage-8.md §3.2–§3.5, §4.1, §4.3, §4.4; D132: no heartbeat): the
// constants, the address rule, the sentences byte-exact, the appended enum and error codes, and
// the fixtures' consistency (states, reasons, sentences, time forms, coverage).
// Planted values only (an obviously fake user, host and module); no real address anywhere.
import { describe, expect, it } from 'vitest';
import * as schema from '../src/index';
import {
  API_ERROR_CODES,
  JOB_NAMES,
  NAS_COPY_CONFIG_REASONS,
  NAS_COPY_CONFIG_STATES,
  NAS_COPY_FAILURE_REASONS,
  NAS_COPY_FIX_FIRST_MESSAGE,
  NAS_COPY_HOUR,
  NAS_COPY_MINUTE,
  NAS_COPY_OFF_MESSAGE,
  NAS_COPY_REFUSAL_REASONS,
  NAS_COPY_RETRYABLE_REASONS,
  NAS_COPY_SAFE_TAIL,
  NAS_COPY_STALE_HOURS,
  NAS_COPY_WEEKDAY,
  NAS_SECRET_FILES,
  NAS_SECRET_MAX_BYTES,
  NAS_SECRETS_DIR,
  checkNasUrl,
  isApiErrorBody,
  nasCopyFailureMessage,
  type NasCopyFailureReason,
  type NasCopyJobDetail,
  type AppStatus,
  type NasCopyStatusDto,
} from '../src/index';
import * as f from '../src/fixtures/index';

describe('NAS-copy constants (§3.2)', () => {
  it('has the Sunday 03:00 schedule and the 8-day stale threshold', () => {
    expect([NAS_COPY_WEEKDAY, NAS_COPY_HOUR, NAS_COPY_MINUTE]).toEqual([0, 3, 0]);
    expect(NAS_COPY_STALE_HOURS).toBe(192);
  });

  it('has exactly two NAS files, both or neither (D132: no heartbeat file)', () => {
    expect(NAS_SECRETS_DIR).toBe('secrets');
    expect(NAS_SECRET_FILES).toEqual({ url: 'nas-url', password: 'nas-password' });
    expect(NAS_SECRET_MAX_BYTES).toBe(4096);
  });

  it('has no heartbeat element anywhere in the root export (D132)', () => {
    for (const key of Object.keys(schema)) expect(key.toLowerCase()).not.toContain('heartbeat');
    expect(JSON.stringify(NAS_SECRET_FILES)).not.toContain('heartbeat');
  });

  it('has the states and the reasons, with the three subsets inside them', () => {
    expect(NAS_COPY_CONFIG_STATES).toEqual(['off', 'partial', 'invalid', 'ready']);
    expect(NAS_COPY_FAILURE_REASONS).toEqual([
      'url_missing',
      'password_missing',
      'url_invalid',
      'password_invalid',
      'auth',
      'unknown_module',
      'refused',
      'unreachable',
      'timeout',
      'broken',
      'nas_io',
      'not_verified',
      'readback_failed',
      'no_rsync',
      'stopped',
      'other',
    ]);
    expect(NAS_COPY_CONFIG_REASONS).toEqual([
      'url_missing',
      'password_missing',
      'url_invalid',
      'password_invalid',
    ]);
    expect(NAS_COPY_RETRYABLE_REASONS).toEqual([
      'unreachable',
      'timeout',
      'broken',
      'nas_io',
      'not_verified',
      'readback_failed',
      'stopped',
      'other',
    ]);
    expect(NAS_COPY_REFUSAL_REASONS).toEqual(['auth', 'unknown_module', 'refused']);
    // A refusal, a configuration failure and no_rsync are never retried.
    for (const r of [...NAS_COPY_REFUSAL_REASONS, ...NAS_COPY_CONFIG_REASONS, 'no_rsync'] as const)
      expect(NAS_COPY_RETRYABLE_REASONS).not.toContain(r);
  });

  it('has the 409 messages and the tail', () => {
    expect(NAS_COPY_SAFE_TAIL).toBe('The backups on the server are not affected.');
    expect(NAS_COPY_OFF_MESSAGE).toBe(
      'The copy to the NAS is not set up: the NAS files are not on the server.',
    );
    expect(NAS_COPY_FIX_FIRST_MESSAGE).toBe(
      "The NAS refused the last copy's password or module. Place the NAS files again with the NAS set-up helper first: repeated refusals could make the NAS block this server.",
    );
  });
});

describe('enums and error codes (§3.4)', () => {
  it("appends the 'nas-copy' job and the two Stage 8 codes", () => {
    expect(JOB_NAMES).toEqual(['prices', 'dividends', 'snapshot', 'backup', 'nas-copy']);
    expect(API_ERROR_CODES.slice(-2)).toEqual(['NAS_COPY_NOT_READY', 'NAS_COPY_FIX_FIRST']);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('has an error body for each Stage 8 code, with the fixed messages', () => {
    const bodies = [f.apiErrors.nasCopyNotReady, f.apiErrors.nasCopyFixFirst];
    for (const body of bodies) expect(isApiErrorBody(body)).toBe(true);
    expect(bodies.map((b) => b.error.code)).toEqual(API_ERROR_CODES.slice(-2));
    expect(f.apiErrors.nasCopyNotReady.error.message).toBe(NAS_COPY_OFF_MESSAGE);
    expect(f.apiErrors.nasCopyFixFirst.error.message).toBe(NAS_COPY_FIX_FIRST_MESSAGE);
  });
});

// ─── The sentences (§4.4) ───────────────────────────────────────────────────────────────────────

const SENTENCES: Record<NasCopyFailureReason, string> = {
  url_missing:
    'The copy to the NAS is half set up: nas-url is missing, so nothing is copied. Run the NAS set-up helper again.',
  password_missing:
    'The copy to the NAS is half set up: nas-password is missing, so nothing is copied. Run the NAS set-up helper again.',
  url_invalid:
    'nas-url is not an rsync://user@host/module address, so nothing is copied. Run the NAS set-up helper again.',
  password_invalid:
    'nas-password is not usable (it must be one line of text), so nothing is copied. Run the NAS set-up helper again.',
  auth: 'The NAS refused the password in nas-password. Check the rsync account on the NAS, then place the password again with the NAS set-up helper (rsync exit code 5).',
  unknown_module:
    'The NAS has no rsync module by the name in nas-url. Check the module on the NAS, then place the address again (rsync exit code 5).',
  refused:
    'The NAS refused the connection, usually because of a wrong password or module name (rsync exit code 5).',
  unreachable:
    'The NAS did not answer. Check it is switched on and reachable over Tailscale (rsync exit code 35).',
  timeout:
    "The copy to the NAS stalled and was stopped. No incomplete file is left under a backup's name on the NAS (rsync exit code 30).",
  broken:
    "The connection to the NAS broke part way through. No incomplete file is left under a backup's name on the NAS (rsync exit code 12).",
  nas_io:
    'The NAS could not store or list the files: it may be full, or the rsync account may not be allowed to read and write the folder (rsync exit code 23).',
  not_verified: 'rsync reported success, but 2 of 7 files are not on the NAS at the right size.',
  readback_failed:
    'The files were sent, but the NAS could not be read back, so the copy is not proved (rsync exit code 23).',
  no_rsync: 'rsync is missing from the app image, so nothing can be copied.',
  stopped: 'The copy was stopped because the app was shutting down.',
  other: 'The copy to the NAS failed (rsync exit code 1).',
};
const CODES: Partial<Record<NasCopyFailureReason, number>> = {
  auth: 5,
  unknown_module: 5,
  refused: 5,
  unreachable: 35,
  timeout: 30,
  broken: 12,
  nas_io: 23,
  readback_failed: 23,
  other: 1,
};

describe('nasCopyFailureMessage (§4.4)', () => {
  it.each(NAS_COPY_FAILURE_REASONS)('%s: byte-exact, followed by the tail', (reason) => {
    const message = nasCopyFailureMessage(reason, { code: CODES[reason], missing: 2, total: 7 });
    expect(message).toBe(`${SENTENCES[reason]} ${NAS_COPY_SAFE_TAIL}`);
  });

  it('omits the parenthesis for a timeout without a code (the 15-minute ceiling)', () => {
    expect(nasCopyFailureMessage('timeout')).toBe(
      `The copy to the NAS stalled and was stopped. No incomplete file is left under a backup's name on the NAS. ${NAS_COPY_SAFE_TAIL}`,
    );
  });

  it('never prints a code where the sentence has none, and only an integer code', () => {
    for (const reason of [...NAS_COPY_CONFIG_REASONS, 'no_rsync', 'stopped'] as const)
      expect(nasCopyFailureMessage(reason, { code: 5 })).not.toContain('exit code');
    for (const code of [Number.NaN, 1.5, -1, Infinity])
      expect(nasCopyFailureMessage('other', { code })).toBe(
        `The copy to the NAS failed. ${NAS_COPY_SAFE_TAIL}`,
      );
    expect(nasCopyFailureMessage('not_verified')).toContain('but 0 of 0 files');
  });

  it('every sentence is distinct and none quotes an address', () => {
    const all = NAS_COPY_FAILURE_REASONS.map((r) => nasCopyFailureMessage(r, { code: 5 }));
    expect(new Set(all).size).toBe(all.length);
    for (const m of all) {
      expect(m.endsWith(NAS_COPY_SAFE_TAIL)).toBe(true);
      expect(m).not.toMatch(/rsync:\/\/[^u]/);
      expect(m.toLowerCase()).not.toContain('heartbeat');
    }
  });
});

// ─── The address rule (§5.3) ────────────────────────────────────────────────────────────────────

const ACCEPTED: Array<[string, string, boolean]> = [
  [
    'rsync://planted-user@planted-host/planted-module',
    'rsync://planted-user@planted-host/planted-module/',
    false,
  ],
  [
    'rsync://planted-user@planted-host/planted-module/',
    'rsync://planted-user@planted-host/planted-module/',
    false,
  ],
  [
    'rsync://planted-user@planted-host/planted-module/sub',
    'rsync://planted-user@planted-host/planted-module/sub/',
    true,
  ],
  [
    'rsync://planted-user@planted-host/planted-module/sub/',
    'rsync://planted-user@planted-host/planted-module/sub/',
    true,
  ],
  ['  rsync://u@h/m  ', 'rsync://u@h/m/', false],
  ['rsync://u@h/m\n', 'rsync://u@h/m/', false],
  ['rsync://u@h/m\r\n', 'rsync://u@h/m/', false],
  ['RSYNC://u@h/m', 'rsync://u@h/m/', false],
  ['rsync://u@h:873/m', 'rsync://u@h:873/m/', false],
  ['rsync://u@h:1/m', 'rsync://u@h:1/m/', false],
  ['rsync://u@h:65535/m', 'rsync://u@h:65535/m/', false],
  ['rsync://u@h:08873/m', 'rsync://u@h:8873/m/', false],
  ['rsync://u@planted-host-2/m', 'rsync://u@planted-host-2/m/', false],
  ['rsync://u@127.0.0.1/m', 'rsync://u@127.0.0.1/m/', false],
  ['rsync://u@[::1]/m', 'rsync://u@[::1]/m/', false],
  ['rsync://u@[::1]:873/m/s', 'rsync://u@[::1]:873/m/s/', true],
  ['rsync://u.name_1-x@h/m.1_x-y', 'rsync://u.name_1-x@h/m.1_x-y/', false],
  ['rsync://%75@h/%6D', 'rsync://u@h/m/', false],
];

const REFUSED: string[] = [
  // Schemes and shape.
  'http://u@h/m',
  'https://u@h/m',
  'ssh://u@h/m',
  'file:///m',
  'rsync:u@h/m',
  'rsync:/u@h/m',
  'u@h::m',
  'h::m',
  'rsync://h/m', // no user
  'rsync://@h/m', // empty user
  'rsync://u@/m', // empty host
  'rsync://u@h', // no module
  'rsync://u@h/', // depth 0
  'rsync://u@h//m',
  'rsync://u@h/m//',
  'rsync://u@h/a/b/c', // depth 3
  'rsync://u@h/a/b/c/',
  // A password, a query, a fragment.
  'rsync://u:pw@h/m',
  'rsync://u:@h/m',
  'rsync://u@h/m?x=1',
  'rsync://u@h/m?',
  'rsync://u@h/m#frag',
  'rsync://u@h/m/#',
  // Whitespace and control characters inside.
  'rsync://u@h/m odule',
  'rsync://u@h/m\todule',
  'rsync://u @h/m',
  'rsync://u@h /m',
  'rsync://u@h/m\n/s',
  'rsync://u@h/m\0',
  // Leading dash or dot, and dot-dot, in each segment.
  'rsync://-u@h/m',
  'rsync://.u@h/m',
  'rsync://u@h/-m',
  'rsync://u@h/.m',
  'rsync://u@h/m/-s',
  'rsync://u@h/m/.s',
  'rsync://u@h/..',
  'rsync://u@h/m/..',
  'rsync://u@h/../m',
  'rsync://u@h/./m',
  'rsync://u@-h/m',
  'rsync://u@.h/m',
  // Percent-encoded separators and dots; malformed escapes (never a throw).
  'rsync://u@h/m%2Fs',
  'rsync://u@h/m%2fs',
  'rsync://u@h/%2E%2E',
  'rsync://u@h/m/%2E%2E',
  'rsync://u@h/m%00',
  'rsync://u%00@h/m',
  'rsync://u%zz@h/m',
  'rsync://u@h/m%E0%A4%A',
  'rsync://u@h/m%',
  'rsync://u%40x@h/m',
  'rsync://u@h%41/m',
  // Ports.
  'rsync://u@h:0/m',
  'rsync://u@h:65536/m',
  'rsync://u@h:99999/m',
  'rsync://u@h:/m',
  'rsync://u@h:x/m',
  // Hosts.
  'rsync://u@[zz]/m',
  'rsync://u@[::1/m',
  'rsync://u@h_x/m',
  'rsync://u@hоst/m', // a Cyrillic look-alike letter
  'rsync://u@h/mоdule',
  'rsync://u@a@h/m',
  // Option-looking and injection-looking text.
  '-e rsync://u@h/m',
  '--rsh=sh rsync://u@h/m',
  'rsync://u@h/m/--delete',
  'rsync://u@h/m;rm',
  'rsync://u@h/m$(x)',
  'rsync://u@h/m`x`',
];

describe('checkNasUrl (§5.3)', () => {
  it(`has at least 40 cases (${ACCEPTED.length + REFUSED.length})`, () => {
    expect(ACCEPTED.length + REFUSED.length).toBeGreaterThanOrEqual(40);
  });

  it.each(ACCEPTED)('accepts %j', (raw, url, hasSubfolder) => {
    expect(checkNasUrl(raw)).toEqual({ ok: true, url, hasSubfolder });
  });

  it.each(REFUSED)('refuses %j without throwing, quoting nothing', (raw) => {
    const result = checkNasUrl(raw);
    expect(result).toEqual({ ok: false, configured: true });
    expect(Object.keys(result).sort()).toEqual(['configured', 'ok']);
  });

  it('treats empty, whitespace-only and non-string input as not configured', () => {
    for (const raw of [
      '',
      '   ',
      '\n',
      '\r\n\t',
      undefined,
      null,
      0,
      1,
      true,
      {},
      [],
      ['rsync://u@h/m'],
    ])
      expect(checkNasUrl(raw)).toEqual({ ok: false, configured: false });
  });

  it('never throws, for hostile objects either', () => {
    const hostile = {
      toString(): string {
        throw new Error('rsync://planted-user@planted-host/planted-module');
      },
    };
    expect(() => checkNasUrl(hostile)).not.toThrow();
    expect(checkNasUrl(hostile)).toEqual({ ok: false, configured: false });
    expect(() => checkNasUrl(`rsync://u@h/${'%'.repeat(10_000)}`)).not.toThrow();
    expect(checkNasUrl(`rsync://u@h/${'a'.repeat(100_000)}`).ok).toBe(true);
  });

  it('always ends the canonical URL with one slash', () => {
    for (const [raw] of ACCEPTED) {
      const r = checkNasUrl(raw);
      expect(r.ok && r.url.endsWith('/') && !r.url.endsWith('//')).toBe(true);
    }
  });
});

// ─── Fixtures (§3.5) ────────────────────────────────────────────────────────────────────────────

const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/** The Melbourne offset (`+10:00` / `+11:00`) of an instant. */
function melbourneOffset(ms: number): string {
  const part = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')!.value;
  return part.replace('GMT', '');
}

/** A local ISO with the offset Melbourne really had at that instant. */
function expectMelbourneLocal(iso: string): void {
  expect(iso).toMatch(LOCAL);
  expect(iso.slice(-6), iso).toBe(melbourneOffset(Date.parse(iso)));
}

const states = Object.entries(f.nasCopyStates) as [f.NasCopyStateFixture, NasCopyStatusDto][];

describe('nasCopyStates', () => {
  it('has every state of §3.5 except the heartbeat ones (D132)', () => {
    expect(Object.keys(f.nasCopyStates).sort()).toEqual(
      [
        'off',
        'partialPassword',
        'partialUrl',
        'invalidUrl',
        'invalidPassword',
        'blocked',
        'readyNever',
        'succeeded',
        'succeededNoOnNas',
        'running',
        'failedUnreachable',
        'notVerified',
        'stale',
        'scheduleOff',
        'stopped',
      ].sort(),
    );
    expect(Object.keys(f.nasCopyFixtureNow).sort()).toEqual(Object.keys(f.nasCopyStates).sort());
    expect(f.NAS_COPY_FIXTURE_TIME_ZONE).toBe(f.BACKUPS_FIXTURE_TIME_ZONE);
  });

  it('carries no heartbeat field and nothing that looks like an address', () => {
    // The url_invalid sentence names the form with placeholder words; nothing else may look like an address.
    const text = JSON.stringify([f.nasCopyStates, f.nasCopyNowResponses, f.appStatusNasCopy])
      .split('rsync://user@host/module')
      .join('');
    expect(text.toLowerCase()).not.toContain('heartbeat');
    expect(text).not.toMatch(/rsync:\/\/[^u]|@[a-z]|planted/);
    for (const [, s] of states)
      expect(Object.keys(s).sort()).toEqual(
        [
          'configured',
          'configReason',
          'missing',
          'blockedUntilFilesChange',
          'schedule',
          'running',
          'lastRun',
          'lastSuccessAt',
          'stale',
        ].sort(),
      );
  });

  for (const [id, s] of states) {
    describe(id, () => {
      const now = Date.parse(f.nasCopyFixtureNow[id]);

      it('keeps configured, configReason, missing and the lock consistent', () => {
        expectMelbourneLocal(f.nasCopyFixtureNow[id]);
        switch (s.configured) {
          case 'off':
          case 'ready':
            expect(s.configReason).toBeNull();
            expect(s.missing).toEqual([]);
            break;
          case 'partial':
            expect(['url_missing', 'password_missing']).toContain(s.configReason);
            expect(s.missing).toEqual([
              s.configReason === 'url_missing' ? 'nas-url' : 'nas-password',
            ]);
            break;
          case 'invalid':
            expect(['url_invalid', 'password_invalid']).toContain(s.configReason);
            expect(s.missing).toEqual([]);
            break;
        }
        if (s.blockedUntilFilesChange) expect(s.configured).toBe('ready');
      });

      it('has the schedule, and nextRunAt only when enabled, ready and unlocked (§5.9)', () => {
        expect(s.schedule).toMatchObject({
          weekday: NAS_COPY_WEEKDAY,
          hour: NAS_COPY_HOUR,
          minute: NAS_COPY_MINUTE,
          timeZone: f.NAS_COPY_FIXTURE_TIME_ZONE,
        });
        const expected =
          s.schedule.enabled && s.configured === 'ready' && !s.blockedUntilFilesChange;
        if (!expected) expect(s.schedule.nextRunAt).toBeNull();
        else {
          expect(s.schedule.nextRunAt).not.toBeNull();
          expectMelbourneLocal(s.schedule.nextRunAt!);
          expect(Date.parse(s.schedule.nextRunAt!)).toBeGreaterThan(now);
        }
      });

      it('uses UTC with milliseconds for the run times and lastSuccessAt (§4)', () => {
        if (s.lastSuccessAt !== null) {
          expect(s.lastSuccessAt).toMatch(UTC_MS);
          expect(Date.parse(s.lastSuccessAt)).toBeLessThanOrEqual(now);
        }
        if (s.lastRun === null) return;
        expect(s.lastRun.startedAt).toMatch(UTC_MS);
        expect(Date.parse(s.lastRun.startedAt)).toBeLessThanOrEqual(now);
        if (s.lastRun.finishedAt !== null) {
          expect(s.lastRun.finishedAt).toMatch(UTC_MS);
          expect(Date.parse(s.lastRun.finishedAt)).toBeGreaterThanOrEqual(
            Date.parse(s.lastRun.startedAt),
          );
        }
      });

      it('keeps running, the last run, its detail and its sentence consistent (§4.3, §4.4)', () => {
        expect(s.running).toBe(s.lastRun?.status === 'running');
        if (s.lastRun === null) return;
        expect(s.lastRun.job).toBe('nas-copy');
        expect(s.lastRun.status).not.toBe('partial');
        const detail = s.lastRun.detail as NasCopyJobDetail | null;
        if (s.lastRun.status === 'running') {
          expect(s.lastRun.finishedAt).toBeNull();
          expect(detail).toBeNull();
          expect(s.lastRun.error).toBeNull();
          return;
        }
        expect(s.lastRun.finishedAt).not.toBeNull();
        if (detail === null) {
          // A row the job did not finish itself (marked `interrupted` after a crash).
          expect(s.lastRun.status).toBe('failed');
          expect(s.lastRun.error).toBe(nasCopyFailureMessage('stopped'));
          return;
        }
        expect(NAS_COPY_CONFIG_STATES).toContain(detail.configured);
        for (const k of [
          'localFiles',
          'alreadyThere',
          'sent',
          'vanished',
          'bytes',
          'durationMs',
        ] as const)
          expect(Number.isInteger(detail[k]) && detail[k] >= 0, k).toBe(true);
        expect(detail.alreadyThere + detail.sent + detail.vanished).toBeLessThanOrEqual(
          detail.localFiles,
        );
        if (detail.onNas !== null) expect(detail.onNas).toBeGreaterThanOrEqual(detail.sent);
        if (detail.slot !== undefined) {
          expectMelbourneLocal(detail.slot);
          expect(detail.slot).toMatch(/T03:00:00\+1[01]:00$/);
          expect(['schedule', 'startup']).toContain(s.lastRun.trigger);
          expect(detail.attempt).toBeGreaterThanOrEqual(1);
          expect(detail.attempt).toBeLessThanOrEqual(4);
        } else {
          expect(detail.attempt).toBeUndefined();
        }
        expect(detail).not.toHaveProperty('heartbeat');
        if (s.lastRun.status === 'succeeded') {
          expect(detail.reason).toBeUndefined();
          expect(detail.exitCode).toBeUndefined();
          expect(detail.attempted).toBe(true);
          expect(detail.missingAfter).toBe(0);
          expect(s.lastRun.error).toBeNull();
          return;
        }
        expect(detail.reason).toBeDefined();
        const reason = detail.reason!;
        expect(NAS_COPY_FAILURE_REASONS).toContain(reason);
        expect(detail.attempted).toBe(!NAS_COPY_CONFIG_REASONS.includes(reason));
        expect(s.lastRun.error).toBe(
          nasCopyFailureMessage(reason, {
            code: detail.exitCode,
            missing: detail.missingAfter ?? undefined,
            total: detail.missingAfter === null ? undefined : detail.sent + detail.missingAfter,
          }),
        );
      });

      it('derives stale from lastSuccessAt (§5.9)', () => {
        if (s.stale) {
          expect(s.schedule.enabled).toBe(true);
          expect(s.configured).toBe('ready');
        }
        if (s.lastSuccessAt !== null) {
          const old = now - Date.parse(s.lastSuccessAt) > NAS_COPY_STALE_HOURS * 3_600_000;
          expect(s.stale).toBe(s.schedule.enabled && s.configured === 'ready' && old);
        } else expect(s.stale).toBe(false);
      });
    });
  }

  it('draws each named state as described', () => {
    const n = f.nasCopyStates;
    expect(n.off).toMatchObject({
      configured: 'off',
      lastRun: null,
      schedule: { nextRunAt: null },
    });
    expect(n.partialPassword).toMatchObject({
      configured: 'partial',
      configReason: 'password_missing',
      missing: ['nas-password'],
    });
    expect(n.invalidUrl.configReason).toBe('url_invalid');
    expect(n.invalidPassword.configReason).toBe('password_invalid');
    // The Copy row comes from configReason: this lastRun is an older success.
    expect(n.invalidPassword.lastRun?.status).toBe('succeeded');
    expect(n.blocked).toMatchObject({
      blockedUntilFilesChange: true,
      schedule: { nextRunAt: null },
      lastRun: { status: 'failed', detail: { reason: 'auth', exitCode: 5 } },
    });
    expect(n.readyNever).toMatchObject({ configured: 'ready', lastRun: null });
    expect(n.readyNever.schedule.nextRunAt).toBe('2030-09-15T03:00:00+10:00');
    expect(n.succeeded.lastRun.detail).toMatchObject({ sent: 5, alreadyThere: 22, onNas: 27 });
    expect(n.succeeded.lastSuccessAt).toBe('2030-09-14T17:00:05.123Z');
    expect(n.succeededNoOnNas.lastRun.detail).toMatchObject({ onNas: null, vanished: 1 });
    expect(n.running).toMatchObject({ running: true, lastRun: { status: 'running' } });
    expect(n.failedUnreachable.lastRun?.detail).toMatchObject({
      reason: 'unreachable',
      attempt: 2,
    });
    // The retry 2 hours after the second attempt finished (§5.9).
    expect(
      Date.parse(n.failedUnreachable.schedule.nextRunAt!) -
        Date.parse(n.failedUnreachable.lastRun.finishedAt!),
    ).toBe(2 * 3_600_000 - 70);
    expect(n.notVerified.lastRun?.error).toContain('1 of 5 files');
    expect(n.stale.stale).toBe(true);
    expect(n.scheduleOff.schedule).toMatchObject({ enabled: false, nextRunAt: null });
    expect(n.stopped.lastRun).toMatchObject({ status: 'failed', detail: null });
  });

  it('covers every configuration state and reason, both lock values and the named failure reasons', () => {
    const c = f.FIXTURE_COVERAGE;
    expect(new Set(c.nasCopyConfigStates)).toEqual(new Set(NAS_COPY_CONFIG_STATES));
    expect(new Set(c.nasCopyConfigReasons)).toEqual(
      new Set([null, 'url_missing', 'password_missing', 'url_invalid', 'password_invalid']),
    );
    expect(new Set(c.nasCopyBlocked)).toEqual(new Set([true, false]));
    for (const r of [
      'password_missing',
      'url_invalid',
      'auth',
      'unreachable',
      'not_verified',
      'stopped',
    ])
      expect(c.nasCopyFailureReasons).toContain(r);
    expect(c).not.toHaveProperty('nasHeartbeatOutcomes');
  });
});

describe('nasCopyNowResponses, the backups pages and the status states', () => {
  it('answers started and joined with the running row', () => {
    const { started, joined } = f.nasCopyNowResponses;
    expect(started.joined).toBe(false);
    expect(joined.joined).toBe(true);
    for (const r of [started, joined]) {
      expect(r.nasCopy.running).toBe(true);
      expect(r.nasCopy.lastRun).toMatchObject({ status: 'running', job: 'nas-copy' });
      expect(Number.isInteger(r.nasCopy.lastRun.id)).toBe(true);
    }
  });

  it('gives every backupsPages state a nasCopy block: off, except nasReady', () => {
    for (const [id, p] of Object.entries(f.backupsPages)) {
      expect(p.nasCopy, id).toBeDefined();
      if (id === 'nasReady') expect(p.nasCopy).toBe(f.nasCopyStates.succeeded);
      else expect(p.nasCopy, id).toBe(f.nasCopyStates.off);
    }
    expect({ ...f.backupsPages.nasReady, nasCopy: null }).toEqual({
      ...f.backupsPages.typical,
      nasCopy: null,
    });
  });

  it('has the /api/status states, lastSuccessAt local with its offset (§3.4)', () => {
    const s = f.appStatusNasCopy;
    expect(Object.keys(s).sort()).toEqual(
      ['ok', 'stale', 'partial', 'invalidPassword', 'blocked'].sort(),
    );
    for (const [id, st] of Object.entries(s)) {
      const n: NonNullable<AppStatus['nasCopy']> = st.nasCopy;
      expect(Object.keys(n).sort(), id).toEqual(
        ['configured', 'configReason', 'blocked', 'stale', 'lastSuccessAt'].sort(),
      );
      if (n.lastSuccessAt !== null) expectMelbourneLocal(n.lastSuccessAt);
      if (n.configured === 'ready' || n.configured === 'off') expect(n.configReason).toBeNull();
      else expect(n.configReason).not.toBeNull();
      if (n.blocked || n.stale) expect(n.configured).toBe('ready');
    }
    expect(s.stale.nasCopy).toMatchObject({
      stale: true,
      lastSuccessAt: '2030-09-15T03:00:05+10:00',
    });
    expect(s.partial.nasCopy.configReason).toBe('password_missing');
    expect(s.invalidPassword.nasCopy.configReason).toBe('password_invalid');
    expect(s.blocked.nasCopy.blocked).toBe(true);
    // The Stage 1 fixtures still compile without the field (it is optional).
    expect(f.appStatusPopulated).not.toHaveProperty('nasCopy');
  });
});
