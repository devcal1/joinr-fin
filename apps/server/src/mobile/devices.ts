// The device store (stage-9.md §3.3, §6.1): `<DATA_DIR>/devices/devices.json`, outside finance.db so
// a database restore never revives a removed phone and the keys never travel to the NAS. Loaded
// once at start-up; memory is the authority afterwards. Every change rewrites the file atomically
// and FULLY SYNCHRONOUSLY (a temporary file in the same folder, fsync, rename, folder fsync), so no
// two writes interleave and each one serialises the in-memory state at the moment it runs (FROZEN).
//
// Failures, by change (FROZEN): pairing fails closed (the device is not added); a removal is applied
// in memory first and never refused (retried on every later write, the last-used flush and
// preClose); a failed last-used flush changes nothing visible but `storeProblem`.
//
// Only the SHA-256 of a key is kept. Logs carry error codes only, never a path, key, hash or label.
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import {
  DEVICE_ID_RE,
  DEVICE_LAST_USED_FLUSH_MS,
  MOBILE_KEEP_REMOVED,
  MOBILE_MAX_DEVICES,
  type PhoneDeviceDto,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { errorCode, fsyncDir, fsyncFile } from '../backups/copy';

export const DEVICES_DIR_NAME = 'devices';
export const DEVICES_FILE_NAME = 'devices.json';
const STORE_VERSION = 1;

/** One paired (or removed) phone as the file stores it. */
export interface DeviceRecord {
  id: string;
  label: string;
  /** SHA-256 of the key, hex. */
  keyHash: string;
  pairedAt: string;
  lastUsedAt: string | null;
  appVersion: string | null;
  revokedAt: string | null;
}

/** The file system calls the store makes (tests replace any of them, e.g. a `renameSync` that throws). */
export interface DeviceStoreFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  rmSync(path: string, options: { force: true }): void;
  chmodSync(path: string, mode: number): void;
  fsyncFile(path: string): void;
  fsyncDir(path: string): void;
}

export const defaultDeviceStoreFs: DeviceStoreFs = {
  readFileSync: (path, encoding) => nodeFs.readFileSync(path, encoding),
  writeFileSync: (path, data, options) => nodeFs.writeFileSync(path, data, options),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  mkdirSync: (path, options) => nodeFs.mkdirSync(path, options),
  rmSync: (path, options) => nodeFs.rmSync(path, options),
  chmodSync: (path, mode) => nodeFs.chmodSync(path, mode),
  fsyncFile,
  fsyncDir,
};

export type StoreProblem = 'set_aside' | 'unwritable' | null;

type Log = Pick<FastifyBaseLogger, 'warn' | 'info'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function isIsoOrNull(v: unknown): v is string | null {
  return v === null || (typeof v === 'string' && ISO_RE.test(v));
}

function parseRecord(v: unknown): DeviceRecord | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !DEVICE_ID_RE.test(r.id)) return null;
  if (typeof r.label !== 'string') return null;
  if (typeof r.keyHash !== 'string' || !HASH_RE.test(r.keyHash)) return null;
  if (typeof r.pairedAt !== 'string' || !ISO_RE.test(r.pairedAt)) return null;
  if (!isIsoOrNull(r.lastUsedAt) || !isIsoOrNull(r.revokedAt)) return null;
  if (r.appVersion !== null && typeof r.appVersion !== 'string') return null;
  return {
    id: r.id,
    label: r.label,
    keyHash: r.keyHash,
    pairedAt: r.pairedAt,
    lastUsedAt: r.lastUsedAt,
    appVersion: r.appVersion,
    revokedAt: r.revokedAt,
  };
}

/** The file's contents, or null when it is not a valid store. */
export function parseDeviceFile(text: string): DeviceRecord[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const file = parsed as Record<string, unknown>;
  if (file.version !== STORE_VERSION || !Array.isArray(file.devices)) return null;
  const out: DeviceRecord[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const item of file.devices as unknown[]) {
    const record = parseRecord(item);
    if (record === null || ids.has(record.id) || hashes.has(record.keyHash)) return null;
    ids.add(record.id);
    hashes.add(record.keyHash);
    out.push(record);
  }
  return out;
}

/** `20300912T052000Z`: the set-aside file's stamp. */
function fileStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

