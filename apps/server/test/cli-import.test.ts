// `pnpm import:workbook` (stage-1.md §4.10): exit codes and output, in-process via main(argv),
// on temp DATA_DIRs with the synthetic workbook. Never the auto corrections fallback: every call
// passes --no-corrections, a synthetic corrections file, or IMPORT_CORRECTIONS_FILE=none.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportResult } from '@joinr/importer';
import { buildSyntheticWorkbook } from '@joinr/importer/testing';
import { cashAccounts } from '@joinr/schema/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_DATA_CONFIRM_MESSAGE,
  EXIT,
  main,
  parseArgs,
  USAGE,
  type CliIo,
} from '../src/cli/import';
import { closeDatabase, openDatabase } from '../src/db/database';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../src/cli/import.ts', import.meta.url));

let root: string;
let workbook: string;
let faulty: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'joinr-cli-'));
  workbook = join(root, 'synthetic.xlsx');
  writeFileSync(workbook, buildSyntheticWorkbook());
  faulty = join(root, 'faulty.xlsx');
  writeFileSync(faulty, buildSyntheticWorkbook({ variant: 'faulty' }));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
function freshDataDir(): string {
  seq += 1;
  return join(root, `data-${seq}`);
}

function run(argv: string[], env: Record<string, string> = {}, dataDir = freshDataDir()) {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    env: { NODE_ENV: 'test', DATA_DIR: dataDir, IMPORT_CORRECTIONS_FILE: 'none', ...env },
    cwd: root,
  };
  return main(argv, io).then((code) => ({ code, out, err, dataDir }));
}

/** Adds one app-entered row (origin 'app') to the database in `dataDir`. */
function addAppEnteredRow(dataDir: string): void {
  const database = openDatabase(dataDir);
  try {
    database.db
      .insert(cashAccounts)
      .values({ name: 'Example Bank', balanceCents: 0, sortOrder: 99, origin: 'app' })
      .run();
  } finally {
    closeDatabase(database);
  }
}

describe('parseArgs', () => {
  it('reads flags and one file', () => {
    expect(parseArgs(['a.xlsx', '--dry-run', '--yes', '--json'])).toMatchObject({
      file: 'a.xlsx',
      dryRun: true,
      yes: true,
      json: true,
    });
    expect(parseArgs(['--corrections', 'c.json'])).toMatchObject({ corrections: 'c.json' });
    expect(parseArgs(['--corrections=c.json'])).toMatchObject({ corrections: 'c.json' });
    expect(parseArgs(['--corrections'])).toBe('--corrections needs a file');
    expect(parseArgs(['--bogus'])).toBe('Unknown option --bogus');
    expect(parseArgs(['a.xlsx', 'b.xlsx'])).toBe('Give at most one workbook file');
    expect(parseArgs(['--corrections', 'c.json', '--no-corrections'])).toMatch(/either/);
  });
});

