// The address rule as the server uses it (stage-8.md §5.3, §5.13; the schema's `checkNasUrl`):
// accepted and refused addresses, the canonical form ending in `/`, `hasSubfolder`, malformed
// escapes that refuse without throwing, and a refusal that carries nothing but `configured`.
// Generic test names only (a host without a dot, §10.0).
import { checkNasUrl } from '@joinr/schema';
import { describe, expect, it } from 'vitest';

const ACCEPTED: ReadonlyArray<[string, string, boolean]> = [
  ['rsync://u@h/m', 'rsync://u@h/m/', false],
  ['rsync://u@h/m/', 'rsync://u@h/m/', false],
  ['rsync://u@h/m/s', 'rsync://u@h/m/s/', true],
  ['rsync://u@h/m/s/', 'rsync://u@h/m/s/', true],
  ['RSYNC://u@h/m', 'rsync://u@h/m/', false],
  ['  rsync://u@h/m  ', 'rsync://u@h/m/', false],
  ['rsync://u@h/m\n', 'rsync://u@h/m/', false],
  ['rsync://u@h:873/m', 'rsync://u@h:873/m/', false],
  ['rsync://u@h:1/m', 'rsync://u@h:1/m/', false],
  ['rsync://u@h:65535/m', 'rsync://u@h:65535/m/', false],
  ['rsync://u@h:0873/m', 'rsync://u@h:873/m/', false],
  ['rsync://u@[::1]/m', 'rsync://u@[::1]/m/', false],
  ['rsync://u@[fd00::1]:873/m/s', 'rsync://u@[fd00::1]:873/m/s/', true],
  ['rsync://user.name@host-name/module_1', 'rsync://user.name@host-name/module_1/', false],
  ['rsync://u-1@nas-box/Back.Ups/week-ly', 'rsync://u-1@nas-box/Back.Ups/week-ly/', true],
  ['rsync://u%41@h/m', 'rsync://uA@h/m/', false],
  ['rsync://u@h/m%5Fx', 'rsync://u@h/m_x/', false],
  ['rsync://u@h/m..x', 'rsync://u@h/m..x/', false],
];

const REFUSED: readonly string[] = [
  'https://u@h/m',
  'http://u@h/m',
  'ssh://u@h/m',
  'file:///m',
  'rsync:/u@h/m',
  'u@h/m',
  'rsync://u:pw@h/m',
  'rsync://u:@h/m',
  'rsync://h/m',
  'rsync://@h/m',
  'rsync://u@h/m?x=1',
  'rsync://u@h/m#f',
  'rsync://u@h/m x',
  'rsync://u@h/m\tx',
  'rsync://u@h /m',
  'rsync://-u@h/m',
  'rsync://.u@h/m',
  'rsync://u@h/-m',
  'rsync://u@h/.m',
  'rsync://u@h/m/-s',
  'rsync://u@h/m/.s',
  'rsync://u@h/..',
  'rsync://u@h/m/..',
  'rsync://u@h/m/%2E%2E',
  'rsync://u@h/m%2Fx',
  'rsync://u@h/m/%2Fs',
  'rsync://u@h',
  'rsync://u@h/',
  'rsync://u@h/m/s/t',
  'rsync://u@h:0/m',
  'rsync://u@h:65536/m',
  'rsync://u@h:x/m',
  'rsync://u@/m',
  'rsync://u@-h/m',
  'rsync://u@h_h/m',
  'rsync://u@[zz]/m',
  'rsync://u%zz@h/m',
  'rsync://u@h/m%E0%A4%A',
  'rsync://u@h/m%00',
  'rsync://u%00@h/m',
  'rsync://u@h//m',
  'rsync://u@h/m//s',
  'rsync://u@h/m/--delete',
  'rsync://u@h/-e',
  'rsync://u@h/mс',
];

describe('checkNasUrl (§5.3)', () => {
  it('has at least 40 cases', () => {
    expect(ACCEPTED.length + REFUSED.length).toBeGreaterThanOrEqual(40);
  });

  it.each(ACCEPTED)('accepts %j → %s', (raw, url, hasSubfolder) => {
    expect(checkNasUrl(raw)).toEqual({ ok: true, url, hasSubfolder });
  });

  it.each(REFUSED)('refuses %j without throwing, with only `ok` and `configured`', (raw) => {
    let result: ReturnType<typeof checkNasUrl> | undefined;
    expect(() => {
      result = checkNasUrl(raw);
    }).not.toThrow();
    expect(result).toEqual({ ok: false, configured: true });
    expect(Object.keys(result ?? {}).sort()).toEqual(['configured', 'ok']);
  });

  it('answers configured false for nothing, whitespace or a non-string', () => {
    for (const raw of ['', '   ', '\n', null, undefined, 42, {}, ['rsync://u@h/m']]) {
      expect(checkNasUrl(raw)).toEqual({ ok: false, configured: false });
    }
  });

  it('never quotes the value in a refusal', () => {
    const refused = checkNasUrl(
      'rsync://planted-user:planted-password@planted-host/planted-module',
    );
    expect(JSON.stringify(refused)).not.toMatch(/planted/);
  });
});
