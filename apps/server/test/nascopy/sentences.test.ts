// Classifying a refusal and the sentences (stage-8.md §4.4, §5.7, §5.13): the patterns first, the
// exit-code table by phase, stderr planted with the address, the user, the module, the password
// and a path (the reason is right and no sentence carries any of them), every sentence byte-exact
// with the tail, `code` interpolation and the code-less timeout.
import {
  NAS_COPY_FAILURE_REASONS,
  NAS_COPY_SAFE_TAIL,
  nasCopyFailureMessage,
  type NasCopyFailureReason,
} from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  classify,
  listingMeansEmpty,
  sentenceFor,
  type RsyncPhase,
} from '../../src/nascopy/sentences';
import { expectNoLeak, PLANTED, PLANTED_URL } from './helpers';

const HOSTILE = `rsync: ${PLANTED_URL} ${PLANTED.user} ${PLANTED.module} ${PLANTED.password} /data/backups/x.db`;

describe('classify (§5.7)', () => {
  const table: ReadonlyArray<[number, string, Record<RsyncPhase, NasCopyFailureReason>]> = [
    [
      5,
      '@ERROR: auth failed on module m',
      { list: 'auth', send: 'auth', relist: 'readback_failed' },
    ],
    [
      5,
      "@ERROR: Unknown module 'x'",
      { list: 'unknown_module', send: 'unknown_module', relist: 'readback_failed' },
    ],
    [5, '@ERROR: access denied', { list: 'refused', send: 'refused', relist: 'readback_failed' }],
    [35, '', { list: 'unreachable', send: 'unreachable', relist: 'readback_failed' }],
    [10, '', { list: 'unreachable', send: 'broken', relist: 'readback_failed' }],
    [12, '', { list: 'broken', send: 'broken', relist: 'readback_failed' }],
    [30, '', { list: 'timeout', send: 'timeout', relist: 'readback_failed' }],
    [11, '', { list: 'other', send: 'nas_io', relist: 'readback_failed' }],
    [23, '', { list: 'other', send: 'other', relist: 'readback_failed' }],
    [24, '', { list: 'other', send: 'other', relist: 'readback_failed' }],
    [1, '', { list: 'other', send: 'other', relist: 'readback_failed' }],
    [255, '', { list: 'other', send: 'other', relist: 'readback_failed' }],
  ];

  for (const [code, stderr, byPhase] of table) {
    for (const phase of ['list', 'send', 'relist'] as const) {
      it(`${phase} exit ${code} ${JSON.stringify(stderr)} → ${byPhase[phase]}`, () => {
        expect(classify(phase, code, stderr)).toBe(byPhase[phase]);
        // Planted values around the pattern change nothing.
        expect(classify(phase, code, `${HOSTILE}\n${stderr}\n${HOSTILE}`)).toBe(byPhase[phase]);
      });
    }
  }

  it('reads the patterns first: max connections → other, read/write only → nas_io', () => {
    for (const phase of ['list', 'send'] as const) {
      expect(classify(phase, 5, '@ERROR: max connections (4) reached -- try again later')).toBe(
        'other',
      );
      expect(classify(phase, 5, 'ERROR: module is read only')).toBe('nas_io');
      expect(classify(phase, 5, 'ERROR: module is write only')).toBe('nas_io');
      expect(classify(phase, 5, 'auth failed; module is read only')).toBe('nas_io');
    }
    expect(classify('relist', 5, 'ERROR: module is read only')).toBe('readback_failed');
  });

  it('reads a missing subfolder on the first listing as an empty remote', () => {
    const stderr = 'rsync: change_dir "/sub" (in m) failed: No such file or directory (2)';
    expect(listingMeansEmpty(23, stderr, true)).toBe(true);
    expect(listingMeansEmpty(23, stderr, false)).toBe(false);
    expect(listingMeansEmpty(23, 'some other error', true)).toBe(false);
    expect(listingMeansEmpty(5, stderr, true)).toBe(false);
  });
});

describe('the sentences (§4.4)', () => {
  const BODIES: Record<NasCopyFailureReason, string> = {
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
      'The NAS could not store or list the files: it may be full, or the rsync account may not be allowed to read and write the folder (rsync exit code 11).',
    not_verified: 'rsync reported success, but 1 of 7 files are not on the NAS at the right size.',
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
    nas_io: 11,
    readback_failed: 23,
    other: 1,
  };

  it.each(NAS_COPY_FAILURE_REASONS)('%s is byte-exact and ends with the tail', (reason) => {
    const sentence = sentenceFor({
      reason,
      exitCode: CODES[reason],
      sent: reason === 'not_verified' ? 6 : 0,
      missingAfter: reason === 'not_verified' ? 1 : null,
    });
    expect(sentence).toBe(`${BODIES[reason]} ${NAS_COPY_SAFE_TAIL}`);
    expect(sentence.endsWith(NAS_COPY_SAFE_TAIL)).toBe(true);
    expectNoLeak(sentence, 'sentence');
  });

  it('omits the parenthesis for the code-less timeout (the 15-minute ceiling)', () => {
    expect(sentenceFor({ reason: 'timeout' })).toBe(
      `The copy to the NAS stalled and was stopped. No incomplete file is left under a backup's name on the NAS. ${NAS_COPY_SAFE_TAIL}`,
    );
    expect(nasCopyFailureMessage('timeout')).toBe(sentenceFor({ reason: 'timeout' }));
  });
});
