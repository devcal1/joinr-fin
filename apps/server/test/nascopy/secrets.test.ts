// The NAS files and the configuration state (stage-8.md §5.2, §5.13): absent, empty,
// whitespace-only, CRLF, two lines, oversize, a symlink, a folder, a NUL or tab in the password,
// an unusable address → off / partial / invalid / ready with `configReason` and `missing`; a change
// between two reads is picked up; the mtimes; an unreadable folder counts as absent and warns once
// per change of its error code.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAS_SECRET_MAX_BYTES } from '@joinr/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretsReader, firstLine, type LstatFn } from '../../src/nascopy/secrets';
import { decideConfiguration } from '../../src/nascopy/status';
import { recordingLogger } from '../backups/helpers';
import { makeTempDir, removeDir } from '../helpers';
import {
  passwordFile,
  PLANTED,
  PLANTED_URL,
  plantNasFiles,
  secretsDir,
  urlFile,
  writeSecret,
} from './helpers';

const canSymlink = ((): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), 'x');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
if (!canSymlink) {
  console.warn(
    'secrets.test: symlinks are not permitted here (Windows without Developer Mode); the symlink case is skipped. It runs on Linux.',
  );
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await makeTempDir('joinr-nas-secrets-test-');
});

afterEach(async () => {
  try {
    chmodSync(secretsDir(dataDir), 0o700);
  } catch {
    // No folder.
  }
  await removeDir(dataDir);
});

const stateOf = (dir = dataDir) =>
  decideConfiguration(createSecretsReader({ dataDir: dir }).read());

describe('firstLine', () => {
  it.each([
    ['abc', 'abc'],
    ['abc\n', 'abc'],
    ['abc\r\n', 'abc'],
    ['  abc  \n', 'abc'],
    ['abc\ndef\n', 'abc'],
    ['\nabc', ''],
    ['   ', ''],
  ])('%j → %j', (text, line) => {
    expect(firstLine(text)).toBe(line);
  });
});

