// `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--replace-app-data]
// [--corrections <file> | --no-corrections] [--json]` (stage-1.md §4.10). Imports a workbook
// export into DATA_DIR with the same importWorkbook() the upload route uses. A real import over
// app-entered data (origin 'app') needs --yes --replace-app-data (D34); the upload route
// refuses it.
//
// Exit codes: 0 succeeded with 0 unexplained · 4 succeeded with unexplained > 0 · 1 failed ·
// 2 usage/config/corrections error · 3 confirmation required.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findWorkbookInDir,
  importWorkbook,
  parseCorrectionsFile,
  resolveCorrectionsPath,
  type ImportResult,
} from '@joinr/importer';
import {
  CHECK_STATUSES,
  type CorrectionsFile,
  type CorrectionsSetting,
  type RecordEntityId,
} from '@joinr/schema';
import { ConfigError, loadConfig } from '../config';
import { backupBeforeImport } from '../db/backup';
import { closeDatabase, openDatabase, runMigrations } from '../db/database';
import { clearAppEditMarker, hasAppData, hasDomainData } from '../db/queries/domain';

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}

const defaultIo = (): CliIo => ({
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
});

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  confirm: 3,
  unexplained: 4,
} as const;

export const USAGE =
  'Usage: pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--replace-app-data] [--corrections <file> | --no-corrections] [--json]';

/** The exit-3 message when app-entered data exists and the override flags are missing (D34). */
export const APP_DATA_CONFIRM_MESSAGE =
  'This database holds data entered in the app; re-run with --yes --replace-app-data to replace it';

interface CliArgs {
  file: string | null;
  dryRun: boolean;
  yes: boolean;
  replaceAppData: boolean;
  corrections: string | null;
  noCorrections: boolean;
  json: boolean;
  help: boolean;
}

/** Parses the arguments, or returns an error message. */
export function parseArgs(argv: readonly string[]): CliArgs | string {
  const args: CliArgs = {
    file: null,
    dryRun: false,
    yes: false,
    replaceAppData: false,
    corrections: null,
    noCorrections: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case '--replace-app-data':
        args.replaceAppData = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--no-corrections':
        args.noCorrections = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--corrections': {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) return '--corrections needs a file';
        args.corrections = next;
        i++;
        break;
      }
      default:
        if (a.startsWith('--corrections=')) {
          args.corrections = a.slice('--corrections='.length);
          if (args.corrections === '') return '--corrections needs a file';
        } else if (a.startsWith('-')) {
          return `Unknown option ${a}`;
        } else if (args.file === null) {
          args.file = a;
        } else {
          return 'Give at most one workbook file';
        }
    }
  }
  if (args.corrections !== null && args.noCorrections) {
    return 'Use either --corrections <file> or --no-corrections, not both';
  }
  return args;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** `2026-09-24` → `24/09/2026`. */
const displayDate = (iso: string | null): string =>
  iso === null ? 'unknown' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const ENTITY_LABELS: Partial<Record<RecordEntityId, string>> = {
  instruments: 'instruments',
  trades: 'trades',
  dividends: 'dividends',
  'cash-accounts': 'cash accounts',
  'cash-balance-entries': 'cash balance entries',
  'budget-items': 'budget items',
  'yearly-expenses': 'yearly expenses',
  'income-streams': 'income streams',
  'side-income': 'side income deposits',
  'period-notes': 'period notes',
  snapshots: 'snapshots',
  'other-assets': 'other assets',
  'super-funds': 'super funds',
  'super-entries': 'super entries',
  properties: 'properties',
  loans: 'loans',
  settings: 'settings',
};

function printSummary(
  io: CliIo,
  result: ImportResult,
  fileName: string,
  corrections: { name: string; entries: number } | null,
): void {
  const out = (line = '') => io.stdout.write(`${line}\n`);
  if (result.status === 'failed' || result.report === null) {
    out(`Import of ${fileName} failed: ${result.error ?? 'unknown error'}`);
    out(`Run #${result.runId}. Nothing was changed.`);
    return;
  }
  const r = result.report;
  out(
    `${result.dryRun ? 'Dry run of' : 'Imported'} ${fileName} (as of ${displayDate(r.workbook.asOf)})`,
  );
  if (corrections) {
    out(
      `Corrections: ${corrections.name} (${r.corrections.applied} of ${r.corrections.entries} applied)`,
    );
  } else {
    out('Corrections: none');
  }
  const rows = Object.entries(r.counts)
    .map(([k, v]) => `${ENTITY_LABELS[k as RecordEntityId] ?? k} ${v}`)
    .join(', ');
  out(`Rows${result.dryRun ? ' (not saved)' : ''}: ${rows}`);
  out(`Checks: ${CHECK_STATUSES.map((s) => `${r.totals[s]} ${s}`).join(' · ')}`);
  for (const status of ['unexplained', 'suspect'] as const) {
    const lines = r.checks.filter((c) => c.status === status);
    if (lines.length === 0) continue;
    out(`${status === 'unexplained' ? 'Unexplained' : 'Suspect'}:`);
    for (const c of lines) out(`  - ${c.label}${c.sheetRef ? ` (${c.sheetRef})` : ''}`);
  }
  out(`Run #${result.runId}. Open /import in the app for the full report.`);
}

