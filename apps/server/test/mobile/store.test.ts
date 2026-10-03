// The device store, keys and limits (stage-9.md §3.3, §6.1, §6.4): the file format and modes, the
// atomic synchronous writes, set-aside of an unreadable file, pairing failing closed, removals that
// never fail (pending until saved), the last-used flush, pruning of removed entries, and the key,
// id, code and limiter shapes. Temp folders only; every key is generated here and never printed.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEVICE_ID_RE,
  DEVICE_LAST_USED_FLUSH_MS,
  MOBILE_KEEP_REMOVED,
  MOBILE_KEY_RE,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
} from '@joinr/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceStore, defaultDeviceStoreFs, parseDeviceFile } from '../../src/mobile/devices';
import {
  digestsEqual,
  generateDeviceId,
  generateDeviceKey,
  generatePairingCode,
  sha256Bytes,
  sha256Hex,
} from '../../src/mobile/keys';
import { SlidingWindowLimiter } from '../../src/mobile/limits';
import { makeTempDir, removeDir } from '../helpers';
import { TestClock } from './helpers';

let dir: string;
let clock: TestClock;

beforeEach(async () => {
  dir = await makeTempDir('joinr-devices-');
  clock = new TestClock('2030-09-12T05:20:00.000Z');
});
afterEach(() => removeDir(dir));

const fileOf = (d: string) => join(d, 'devices', 'devices.json');
const readFile = (d: string) =>
  JSON.parse(readFileSync(fileOf(d), 'utf8')) as {
    version: number;
    devices: Array<Record<string, unknown>>;
  };

function device(n: number) {
  const key = generateDeviceKey();
  return {
    key,
    record: {
      id: `d_${n.toString(16).padStart(16, '0')}`,
      label: `Test phone ${n}`,
      keyHash: sha256Hex(key),
      pairedAt: new Date(Date.parse('2030-09-01T00:00:00.000Z') + n * 60_000).toISOString(),
      appVersion: '1.0.0',
    },
  };
}

/** A store whose writes can be made to fail (rename throws EACCES). */
function failingFs() {
  const state = { fail: false };
  return {
    state,
    fs: {
      renameSync: (from: string, to: string) => {
        if (state.fail) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        defaultDeviceStoreFs.renameSync(from, to);
      },
    },
  };
}

describe('keys, ids and codes', () => {
  it('a key is jfk_ + 43 base64url characters; ids and codes have their shapes', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const key = generateDeviceKey();
      expect(MOBILE_KEY_RE.test(key)).toBe(true);
      keys.add(key);
      expect(DEVICE_ID_RE.test(generateDeviceId())).toBe(true);
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const ch of code) expect(PAIRING_CODE_ALPHABET).toContain(ch);
    }
    expect(keys.size).toBe(50);
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(digestsEqual(sha256Bytes('a'), sha256Bytes('a'))).toBe(true);
    expect(digestsEqual(sha256Bytes('a'), sha256Bytes('b'))).toBe(false);
    expect(digestsEqual(sha256Bytes('a'), Buffer.alloc(3))).toBe(false);
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows max attempts per window, then refuses with the seconds left; old hits leave', () => {
    const l = new SlidingWindowLimiter(3, 60_000);
    expect(l.hit(0).allowed).toBe(true);
    expect(l.hit(10_000).allowed).toBe(true);
    expect(l.hit(20_000).allowed).toBe(true);
    const refused = l.hit(30_000);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(l.count(30_000)).toBe(3); // a refused attempt is not counted
    expect(l.hit(60_001).allowed).toBe(true); // the first hit left the window
    expect(l.count(60_001)).toBe(3);
  });
});