describe('the configuration state (§5.2)', () => {
  it('is off with no folder, with an empty folder and with empty or whitespace-only files', () => {
    expect(stateOf()).toEqual({ configured: 'off', configReason: null, missing: [] });
    mkdirSync(secretsDir(dataDir), { recursive: true });
    expect(stateOf().configured).toBe('off');
    writeSecret(urlFile(dataDir), '');
    writeSecret(passwordFile(dataDir), '  \n\n');
    expect(stateOf().configured).toBe('off');
  });

  it('is partial with one file, naming the absent one', () => {
    plantNasFiles(dataDir, { password: null });
    expect(stateOf()).toEqual({
      configured: 'partial',
      configReason: 'password_missing',
      missing: ['nas-password'],
    });
    plantNasFiles(dataDir, { url: null });
    expect(stateOf()).toEqual({
      configured: 'partial',
      configReason: 'url_missing',
      missing: ['nas-url'],
    });
  });

  it('is ready with CRLF files and with a second line (the first is taken)', () => {
    writeSecret(urlFile(dataDir), `${PLANTED_URL}\r\n`);
    writeSecret(passwordFile(dataDir), `${PLANTED.password}\r\nsecond line\n`);
    expect(stateOf()).toEqual({ configured: 'ready', configReason: null, missing: [] });
    const read = createSecretsReader({ dataDir }).readForCopy();
    expect(read.password).toBe(PLANTED.password);
  });

  it('is invalid: url_invalid for a refused address (checked first), password_invalid next', () => {
    plantNasFiles(dataDir, { url: 'rsync://u:pw@h/m', password: 'a\u0000b' });
    expect(stateOf()).toEqual({ configured: 'invalid', configReason: 'url_invalid', missing: [] });
    plantNasFiles(dataDir, { url: 'rsync://u%zz@h/m' });
    expect(stateOf().configReason).toBe('url_invalid');
    plantNasFiles(dataDir, { password: 'a\u0000b' });
    expect(stateOf().configReason).toBe('password_invalid');
    plantNasFiles(dataDir, { password: 'tab\tinside' });
    expect(stateOf().configReason).toBe('password_invalid');
  });

  it('treats an oversize file as present but unusable', () => {
    plantNasFiles(dataDir);
    writeSecret(passwordFile(dataDir), 'x'.repeat(NAS_SECRET_MAX_BYTES + 1));
    expect(stateOf().configReason).toBe('password_invalid');
    plantNasFiles(dataDir);
    writeSecret(urlFile(dataDir), `${PLANTED_URL}${' '.repeat(NAS_SECRET_MAX_BYTES)}`);
    expect(stateOf().configReason).toBe('url_invalid');
  });

  it('treats a folder in place of a file as present but unusable', () => {
    plantNasFiles(dataDir, { password: null });
    mkdirSync(passwordFile(dataDir));
    expect(stateOf()).toEqual({
      configured: 'invalid',
      configReason: 'password_invalid',
      missing: [],
    });
  });

  it.skipIf(!canSymlink)('treats a symlink as present but unusable', () => {
    plantNasFiles(dataDir, { password: null });
    const target = join(dataDir, 'elsewhere');
    writeFileSync(target, `${PLANTED.password}\n`);
    symlinkSync(target, passwordFile(dataDir));
    expect(stateOf().configReason).toBe('password_invalid');
  });

  it('picks up a change between two reads (no cache)', () => {
    const reader = createSecretsReader({ dataDir });
    expect(decideConfiguration(reader.read()).configured).toBe('off');
    plantNasFiles(dataDir);
    expect(decideConfiguration(reader.read()).configured).toBe('ready');
    rmSync(passwordFile(dataDir));
    expect(decideConfiguration(reader.read()).configured).toBe('partial');
  });

  it('returns the mtimes, and the password only to the copy', () => {
    const at = new Date('2030-09-10T00:00:00.000Z');
    plantNasFiles(dataDir, { at });
    const reader = createSecretsReader({ dataDir });
    const files = reader.read();
    expect(files.url.state === 'present' && files.url.mtimeMs).toBe(at.getTime());
    expect(files.password).toEqual({ state: 'usable', mtimeMs: at.getTime() });
    expect(JSON.stringify(files)).not.toContain(PLANTED.password);
    expect(reader.mtimes()).toEqual({ url: at.getTime(), password: at.getTime() });
    expect(reader.readForCopy().password).toBe(PLANTED.password);
  });

  it('never gives the password of an unusable file to the copy', () => {
    plantNasFiles(dataDir, { password: 'a\u0000b' });
    expect(createSecretsReader({ dataDir }).readForCopy().password).toBeNull();
  });
});

describe('an unreadable folder (§5.2)', () => {
  const failing =
    (code: { value: string | null }): LstatFn =>
    (p) => {
      if (code.value !== null) {
        throw Object.assign(new Error(`planted message ${p}`), { code: code.value });
      }
      throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    };

  it('counts as every file absent and warns once per change of the error code', () => {
    const log = recordingLogger();
    const code = { value: 'EACCES' as string | null };
    const reader = createSecretsReader({ dataDir, log, lstat: failing(code) });
    for (let i = 0; i < 10; i++) expect(decideConfiguration(reader.read()).configured).toBe('off');
    expect(log.calls.filter((c) => c.level === 'warn')).toHaveLength(1);
    expect(log.calls[0]?.obj).toEqual({ code: 'EACCES' });
    code.value = 'EPERM';
    reader.read();
    reader.read();
    expect(log.calls.filter((c) => c.level === 'warn')).toHaveLength(2);
    // A clean read resets it: the same code warns again.
    code.value = null;
    reader.read();
    code.value = 'EPERM';
    reader.read();
    expect(log.calls.filter((c) => c.level === 'warn')).toHaveLength(3);
    expect(JSON.stringify(log.calls)).not.toContain('planted');
  });

  it.skipIf(process.platform === 'win32')('reads a real chmod 000 folder as off', () => {
    plantNasFiles(dataDir);
    chmodSync(secretsDir(dataDir), 0o000);
    const log = recordingLogger();
    const files = createSecretsReader({ dataDir, log }).read();
    // Root can read anything; only an ordinary user sees the refusal.
    if (process.getuid?.() === 0) return;
    expect(decideConfiguration(files).configured).toBe('off');
    expect(log.calls).toHaveLength(1);
  });
});

if (process.platform === 'win32') {
  console.warn(
    'secrets.test: chmod cannot make a folder unreadable on Windows; the real-folder case is skipped (the injected lstat case runs).',
  );
}
