// `pnpm restore:backup <backup> [--yes] [--force] [--json]` in a checkout;
// `node dist/cli/restore.js <backup> [--yes] [--force] [--json]` in the image (stage-7.md §5.5).
// `<backup>` is a bare backup name (resolved in <DATA_DIR>/backups; a leading `joinr-finance-` is
// stripped, so a downloaded file's name works too) or a path to a SQLite file. No prompts: without
// --yes it prints what it would do and exits 3. Run it with the app stopped.
//
// Exit codes (frozen): 0 restored · 1 failed (nothing changed, or the pre-restore backup is named)
// · 2 usage or configuration · 3 confirmation required (--yes) · 5 the backup is not valid ·
// 6 the app looks running (--force overrides the marker only, never the lock check).
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig } from '../config';
import {
  RESTORE_EXIT,
  restoreBackup,
  type RestoreOutcome,
  type RestoreSummary,
} from '../backups/restore';

export interface RestoreCliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** The clock (tests). */
  now?: () => Date;
}

const defaultIo = (): RestoreCliIo => ({
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
});

const USAGE_ARGS = '<backup> [--yes] [--force] [--json]';

/** The command as it was invoked: the bundle (`node dist/cli/restore.js`) or a checkout (tsx). */
export function usageFor(moduleUrl: string): string {
  const bundled = moduleUrl.endsWith('.js');
  return `Usage: ${bundled ? 'node dist/cli/restore.js' : 'pnpm restore:backup'} ${USAGE_ARGS}`;
}

export const USAGE = usageFor(import.meta.url);

const HELP = `${USAGE}

Restores a backup into DATA_DIR. Stop the app first.
  <backup>   a backup name from the backups folder (a downloaded "joinr-finance-" name works too),
             or a path to a SQLite backup file
  --yes      restore (without it, print what would happen and exit 3)
  --force    ignore the running marker left by an unclean stop, and set a damaged current
             database aside unverified instead of refusing
  --json     print the summary and the outcome as one JSON object

Exit codes: 0 restored, 1 failed, 2 usage, 3 confirmation required, 5 invalid backup,
6 the app looks running.`;

interface RestoreArgs {
  backup: string | null;
  yes: boolean;
  force: boolean;
  json: boolean;
  help: boolean;
}

/** Parses the arguments, or returns an error message. */
export function parseArgs(argv: readonly string[]): RestoreArgs | string {
  const args: RestoreArgs = { backup: null, yes: false, force: false, json: false, help: false };
  for (const a of argv) {
    switch (a) {
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (a.startsWith('-')) return `Unknown option ${a}`;
        if (args.backup !== null) return 'Give one backup';
        args.backup = a;
    }
  }
  return args;
}

/** `2030-09-15T14:32:00+10:00` → `15/09/2030 14:32`. */
function displayLocal(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** A UTC ISO → its date `dd/mm/yyyy`. */
function displayDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function displaySize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function summaryLines(s: RestoreSummary): string[] {
  const b = s.backup;
  const lines = [
    `Backup:   ${b.name} (${displayLocal(b.createdAt)}, ${displaySize(b.sizeBytes)}, database level ${b.level})`,
  ];
  const l = s.live;
  if (l.state === 'missing') lines.push('Current:  no database yet');
  else if (l.state === 'unreadable') lines.push('Current:  cannot be read');
  else {
    const parts = [`database level ${l.level ?? '?'}`];
    parts.push(l.lastImportAt ? `last import ${displayDate(l.lastImportAt)}` : 'no import');
    parts.push(
      l.recordedMonths
        ? `${l.recordedMonths} recorded month${l.recordedMonths === 1 ? '' : 's'}, newest ${l.newestMonth ?? '?'}`
        : 'no recorded months',
    );
    lines.push(`Current:  ${parts.join('; ')}`);
  }
  lines.push(`App:      database level ${s.appLevel}`);
  const marker = {
    none: 'not set',
    set: 'set (the app appears to be running)',
    skipped: 'not checked (no readable current database)',
    forced: 'set, ignored (--force)',
  }[s.marker];
  lines.push(`Running marker: ${marker}`);
  return lines;
}

function print(io: RestoreCliIo, args: RestoreArgs, out: RestoreOutcome): void {
  if (args.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          exitCode: out.exitCode,
          summary: out.summary,
          preRestoreBackup: out.preRestoreBackup,
          unverifiedFolder: out.unverifiedFolder,
          messages: out.messages,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (out.summary) for (const line of summaryLines(out.summary)) io.stdout.write(`${line}\n`);
  const stream =
    out.exitCode === RESTORE_EXIT.restored || out.exitCode === RESTORE_EXIT.confirm
      ? io.stdout
      : io.stderr;
  for (const m of out.messages) stream.write(`${m}\n`);
}

/** Runs the CLI and returns the exit code (tests call this in-process). */
export function main(argv: string[], io: RestoreCliIo = defaultIo()): Promise<number> {
  try {
    return Promise.resolve(run(argv, io));
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

function run(argv: string[], io: RestoreCliIo): number {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr.write(`${args}\n${USAGE}\n`);
    return RESTORE_EXIT.usage;
  }
  if (args.help) {
    io.stdout.write(`${HELP}\n`);
    return RESTORE_EXIT.restored;
  }
  if (args.backup === null) {
    io.stderr.write(`Give the backup to restore\n${USAGE}\n`);
    return RESTORE_EXIT.usage;
  }
  let config;
  try {
    config = loadConfig(io.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      io.stderr.write(`${e.message}\n`);
      return RESTORE_EXIT.usage;
    }
    throw e;
  }
  const out = restoreBackup(config, {
    backup: args.backup,
    yes: args.yes,
    force: args.force,
    cwd: io.cwd,
    now: (io.now ?? (() => new Date()))(),
  });
  print(io, args, out);
  return out.exitCode;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