describe('DeviceStore', () => {
  it('starts empty without a file and writes nothing until a change', () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    expect(store.active()).toEqual([]);
    expect(store.storeProblem).toBeNull();
    expect(existsSync(join(dir, 'devices'))).toBe(false);
    store.flush();
    expect(existsSync(join(dir, 'devices'))).toBe(false);
  });

  it('pairing writes the file atomically (version 1, hashes only) and a reload reads it back', () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    const { key, record } = device(1);
    expect(store.add(record).ok).toBe(true);
    const file = readFile(dir);
    expect(file.version).toBe(1);
    expect(file.devices).toEqual([{ ...record, lastUsedAt: null, revokedAt: null }]);
    const text = readFileSync(fileOf(dir), 'utf8');
    expect(text).not.toContain(key);
    expect(text).not.toContain('jfk_');
    // No temporary file is left behind.
    expect(readdirSync(join(dir, 'devices'))).toEqual(['devices.json']);
    const again = new DeviceStore({ dataDir: dir, now: clock.now });
    expect(again.findByHash(sha256Hex(key))?.id).toBe(record.id);
    expect(again.storeProblem).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('creates the folder 0700 and the file 0600', () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    store.add(device(1).record);
    expect(statSync(join(dir, 'devices')).mode & 0o777).toBe(0o700);
    expect(statSync(fileOf(dir)).mode & 0o777).toBe(0o600);
  });

  it('sets an unreadable or invalid file aside (never deleted) and starts empty', () => {
    for (const bad of ['{not json', '{"version":2,"devices":[]}', '{"version":1,"devices":[{}]}']) {
      const d = join(dir, `case-${bad.length}`);
      mkdirSync(join(d, 'devices'), { recursive: true });
      writeFileSync(fileOf(d), bad);
      const store = new DeviceStore({ dataDir: d, now: clock.now });
      expect(store.storeProblem).toBe('set_aside');
      expect(store.active()).toEqual([]);
      const names = readdirSync(join(d, 'devices'));
      expect(names).toEqual(['devices.unreadable-20300912T052000Z.json']);
      expect(readFileSync(join(d, 'devices', names[0]!), 'utf8')).toBe(bad);
      // The next successful write clears the problem.
      store.add(device(1).record);
      expect(store.storeProblem).toBeNull();
    }
  });

  it('parseDeviceFile refuses duplicates and malformed entries', () => {
    const { record } = device(1);
    const ok = { ...record, lastUsedAt: null, revokedAt: null };
    expect(parseDeviceFile(JSON.stringify({ version: 1, devices: [ok] }))).toEqual([ok]);
    expect(parseDeviceFile(JSON.stringify({ version: 1, devices: [ok, ok] }))).toBeNull();
    expect(
      parseDeviceFile(JSON.stringify({ version: 1, devices: [{ ...ok, keyHash: 'abc' }] })),
    ).toBeNull();
    expect(
      parseDeviceFile(JSON.stringify({ version: 1, devices: [{ ...ok, id: 'phone' }] })),
    ).toBeNull();
  });

  it('pairing fails closed when the file cannot be written', () => {
    const f = failingFs();
    const store = new DeviceStore({ dataDir: dir, now: clock.now, fs: f.fs });
    f.state.fail = true;
    const { key, record } = device(1);
    expect(store.add(record)).toEqual({ ok: false });
    expect(store.findByHash(sha256Hex(key))).toBeUndefined();
    expect(store.active()).toEqual([]);
    expect(store.storeProblem).toBe('unwritable');
    expect(existsSync(fileOf(dir))).toBe(false);
    // No temporary file is left behind.
    expect(readdirSync(join(dir, 'devices'))).toEqual([]);
  });

  it('a removal applies in memory at once, stays pending while unwritable, and is saved later', () => {
    const f = failingFs();
    const store = new DeviceStore({ dataDir: dir, now: clock.now, fs: f.fs });
    const a = device(1);
    store.add(a.record);
    f.state.fail = true;
    expect(store.revoke(a.record.id)).toBe('revoked');
    expect(store.findByHash(a.record.keyHash)?.revokedAt).toBe('2030-09-12T05:20:00.000Z');
    expect(store.storeProblem).toBe('unwritable');
    expect(store.pendingRemovals).toBe(1);
    expect(readFile(dir).devices[0]!.revokedAt).toBeNull();
    f.state.fail = false;
    store.flush();
    expect(store.pendingRemovals).toBe(0);
    expect(store.storeProblem).toBeNull();
    expect(readFile(dir).devices[0]!.revokedAt).toBe('2030-09-12T05:20:00.000Z');
    expect(
      new DeviceStore({ dataDir: dir }).findByHash(a.record.keyHash)?.revokedAt,
    ).not.toBeNull();
    expect(store.revoke(a.record.id)).toBe('already');
    expect(store.revoke('d_00000000000000ff')).toBe('unknown');
  });

  it('a last-used flush and a revoke in the same tick leave revokedAt in the file', () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    const a = device(1);
    store.add(a.record);
    const rec = store.findByHash(a.record.keyHash)!;
    store.touch(rec, null); // first use: written
    clock.advance(DEVICE_LAST_USED_FLUSH_MS);
    store.revoke(a.record.id);
    store.touch(rec, null); // a call already in flight touches the removed device
    store.flush();
    expect(readFile(dir).devices[0]!.revokedAt).not.toBeNull();
    expect(
      new DeviceStore({ dataDir: dir }).findByHash(a.record.keyHash)?.revokedAt,
    ).not.toBeNull();
  });

  it('flushes lastUsedAt only when it is DEVICE_LAST_USED_FLUSH_MS newer than the stored one', () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    const a = device(1);
    store.add(a.record);
    const rec = store.findByHash(a.record.keyHash)!;
    store.touch(rec, '1.0.0');
    expect(readFile(dir).devices[0]!.lastUsedAt).toBe('2030-09-12T05:20:00.000Z');
    clock.advance(DEVICE_LAST_USED_FLUSH_MS - 1000);
    store.touch(rec, '1.0.0');
    expect(readFile(dir).devices[0]!.lastUsedAt).toBe('2030-09-12T05:20:00.000Z');
    expect(rec.lastUsedAt).toBe('2030-09-12T05:29:59.000Z');
    clock.advance(1000);
    store.touch(rec, '1.0.0');
    expect(readFile(dir).devices[0]!.lastUsedAt).toBe('2030-09-12T05:30:00.000Z');
    // A new app version is written at once.
    clock.advance(1000);
    store.touch(rec, '1.0.1');
    expect(readFile(dir).devices[0]!.appVersion).toBe('1.0.1');
    // preClose's flush writes the in-memory time.
    clock.advance(1000);
    store.touch(rec, null);
    store.flush();
    expect(readFile(dir).devices[0]!.lastUsedAt).toBe('2030-09-12T05:30:02.000Z');
  });

  it('a failed last-used flush changes nothing visible but storeProblem', () => {
    const f = failingFs();
    const store = new DeviceStore({ dataDir: dir, now: clock.now, fs: f.fs });
    const a = device(1);
    store.add(a.record);
    f.state.fail = true;
    store.touch(store.findByHash(a.record.keyHash)!, null);
    expect(store.storeProblem).toBe('unwritable');
    expect(store.active()).toHaveLength(1);
    expect(store.pendingRemovals).toBe(0);
  });

  it(`keeps the newest ${MOBILE_KEEP_REMOVED} removed entries`, () => {
    const store = new DeviceStore({ dataDir: dir, now: clock.now });
    const all = Array.from({ length: MOBILE_KEEP_REMOVED + 2 }, (_, i) => device(i + 1));
    for (const d of all) {
      store.add(d.record);
      clock.advance(1000);
      store.revoke(d.record.id);
    }
    const removed = store.removed();
    expect(removed).toHaveLength(MOBILE_KEEP_REMOVED);
    expect(removed[0]!.id).toBe(all.at(-1)!.record.id); // newest first
    expect(store.findByHash(all[0]!.record.keyHash)).toBeUndefined(); // pruned → unknown
    expect(readFile(dir).devices).toHaveLength(MOBILE_KEEP_REMOVED);
  });
});
