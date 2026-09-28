// The read-only pin (stage-8.md §5.13): the copy only ever adds.
// (1) A source scan of apps/server/src/nascopy/** and packages/schema/src/nasCopy.ts, comments
//     stripped: no flag that deletes, mirrors, recurses, appends, writes in place, keeps a partial
//     file, reads a password file or runs a remote shell; process spawning only in runner.ts, with
//     shell: false and RSYNC_EXECUTABLE.
// (2) A behavioural pin: every argv handed to the runner, minus `--`, `--list-only`, the URL and
//     the source paths, equals RSYNC_FLAGS exactly. (copy.test.ts and service.test.ts check the same
//     on every call of their fake NAS; this file runs its own scenarios too.)
process.env.TZ = 'Australia/Melbourne';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RSYNC_EXECUTABLE, RSYNC_FLAGS, RSYNC_LIST_FLAG } from '../../src/nascopy/constants';
import { copyToNas } from '../../src/nascopy/copy';
import type { RsyncRunner } from '../../src/nascopy/runner';
import { makeTempDir, removeDir } from '../helpers';
import {
  FakeNas,
  localBackupsDir,
  PLANTED_SUB_URL,
  plantNasFiles,
  plantTypical,
  urlFile,
  writeSecret,
} from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = join(HERE, '..', '..', 'src', 'nascopy');
const SCHEMA_FILE = join(HERE, '..', '..', '..', '..', 'packages', 'schema', 'src', 'nasCopy.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Block comments first, then line comments (a `//` after `:` is part of `rsync://`, kept). */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** Long flags that are never allowed (a prefix match: `--del` covers every `--delete*`). */
const FORBIDDEN_LONG = [
  '--del',
  '--remove-source-files',
  // rsync's deprecated alias of --remove-source-files (it deletes the sent sources too).
  '--remove-sent',
  '--partial',
  '--inplace',
  '--append',
  '--backup',
  '--recursive',
  '--archive',
  '--links',
  '--copy-links',
  '--password-file',
  '--rsh',
  '--daemon',
  '--mkpath',
  '--ignore-existing',
];
/** A quoted short-flag cluster containing -r, -a, -L or -e. */
const FORBIDDEN_SHORT = /['"`]-[A-Za-z]*[raLe][A-Za-z]*['"`]/;
const SPAWN_CALL = /(?<![.\w])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/;

function findings(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  for (const flag of FORBIDDEN_LONG) if (code.includes(flag)) out.push(flag);
  const short = FORBIDDEN_SHORT.exec(code);
  if (short) out.push(short[0]);
  return out;
}

describe('(1) the source scan', () => {
  const files = [...walk(SERVER_SRC), SCHEMA_FILE];

  it('scans every nascopy source and the schema module', () => {
    const names = files.map((f) =>
      relative(join(HERE, '..', '..', '..', '..'), f).replace(/\\/g, '/'),
    );
    for (const expected of [
      'apps/server/src/nascopy/copy.ts',
      'apps/server/src/nascopy/runner.ts',
      'apps/server/src/nascopy/service.ts',
      'packages/schema/src/nasCopy.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('finds no forbidden rsync flag anywhere', () => {
    for (const file of files) expect(findings(readFileSync(file, 'utf8')), file).toEqual([]);
  });

  it('spawns processes only in runner.ts, with shell: false and RSYNC_EXECUTABLE', () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const isRunner = file.endsWith(join('nascopy', 'runner.ts'));
      if (!isRunner) {
        expect(SPAWN_CALL.test(code), file).toBe(false);
        expect(code.includes('child_process'), file).toBe(false);
      }
    }
    const runner = stripComments(readFileSync(join(SERVER_SRC, 'runner.ts'), 'utf8'));
    expect(runner).toMatch(/spawnImpl\(RSYNC_EXECUTABLE,/);
    expect(runner).toMatch(/shell: false/);
    expect(runner).not.toMatch(/shell: true/);
    expect(runner).not.toMatch(/\.\.\.process\.env/);
    // The one spawn: node's, as the default of the test-only seam, called through it.
    expect(runner).toMatch(/import { spawn, [^}]*} from 'node:child_process'/);
    expect(runner).toMatch(/spawnImpl: SpawnImpl = spawn,/);
    expect(runner.match(new RegExp(SPAWN_CALL.source, 'g')) ?? []).toEqual([]);
  });

  it('the scanner itself catches what it must (a self-check)', () => {
    expect(findings(`const f = ['--delete-after'];`)).toEqual(['--del']);
    expect(findings(`args.push('-av')`)).toEqual(["'-av'"]);
    expect(findings(`x = "-e"`)).toEqual(['"-e"']);
    expect(findings(`const f = ['--remove-sent-files'];`)).toEqual(['--remove-sent']);
    expect(findings(`x = \`--partial-dir=.p\``)).toEqual(['--partial']);
    expect(findings(`// --delete in a comment\n/* --inplace */ const ok = 1;`)).toEqual([]);
    expect(findings(`const u = 'rsync://h/m'; // --delete`)).toEqual([]);
    expect(SPAWN_CALL.test('re.exec(text)')).toBe(false);
    expect(SPAWN_CALL.test('spawn (x)')).toBe(true);
  });

  it('pins the frozen flags and the executable', () => {
    expect([...RSYNC_FLAGS]).toEqual(['--times', '--contimeout=10', '--timeout=120']);
    expect(RSYNC_LIST_FLAG).toBe('--list-only');
    expect(RSYNC_EXECUTABLE).toBe('rsync');
  });
});

describe('(2) the behavioural pin', () => {
  let dataDir: string;
  const seen: string[][] = [];

  beforeEach(async () => {
    dataDir = await makeTempDir('joinr-nas-pin-test-');
    plantNasFiles(dataDir);
    plantTypical(dataDir);
  });

  afterEach(async () => {
    await removeDir(dataDir);
  });

  const recording =
    (nas: FakeNas): RsyncRunner =>
    (args, opts) => {
      seen.push([...args]);
      return nas.runner(args, opts);
    };

  function stripped(args: readonly string[]): string[] {
    const dir = localBackupsDir(dataDir);
    return args.filter(
      (a) => a !== '--' && a !== RSYNC_LIST_FLAG && !a.startsWith('rsync://') && dirname(a) !== dir,
    );
  }

  it('every argv of every scenario is RSYNC_FLAGS plus the fixed parts', async () => {
    const scenarios: Array<(nas: FakeNas) => void> = [
      () => {},
      (nas) => nas.hold([]),
      (nas) => {
        nas.steps[1] = { code: 23 };
      },
      (nas) => {
        nas.steps[0] = { code: 5, err: 'auth failed' };
      },
      (nas) => {
        nas.steps[1] = { code: 24 };
        nas.steps[2] = { code: 23 };
      },
      () => writeSecret(urlFile(dataDir), `${PLANTED_SUB_URL}\n`),
    ];
    for (const prepare of scenarios) {
      const nas = new FakeNas(dataDir);
      prepare(nas);
      await copyToNas({ dataDir, signal: new AbortController().signal, runner: recording(nas) });
      expect(nas.violations).toEqual([]);
    }
    expect(seen.length).toBeGreaterThanOrEqual(10);
    for (const args of seen) expect(stripped(args)).toEqual([...RSYNC_FLAGS]);
  });
});