describe('pnpm import:workbook', { timeout: 30_000 }, () => {
  it('prints usage for --help and rejects bad arguments with exit 2', async () => {
    const help = await run(['--help']);
    expect(help.code).toBe(EXIT.ok);
    expect(help.out).toContain('pnpm import:workbook');
    expect(USAGE).not.toMatch(/pnpm import(?!:)/);
    const bad = await run(['--nope']);
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.err).toContain('Unknown option');
    const missing = await run([join(root, 'missing.xlsx'), '--no-corrections']);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.err).toContain('Cannot read the workbook missing.xlsx');
  });

  it('reports a configuration error with exit 2', async () => {
    const r = await run([workbook, '--no-corrections'], { PORT: 'not-a-port' });
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain('PORT');
  });

  it('imports into an empty DATA_DIR, then requires --yes to replace, then backs up', async () => {
    const dataDir = freshDataDir();
    const first = await run([workbook, '--no-corrections'], {}, dataDir);
    expect(first.code).toBe(EXIT.ok);
    expect(first.out).toContain('Imported synthetic.xlsx (as of 20/03/2026)');
    expect(first.out).toContain('Corrections: none');
    // Every count has a readable label (Stage 3: balance entries, side-income deposits).
    const rowsLine = first.out.split('\n').find((l) => l.startsWith('Rows: ')) ?? '';
    expect(rowsLine).toContain('cash balance entries ');
    expect(rowsLine).toContain('side income deposits ');
    expect(rowsLine).not.toContain('cash-balance-entries');
    expect(first.out).toMatch(
      /Checks: \d+ match · \d+ explained · 0 unexplained · 1 suspect · \d+ info/,
    );
    expect(first.out).toContain('Suspect:');
    expect(first.out).toContain('Run #1. Open /import in the app for the full report.');
    expect(existsSync(join(dataDir, 'finance.db'))).toBe(true);

    const again = await run([workbook, '--no-corrections'], {}, dataDir);
    expect(again.code).toBe(EXIT.confirm);
    expect(again.err).toContain('This replaces the imported data; re-run with --yes');

    const dry = await run([workbook, '--no-corrections', '--dry-run'], {}, dataDir);
    expect(dry.code).toBe(EXIT.ok);
    expect(dry.out).toContain('Dry run of synthetic.xlsx');
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);

    const yes = await run([workbook, '--no-corrections', '--yes'], {}, dataDir);
    expect(yes.code).toBe(EXIT.ok);
    expect(yes.out).toMatch(/Backup: backups\/pre-import-\d{8}-\d{6}(-\d+)?\.db/);
    expect(readdirSync(join(dataDir, 'backups'))).toHaveLength(1);
    expect(yes.out).toContain('Run #3.');
  });

  it('blocks a real import over app-entered data unless --yes --replace-app-data (D34)', async () => {
    const dataDir = freshDataDir();
    expect((await run([workbook, '--no-corrections'], {}, dataDir)).code).toBe(EXIT.ok);
    addAppEnteredRow(dataDir);

    for (const flags of [[], ['--yes'], ['--replace-app-data']]) {
      const refused = await run([workbook, '--no-corrections', ...flags], {}, dataDir);
      expect(refused.code).toBe(EXIT.confirm);
      expect(refused.err).toContain(
        'This database holds data entered in the app; re-run with --yes --replace-app-data to replace it',
      );
      expect(refused.err).toBe(`${APP_DATA_CONFIRM_MESSAGE}\n`);
    }
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);

    const dry = await run([workbook, '--no-corrections', '--dry-run'], {}, dataDir);
    expect(dry.code).toBe(EXIT.ok);
    expect(dry.out).toContain('Dry run of synthetic.xlsx');
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);

    const replaced = await run(
      [workbook, '--no-corrections', '--yes', '--replace-app-data'],
      {},
      dataDir,
    );
    expect(replaced.code).toBe(EXIT.ok);
    expect(replaced.out).toMatch(/Backup: backups\/pre-import-\d{8}-\d{6}(-\d+)?\.db/);
    expect(readdirSync(join(dataDir, 'backups'))).toHaveLength(1);
    expect(replaced.out).toContain('Run #3.');
  });

  it('accepts --replace-app-data when no app-entered data exists', async () => {
    const r = await run([workbook, '--no-corrections', '--replace-app-data']);
    expect(r.code).toBe(EXIT.ok);
    expect(parseArgs(['--replace-app-data'])).toMatchObject({ replaceAppData: true });
    expect(parseArgs([])).toMatchObject({ replaceAppData: false });
    expect(USAGE).toContain('[--replace-app-data]');
  });

  it('prints the ImportResult with --json', async () => {
    const r = await run([workbook, '--no-corrections', '--json']);
    expect(r.code).toBe(EXIT.ok);
    const result = JSON.parse(r.out) as ImportResult;
    expect(result).toMatchObject({ runId: 1, status: 'succeeded', dryRun: false, errorCode: null });
    expect(result.report?.totals.unexplained).toBe(0);
  });

  it('exits 4 when checks are unexplained', async () => {
    const r = await run([faulty, '--no-corrections']);
    expect(r.code).toBe(EXIT.unexplained);
    expect(r.out).toContain('Unexplained:');
  });

  it('exits 1 when the import fails', async () => {
    const notXlsx = join(root, 'not-a-workbook.xlsx');
    writeFileSync(notXlsx, 'hello');
    const r = await run([notXlsx, '--no-corrections']);
    expect(r.code).toBe(EXIT.failed);
    expect(r.out).toContain('Import of not-a-workbook.xlsx failed');
  });

  it('uses a corrections file from --corrections or IMPORT_CORRECTIONS_FILE', async () => {
    const file = join(root, 'synthetic-corrections.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        corrections: [
          {
            id: 'X1',
            target: 'trade',
            match: { sheet: 'Stocks', symbol: 'ASX:ZZZ', date: '2025-01-01' },
            action: 'skip',
            reason: 'Synthetic: matches nothing',
          },
        ],
      }),
    );
    const flag = await run([workbook, '--corrections', 'synthetic-corrections.json']);
    expect(flag.code).toBe(EXIT.unexplained);
    expect(flag.out).toContain('Corrections: synthetic-corrections.json (0 of 1 applied)');
    const env = await run([workbook], { IMPORT_CORRECTIONS_FILE: file });
    expect(env.code).toBe(EXIT.unexplained);
    expect(env.out).toContain('Corrections: synthetic-corrections.json');
    const off = await run([workbook]);
    expect(off.code).toBe(EXIT.ok);
    expect(off.out).toContain('Corrections: none');
  });

  it('rejects a missing or invalid corrections file with exit 2', async () => {
    const missing = await run([workbook, '--corrections', 'nope.json']);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.err).toContain('Corrections file not found: nope.json');
    const bad = join(root, 'bad-corrections.json');
    writeFileSync(bad, '{"version": 1');
    const invalid = await run([workbook, '--corrections', bad]);
    expect(invalid.code).toBe(EXIT.usage);
    expect(invalid.err).toContain('not valid JSON');
  });

  it('runs as a script through tsx', { timeout: 60_000 }, () => {
    const dataDir = freshDataDir();
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI_PATH, workbook, '--no-corrections', '--json'],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATA_DIR: dataDir,
          IMPORT_CORRECTIONS_FILE: 'none',
        },
        encoding: 'utf8',
        timeout: 55_000,
      },
    );
    expect(child.status).toBe(EXIT.ok);
    const result = JSON.parse(child.stdout) as ImportResult;
    expect(result.status).toBe('succeeded');
  });
});