/** Runs the CLI and returns the exit code (tests call this in-process). */
export async function main(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const err = (line: string) => io.stderr.write(`${line}\n`);
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    err(args);
    err(USAGE);
    return EXIT.usage;
  }
  if (args.help) {
    io.stdout.write(`${USAGE}\n`);
    return EXIT.ok;
  }

  let config;
  try {
    config = loadConfig(io.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return EXIT.usage;
    }
    throw e;
  }

  // The workbook: the argument, else the single .xlsx in the checkout's reference/ folder.
  let path: string;
  if (args.file !== null) {
    path = isAbsolute(args.file) ? args.file : resolve(io.cwd, args.file);
  } else {
    if (config.repoRoot === null) {
      err('No workbook given and no repo checkout found; pass a path');
      err(USAGE);
      return EXIT.usage;
    }
    const found = findWorkbookInDir(join(config.repoRoot, 'reference'));
    if (found.kind === 'none') {
      err('No .xlsx in reference/; pass a path');
      err(USAGE);
      return EXIT.usage;
    }
    if (found.kind === 'multiple') {
      err(
        `Several .xlsx files in reference/ (${found.paths.map((p) => basename(p)).join(', ')}); pass a path`,
      );
      return EXIT.usage;
    }
    path = found.path;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    err(`Cannot read the workbook ${basename(path)}`);
    return EXIT.usage;
  }

  // Corrections: flags override the config (IMPORT_CORRECTIONS_FILE, default auto).
  const setting: CorrectionsSetting = args.noCorrections
    ? { kind: 'off' }
    : args.corrections !== null
      ? { kind: 'file', path: resolve(io.cwd, args.corrections) }
      : config.importCorrections;
  const correctionsPath = resolveCorrectionsPath({
    setting,
    dataDir: config.dataDir,
    repoRoot: config.repoRoot,
  });
  let corrections: CorrectionsFile | null = null;
  let source: { name: string; sha256: string } | null = null;
  if (correctionsPath !== null) {
    const name = basename(correctionsPath);
    let raw: Buffer;
    try {
      raw = readFileSync(correctionsPath);
    } catch {
      err(`Corrections file not found: ${name}`);
      return EXIT.usage;
    }
    try {
      corrections = parseCorrectionsFile(raw.toString('utf8'));
    } catch (e) {
      err(e instanceof Error ? e.message : 'Invalid corrections file');
      return EXIT.usage;
    }
    source = { name, sha256: sha256(raw) };
  }

  const database = openDatabase(config.dataDir);
  try {
    runMigrations(database, config.migrationsDir);
    const appData = hasAppData(database.db);
    if (appData && !args.dryRun && !(args.yes && args.replaceAppData)) {
      err(APP_DATA_CONFIRM_MESSAGE);
      return EXIT.confirm;
    }
    const hasData = hasDomainData(database.db);
    if (hasData && !args.dryRun && !args.yes) {
      err('This replaces the imported data; re-run with --yes');
      return EXIT.confirm;
    }
    if ((hasData || appData) && !args.dryRun) {
      const backup = backupBeforeImport(database, config.dataDir);
      if (!args.json) io.stdout.write(`Backup: backups/${basename(backup)}\n`);
    }
    const result = importWorkbook(database.db, {
      bytes,
      fileName: basename(path),
      trigger: 'cli',
      corrections,
      correctionsSource: source,
      dryRun: args.dryRun,
    });
    // A committed import replaced every app edit, so the D34 deletion marker goes too (§3.3).
    if (result.status === 'succeeded' && !result.dryRun) clearAppEditMarker(database.db);
    if (args.json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else
      printSummary(
        io,
        result,
        basename(path),
        source && corrections
          ? { name: source.name, entries: corrections.corrections.length }
          : null,
      );
    if (result.status === 'failed') return EXIT.failed;
    return (result.report?.totals.unexplained ?? 0) > 0 ? EXIT.unexplained : EXIT.ok;
  } finally {
    closeDatabase(database);
  }
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