const byNewest =
  (field: 'pairedAt' | 'revokedAt') =>
  (a: DeviceRecord, b: DeviceRecord): number => {
    const x = a[field] ?? '';
    const y = b[field] ?? '';
    return x < y ? 1 : x > y ? -1 : a.id < b.id ? 1 : -1;
  };

export function toDeviceDto(d: DeviceRecord): PhoneDeviceDto {
  return {
    id: d.id,
    label: d.label,
    pairedAt: d.pairedAt,
    lastUsedAt: d.lastUsedAt,
    appVersion: d.appVersion,
    revokedAt: d.revokedAt,
  };
}

export interface DeviceStoreOptions {
  dataDir: string;
  fs?: Partial<DeviceStoreFs>;
  log?: Log;
  now?: () => Date;
}

export type AddResult = { ok: true; device: DeviceRecord } | { ok: false };

export class DeviceStore {
  readonly dir: string;
  readonly file: string;
  private readonly fs: DeviceStoreFs;
  private readonly log: Log | undefined;
  private readonly now: () => Date;
  /** Every entry (active and removed), in memory. */
  private records: DeviceRecord[] = [];
  private readonly byHash = new Map<string, DeviceRecord>();
  /** What the file holds now (by id): lastUsedAt and revokedAt as last written. */
  private persisted = new Map<string, { lastUsedAt: string | null; revokedAt: string | null }>();
  private problem: StoreProblem = null;

  constructor(o: DeviceStoreOptions) {
    this.dir = join(o.dataDir, DEVICES_DIR_NAME);
    this.file = join(this.dir, DEVICES_FILE_NAME);
    this.fs = { ...defaultDeviceStoreFs, ...o.fs };
    this.log = o.log;
    this.now = o.now ?? (() => new Date());
    this.load();
  }

  // ─── Loading ──────────────────────────────────────────────────────────────────────────────────

  private load(): void {
    let text: string;
    try {
      text = this.fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return; // no phone paired yet
      this.setAside(errorCode(err) ?? 'EUNKNOWN');
      return;
    }
    const records = parseDeviceFile(text);
    if (records === null) {
      this.setAside('EINVALID');
      return;
    }
    this.replaceAll(records);
    this.markPersisted();
  }

  /** Renames an unreadable or invalid file aside (never deletes it) and starts empty. */
  private setAside(code: string): void {
    this.problem = 'set_aside';
    try {
      this.fs.renameSync(
        this.file,
        join(this.dir, `devices.unreadable-${fileStamp(this.now())}.json`),
      );
    } catch (err) {
      this.log?.warn(
        { code: errorCode(err) ?? 'EUNKNOWN' },
        'the phone list could not be set aside',
      );
    }
    this.log?.warn({ code }, 'the phone list could not be read; it was set aside and starts empty');
  }

  private replaceAll(records: DeviceRecord[]): void {
    this.records = records;
    this.byHash.clear();
    for (const r of records) this.byHash.set(r.keyHash, r);
  }

  private markPersisted(): void {
    this.persisted = new Map(
      this.records.map((r) => [r.id, { lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt }]),
    );
  }

  // ─── Reads ────────────────────────────────────────────────────────────────────────────────────

  get storeProblem(): StoreProblem {
    return this.problem;
  }

  /** Removals applied in memory but not yet in the file. */
  get pendingRemovals(): number {
    let n = 0;
    for (const r of this.records) {
      if (r.revokedAt !== null && (this.persisted.get(r.id)?.revokedAt ?? null) === null) n += 1;
    }
    return n;
  }

  /** The device whose key hashes to `keyHash` (active or removed), if any. */
  findByHash(keyHash: string): DeviceRecord | undefined {
    return this.byHash.get(keyHash);
  }

  findById(id: string): DeviceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** Active phones, newest `pairedAt` first. */
  active(): DeviceRecord[] {
    return this.records.filter((r) => r.revokedAt === null).sort(byNewest('pairedAt'));
  }

  /** Removed phones, newest `revokedAt` first, at most `MOBILE_KEEP_REMOVED`. */
  removed(): DeviceRecord[] {
    return this.records
      .filter((r) => r.revokedAt !== null)
      .sort(byNewest('revokedAt'))
      .slice(0, MOBILE_KEEP_REMOVED);
  }

