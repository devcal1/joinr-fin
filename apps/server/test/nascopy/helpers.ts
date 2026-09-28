// NAS-copy test helpers (stage-8.md §5.13): planted NAS files (obviously fake values, §10.0), a
// local backups folder with real Stage 7 names, and a fake NAS behind a fake rsync runner that
// answers listings, applies sends and checks every argv against the read-only pin. Never `data/`,
// never a network, never a real rsync.
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { NAS_SECRET_FILES, NAS_SECRETS_DIR, type BackupKind } from '@joinr/schema';
import { expect } from 'vitest';
import { formatBackupName } from '../../src/backups/names';
import { RSYNC_FLAGS, RSYNC_LIST_FLAG } from '../../src/nascopy/constants';
import {
  abortWhy,
  RsyncAbortError,
  type RsyncResult,
  type RsyncRunner,
  type RsyncRunOptions,
} from '../../src/nascopy/runner';

// ─── Planted values (§5.12: the leak greps look for every one of them) ───────────────────────────

export const PLANTED = {
  user: 'planted-user',
  host: 'planted-host',
  module: 'planted-module',
  subfolder: 'planted-subfolder',
  password: 'planted-password-not-real',
} as const;

/** The canonical planted address (no subfolder). */
export const PLANTED_URL = `rsync://${PLANTED.user}@${PLANTED.host}/${PLANTED.module}/`;
/** With the subfolder. */
export const PLANTED_SUB_URL = `rsync://${PLANTED.user}@${PLANTED.host}/${PLANTED.module}/${PLANTED.subfolder}/`;

/** Every planted value plus `rsync://`: none may appear in a row, a body, a log or an outcome. */
export const LEAK_TERMS: readonly string[] = [
  PLANTED.user,
  PLANTED.host,
  PLANTED.module,
  PLANTED.subfolder,
  PLANTED.password,
  'rsync://',
];

/**
 * The frozen `url_invalid` sentence names the address FORM (§4.4): the only `rsync://` a body, row
 * or log may carry. It is removed before the greps.
 */
export const ADDRESS_FORM = 'rsync://user@host/module';

/** Asserts none of the planted values appears in `text`. */
export function expectNoLeak(raw: string, what = 'text'): void {
  const text = raw.split(ADDRESS_FORM).join('');
  for (const term of LEAK_TERMS) {
    expect(text.includes(term), `${what} contains a planted value (${term.length} chars)`).toBe(
      false,
    );
  }
}

export const secretsDir = (dataDir: string): string => join(dataDir, NAS_SECRETS_DIR);
export const urlFile = (dataDir: string): string => join(secretsDir(dataDir), NAS_SECRET_FILES.url);
export const passwordFile = (dataDir: string): string =>
  join(secretsDir(dataDir), NAS_SECRET_FILES.password);

/** Writes one NAS file (raw content) with its mtime at `at` (fake clocks run in 2030). */
export function writeSecret(path: string, content: string | Buffer, at?: Date): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (at) utimesSync(path, at, at);
}

/** Plants the NAS files: `url`/`password` null leaves that file out. */
export function plantNasFiles(
  dataDir: string,
  o: { url?: string | null; password?: string | null; at?: Date } = {},
): void {
  const url = o.url === undefined ? PLANTED_URL : o.url;
  const password = o.password === undefined ? PLANTED.password : o.password;
  mkdirSync(secretsDir(dataDir), { recursive: true });
  if (url !== null) writeSecret(urlFile(dataDir), `${url}\n`, o.at);
  else rmSync(urlFile(dataDir), { force: true });
  if (password !== null) writeSecret(passwordFile(dataDir), `${password}\n`, o.at);
  else rmSync(passwordFile(dataDir), { force: true });
}

// ─── Local backups ──────────────────────────────────────────────────────────────────────────────

export const localBackupsDir = (dataDir: string): string => join(dataDir, 'backups');

export interface PlantedBackup {
  name: string;
  bytes: number;
  at: Date;
}

/** Writes one backup file of `bytes` bytes. */
export function plantBackup(dataDir: string, kind: BackupKind, at: Date, bytes: number): string {
  mkdirSync(localBackupsDir(dataDir), { recursive: true });
  const name = formatBackupName(kind, at);
  writeFileSync(join(localBackupsDir(dataDir), name), Buffer.alloc(bytes, 7));
  return name;
}

/**
 * The Stage 7 `typical` shape: 27 files (22 nightly 25/08 → 15/09, 2 by hand, 2 before import, 1
 * before update), distinct small sizes. Newest first.
 */
