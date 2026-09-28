// Reading a listing (stage-8.md §5.6, §5.13): real-shaped `--list-only` output, CRLF, the `.`
// line, sub-folders, foreign and hidden files, a 70-character name, a name inside a longer name,
// a symlink to a backup name, a MOTD, device and fifo lines, a duplicate (NaN), a calendar-invalid
// name, and a last line without a newline.
import { describe, expect, it } from 'vitest';
import { LISTING_LINE_RE, parseListing } from '../../src/nascopy/listing';

const N1 = 'nightly-20300915-023000+1000.db';
const N2 = 'manual-20300910-180500+1000.db';
const N3 = 'pre-import-20300901-090000+1000.db';
const LONG = `nightly-20300915-023000+1000${'x'.repeat(39)}.db`;

const REAL = [
  'drwxr-xr-x          4,096 2030/09/15 03:00:05 .',
  `-rw-r--r--      4,200,000 2030/09/15 02:30:01 ${N1}`,
  `-rw-r--r--      4,195,328 2030/09/10 18:05:02 ${N2}`,
  `-rw-------             12 2030/09/01 09:00:00 ${N3}`,
  'drwxr-xr-x          4,096 2030/09/12 10:00:00 older',
  '-rw-r--r--            311 2030/09/12 10:00:00 notes.txt',
  `-rw-------      4,200,000 2030/09/15 02:30:00 .${N1}.Ab12Cd`,
  `-rw-r--r--      4,200,000 2030/09/15 02:30:00 ${LONG}`,
].join('\n');

describe('parseListing (§5.6)', () => {
  it('reads the backup-named regular files of a real-shaped listing', () => {
    expect(parseListing(`${REAL}\n`)).toEqual([
      { name: N1, bytes: 4_200_000 },
      { name: N2, bytes: 4_195_328 },
      { name: N3, bytes: 12 },
    ]);
  });

  it('reads CRLF line ends and a last line without a newline', () => {
    expect(parseListing(REAL.replace(/\n/g, '\r\n'))).toHaveLength(3);
    expect(parseListing(`-rw-r--r-- 1 2030/09/15 02:30:00 ${N1}`)).toEqual([
      { name: N1, bytes: 1 },
    ]);
  });

  it('takes the whole remainder as the name (never the last field)', () => {
    const text = [
      `-rw-r--r--      4,200,000 2030/09/15 02:30:00 copy of ${N1}`,
      `-rw-r--r--      4,200,000 2030/09/15 02:30:00 ${N1} (1)`,
      `-rw-r--r--      4,200,000 2030/09/15 02:30:00 ${N1}.bak`,
    ].join('\n');
    expect(parseListing(text)).toEqual([]);
  });

  it('skips a symlink to a backup name, devices, fifos, sockets and a MOTD block', () => {
    const text = [
      'Welcome to the planted NAS',
      '',
      `  -rw-r--r-- 1 2030/09/15 02:30:00 ${N2}`,
      `lrwxrwxrwx             31 2030/09/15 02:30:00 ${N1}`,
      `crw-r--r--              0 2030/09/15 02:30:00 ${N2}`,
      `prw-r--r--              0 2030/09/15 02:30:00 ${N2}`,
      `srw-r--r--              0 2030/09/15 02:30:00 ${N2}`,
      `brw-r--r--              0 2030/09/15 02:30:00 ${N2}`,
      `drwxr-xr-x          4,096 2030/09/15 02:30:00 ${N3}`,
    ].join('\n');
    expect(parseListing(text)).toEqual([]);
  });

  it('gives a duplicated name the size NaN (sent again and proved)', () => {
    const text = [
      `-rw-r--r--      4,200,000 2030/09/15 02:30:00 ${N1}`,
      `-rw-r--r--      4,200,000 2030/09/15 02:30:00 ${N1}`,
    ].join('\n');
    const files = parseListing(text);
    expect(files).toHaveLength(1);
    expect(files[0]?.bytes).toBeNaN();
  });

  it('ignores a calendar-invalid backup-looking name and a too-long one', () => {
    const text = [
      '-rw-r--r-- 1 2030/09/15 02:30:00 nightly-20300231-023000+1000.db',
      '-rw-r--r-- 1 2030/09/15 02:30:00 nightly-20300915-253000+1000.db',
      '-rw-r--r-- 1 2030/09/15 02:30:00 nightly-20300915-023000+1500.db',
      `-rw-r--r-- 1 2030/09/15 02:30:00 ${LONG}`,
    ].join('\n');
    expect(LONG.length).toBe(70);
    expect(parseListing(text)).toEqual([]);
  });

  it('accepts the extended-attribute marks and setuid/sticky letters of the mode', () => {
    expect(LISTING_LINE_RE.test(`-rw-r--r--. 1 2030/09/15 02:30:00 ${N1}`)).toBe(true);
    expect(LISTING_LINE_RE.test(`-rwsr-sr-t+ 1 2030/09/15 02:30:00 ${N1}`)).toBe(true);
    expect(LISTING_LINE_RE.test(`-rw-r--r-- 1.5 2030/09/15 02:30:00 ${N1}`)).toBe(false);
  });
});