  activeCount(): number {
    return this.records.reduce((n, r) => n + (r.revokedAt === null ? 1 : 0), 0);
  }

  isFull(): boolean {
    return this.activeCount() >= MOBILE_MAX_DEVICES;
  }

  // ─── Changes ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Pairing (fails closed): adds the device and writes the file synchronously; when the write
   * fails the device is taken out again and nothing is returned but `{ ok: false }`.
   */
  add(device: Omit<DeviceRecord, 'revokedAt' | 'lastUsedAt'>): AddResult {
    const record: DeviceRecord = { ...device, lastUsedAt: null, revokedAt: null };
    this.records.push(record);
    this.byHash.set(record.keyHash, record);
    if (this.write()) return { ok: true, device: record };
    this.records = this.records.filter((r) => r !== record);
    this.byHash.delete(record.keyHash);
    return { ok: false };
  }

  /**
   * A removal (never refused): applied in memory at once, then written. Returns 'unknown' for an
   * id the store does not know, 'already' when it was removed before (nothing changes).
   */
  revoke(id: string): 'revoked' | 'already' | 'unknown' {
    const record = this.findById(id);
    if (record === undefined) return 'unknown';
    if (record.revokedAt !== null) return 'already';
    record.revokedAt = this.now().toISOString();
    this.pruneRemoved();
    this.write();
    return 'revoked';
  }

  /**
   * An authenticated call: `lastUsedAt` (and the app version when sent) in memory; the file is
   * written when the last-used time is `DEVICE_LAST_USED_FLUSH_MS` newer than the stored one, or
   * when the app version changed.
   */
  touch(record: DeviceRecord, appVersion: string | null): void {
    const at = this.now();
    record.lastUsedAt = at.toISOString();
    let versionChanged = false;
    if (appVersion !== null && appVersion !== record.appVersion) {
      record.appVersion = appVersion;
      versionChanged = true;
    }
    const stored = this.persisted.get(record.id)?.lastUsedAt ?? null;
    const due = stored === null || at.getTime() - Date.parse(stored) >= DEVICE_LAST_USED_FLUSH_MS;
    if (due || versionChanged || this.pendingRemovals > 0) this.write();
  }

  /** Writes whatever memory holds that the file does not (last-used times, pending removals). */
  flush(): void {
    if (!this.dirty()) return;
    this.write();
  }

  private dirty(): boolean {
    if (this.persisted.size !== this.records.length) return true;
    for (const r of this.records) {
      const p = this.persisted.get(r.id);
      if (p === undefined || p.lastUsedAt !== r.lastUsedAt || p.revokedAt !== r.revokedAt)
        return true;
    }
    return false;
  }

  /** Keeps the newest `MOBILE_KEEP_REMOVED` removed entries (their keys then read as unknown). */
  private pruneRemoved(): void {
    const keep = new Set(this.removed().map((r) => r.id));
    const dropped = this.records.filter((r) => r.revokedAt !== null && !keep.has(r.id));
    if (dropped.length === 0) return;
    for (const r of dropped) this.byHash.delete(r.keyHash);
    this.records = this.records.filter((r) => r.revokedAt === null || keep.has(r.id));
  }

  /** The atomic, synchronous write of the whole in-memory state. True on success. */
  private write(): boolean {
    const body = `${JSON.stringify(
      { version: STORE_VERSION, devices: this.records.map((r) => ({ ...r })) },
      null,
      2,
    )}\n`;
    const temp = join(this.dir, `.${DEVICES_FILE_NAME}.${process.pid}.tmp`);
    try {
      this.fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.fs.writeFileSync(temp, body, { mode: 0o600, flag: 'w' });
      // writeFileSync's mode applies only when it creates the file (and the umask may narrow it).
      this.fs.chmodSync(temp, 0o600);
      this.fs.fsyncFile(temp);
      this.fs.renameSync(temp, this.file);
      this.fs.fsyncDir(this.dir);
    } catch (err) {
      try {
        this.fs.rmSync(temp, { force: true });
      } catch {
        // Best effort.
      }
      this.problem = 'unwritable';
      this.log?.warn({ code: errorCode(err) ?? 'EUNKNOWN' }, 'the phone list could not be saved');
      return false;
    }
    this.problem = null;
    this.markPersisted();
    return true;
  }
}