export function plantTypical(dataDir: string): PlantedBackup[] {
  const out: PlantedBackup[] = [];
  let size = 1000;
  const add = (kind: BackupKind, at: Date): void => {
    size += 13;
    out.push({ name: plantBackup(dataDir, kind, at, size), bytes: size, at });
  };
  for (let i = 0; i < 22; i++) add('nightly', new Date(2030, 7, 25 + i, 2, 30));
  add('manual', new Date(2030, 8, 3, 18, 5));
  add('manual', new Date(2030, 8, 10, 18, 5));
  add('pre-import', new Date(2030, 8, 1, 9, 0));
  add('pre-import', new Date(2030, 8, 12, 9, 0));
  add('pre-migrate', new Date(2030, 8, 5, 12, 0));
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ─── Listings ───────────────────────────────────────────────────────────────────────────────────

const commas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** One `--list-only` line for a regular file. */
export function fileLine(name: string, bytes: number): string {
  return `-rw-r--r-- ${commas(bytes).padStart(14)} 2030/09/15 02:30:00 ${name}`;
}

/** A listing: the `.` line, the files, and any extra lines. */
export function renderListing(
  files: ReadonlyMap<string, number>,
  extra: readonly string[] = [],
): string {
  const lines = ['drwxr-xr-x          4,096 2030/09/15 03:00:00 .', ...extra];
  for (const [name, bytes] of files) lines.push(fileLine(name, bytes));
  return `${lines.join('\n')}\n`;
}

// ─── The fake NAS ───────────────────────────────────────────────────────────────────────────────

export type Phase = 'list' | 'send' | 'relist';

export interface Step {
  code?: number;
  err?: string;
  out?: string;
  outTruncated?: boolean;
  /** Throw this (synchronously when `sync`) instead of answering. */
  throws?: unknown;
  sync?: boolean;
  /** Resolve with this raw value (garbage). */
  raw?: unknown;
  /** Never answer until the signal aborts (then reject like the real runner). */
  hang?: boolean;
  /** A send that stores nothing. */
  noEffect?: boolean;
  /** Runs before answering (a prune, a rewrite of the NAS files, …). */
  before?: (nas: FakeNas) => void;
  /** A send stores only these names (others are left out). */
  only?: (name: string) => boolean;
}

export interface Call {
  phase: Phase;
  args: string[];
  password: string | undefined;
}

/** A fake NAS answering the fake runner. Every argv is checked against the pin. */
export class FakeNas {
  /** Backup-named files on the NAS (name → bytes). */
  readonly files = new Map<string, number>();
  /** Foreign lines added to every listing. */
  extra: string[] = [];
  /** Per call index (0-based) overrides. */
  steps: Array<Step | undefined> = [];
  readonly calls: Call[] = [];
  /** Argv shapes the pin does not allow. */
  readonly violations: string[] = [];

  constructor(readonly dataDir: string) {}

  /** Seeds the NAS with the given local backups (at their sizes). */
  hold(files: readonly PlantedBackup[]): this {
    for (const f of files) this.files.set(f.name, f.bytes);
    return this;
  }

  readonly runner: RsyncRunner = (args, opts) => this.answer(args, opts);

  private checkPin(args: readonly string[], phase: Phase): void {
    const flags = RSYNC_FLAGS as readonly string[];
    const head = args.slice(0, flags.length);
    const ok =
      head.length === flags.length &&
      head.every((a, i) => a === flags[i]) &&
      (phase === 'send'
        ? args[flags.length] === '--' &&
          args.slice(flags.length + 1, -1).every((s) => this.isSource(s)) &&
          (args.at(-1) ?? '').startsWith('rsync://') &&
          (args.at(-1) ?? '').endsWith('/')
        : args.length === flags.length + 3 &&
          args[flags.length] === RSYNC_LIST_FLAG &&
          args[flags.length + 1] === '--' &&
          (args.at(-1) ?? '').startsWith('rsync://') &&
          (args.at(-1) ?? '').endsWith('/'));
    const rest = args.filter(
      (a) => a !== '--' && a !== RSYNC_LIST_FLAG && !a.startsWith('rsync://') && !this.isSource(a),
    );
    if (!ok || rest.join(' ') !== flags.join(' '))
      this.violations.push(`${phase}: ${rest.join(' ')}`);
  }

  private isSource(a: string): boolean {
    return dirname(a) === localBackupsDir(this.dataDir);
  }

  private answer(args: readonly string[], opts: RsyncRunOptions): Promise<RsyncResult> {
    const index = this.calls.length;
    const isList = args.includes(RSYNC_LIST_FLAG);
    const phase: Phase = !isList
      ? 'send'
      : this.calls.some((c) => c.phase === 'send')
        ? 'relist'
        : 'list';
    this.calls.push({ phase, args: [...args], password: opts.password });
    this.checkPin(args, phase);
    const step = this.steps[index] ?? {};
    if (step.throws !== undefined && step.sync) throw step.throws as Error;
    return (async () => {
      step.before?.(this);
      if (step.throws !== undefined) throw step.throws as Error;
      if (step.raw !== undefined) return step.raw as RsyncResult;
      if (step.hang) {
        await new Promise<never>((_resolve, reject) => {
          const fail = (): void => reject(new RsyncAbortError(abortWhy(opts.signal)));
          if (opts.signal.aborted) fail();
          else opts.signal.addEventListener('abort', fail, { once: true });
        });
      }
      if (phase === 'send' && !step.noEffect) {
        for (const source of args.slice(RSYNC_FLAGS.length + 1, -1)) {
          const name = basename(source);
          if (step.only && !step.only(name)) continue;
          try {
            this.files.set(name, statSync(source).size);
          } catch {
            // Vanished here: rsync would say so (exit 24).
          }
        }
      }
      return {
        code: step.code ?? 0,
        out: step.out ?? (phase === 'send' ? '' : renderListing(this.files, this.extra)),
        err: step.err ?? '',
        outTruncated: step.outTruncated ?? false,
      };
    })();
  }

  phases(): Phase[] {
    return this.calls.map((c) => c.phase);
  }
}
