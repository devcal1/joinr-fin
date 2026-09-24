import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, main, USAGE } from '../src/main';
import { MAX_CONTENT_BYTES } from '../src/rules';
import { TempRepo } from './temp-repo';
import * as v from './values';

interface Captured {
  code: number;
  out: string;
  err: string;
}

async function run(argv: string[], cwd: string): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t), cwd });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

let repo: TempRepo;

beforeEach(() => {
  repo = TempRepo.create();
});

afterEach(() => {
  repo.remove();
});

describe('arguments', () => {
  it.each([[[]], [['--staged', '--all']], [['--nope']], [['--staged', 'extra']]])(
    'rejects %j with exit 2 and the usage',
    async (argv) => {
      const result = await run(argv, repo.root);
      expect(result.code).toBe(EXIT.error);
      expect(result.err).toContain('Usage: privacy-guard');
    },
  );

  it('prints the usage for --help', async () => {
    const result = await run(['--help'], repo.root);
    expect(result.code).toBe(EXIT.clean);
    expect(result.out).toBe(USAGE);
  });

  it('exits 2 outside a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'joinr-guard-nogit-'));
    try {
      const result = await run(['--all'], plain);
      expect(result.code).toBe(EXIT.error);
      expect(result.err).toContain('internal error');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('exits 2 when an explicit terms file is missing', async () => {
    const result = await run(['--all', '--terms', 'no-such-terms.txt'], repo.root);
    expect(result.code).toBe(EXIT.error);
    expect(result.err).toContain('terms file not found');
  });
});

describe('--staged', () => {
  it('passes when nothing is staged', async () => {
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.clean);
    expect(result.out).toMatch(/^privacy-guard: OK\. 0 staged files checked/);
  });

  it('blocks a staged leak and explains how to unstage', async () => {
    repo.write('notes.md', `# Notes\nNAS at ${v.PRIVATE_IP}\n`);
    repo.git('add', 'notes.md');
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain(`notes.md:2:8  ipv4  10…(${v.PRIVATE_IP.length} chars)`);
    expect(result.err).toContain('1 finding in 1 file');
    expect(result.err).not.toContain(v.PRIVATE_IP);
  });

  it('suggests an unstage command that works before and after the first commit', async () => {
    repo.write('leak.md', `mail ${v.EMAIL}\n`);
    repo.git('add', 'leak.md');
    const unborn = await run(['--staged'], repo.root);
    expect(unborn.err).toContain('unstage with: git rm --cached <file>');
    expect(repo.run('git', ['rm', '-q', '--cached', 'leak.md']).status).toBe(0);

    repo.write('README.md', 'clean\n');
    repo.git('add', 'README.md');
    repo.git('commit', '-q', '-m', 'first');
    repo.git('add', 'leak.md');
    const born = await run(['--staged'], repo.root);
    expect(born.err).toContain('unstage with: git restore --staged <file>');
    expect(repo.run('git', ['restore', '--staged', 'leak.md']).status).toBe(0);
    expect((await run(['--staged'], repo.root)).code).toBe(EXIT.clean);
  });

  it('reads content from the index, not the working tree', async () => {
    repo.write('a.md', `mail ${v.EMAIL}\n`);
    repo.git('add', 'a.md');
    repo.write('a.md', 'fixed in the working tree but not staged\n');
    expect((await run(['--staged'], repo.root)).code).toBe(EXIT.findings);

    repo.write('b.md', 'clean\n');
    repo.git('add', 'b.md');
    repo.git('rm', '-q', '-f', '--cached', 'a.md');
    repo.write('b.md', `leak added after staging ${v.EMAIL}\n`);
    expect((await run(['--staged'], repo.root)).code).toBe(EXIT.clean);
  });

  it('blocks private paths, including forced adds of ignored files and renames', async () => {
    repo.write('.gitignore', 'docs/private/\n');
    repo.write('docs/private/notes.md', 'test\n');
    repo.git('add', '-f', 'docs/private/notes.md');
    const forced = await run(['--staged'], repo.root);
    expect(forced.code).toBe(EXIT.findings);
    expect(forced.err).toContain('docs/private/notes.md  blocked-path  docs/private/**');

    repo.git('rm', '-q', '--cached', 'docs/private/notes.md');
    repo.write('export.xlsx', 'not really a workbook');
    repo.git('add', 'export.xlsx');
    expect((await run(['--staged'], repo.root)).err).toContain('export.xlsx  blocked-path');
  });

  it('skips binary and lockfile content but still checks their paths', async () => {
    repo.write('image.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(v.PRIVATE_IP)]));
    repo.write('pnpm-lock.yaml', `resolution: ${v.EMAIL}\n`);
    repo.git('add', 'image.bin', 'pnpm-lock.yaml');
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.clean);
    expect(result.out).toContain('2 staged files checked (2 by path only');
  });

  it('blocks a renamed database and scans UTF-16 and mislabelled text from the index', async () => {
    repo.write('backup/finance.old', Buffer.concat([v.SAMPLE_HEADS.sqlite, Buffer.alloc(4096)]));
    repo.write('notes.png', `host ${v.PRIVATE_IP}\n`);
    repo.write(
      'u16.txt',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(v.EMAIL, 'utf16le')]),
    );
    repo.write('finance.db.bak', 'x');
    repo.git('add', 'backup/finance.old', 'notes.png', 'u16.txt');
    repo.git('add', '-f', 'finance.db.bak');
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain('backup/finance.old  blocked-type  SQLite database');
    expect(result.err).toContain('notes.png:1:6  ipv4');
    expect(result.err).toContain('u16.txt:1:1  email');
    expect(result.err).toContain('finance.db.bak  blocked-path');
  });

  it('reads only the head of a huge staged file, and reports huge text', async () => {
    const filler = 'a,b,c\n'.repeat(Math.ceil((MAX_CONTENT_BYTES + 1024) / 6));
    repo.write('big.csv', `${filler}${v.PRIVATE_IP},1\n`);
    repo.git('add', 'big.csv');
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toMatch(/big\.csv {2}too-large {2}16\.\d MB of text/);
  });

  it('ignores staged deletions', async () => {
    repo.write('old.md', 'clean\n');
    repo.git('add', 'old.md');
    repo.git('commit', '-q', '-m', 'add');
    repo.git('rm', '-q', 'old.md');
    const result = await run(['--staged'], repo.root);
    expect(result.code).toBe(EXIT.clean);
    expect(result.out).toContain('0 staged files checked');
  });
});

describe('--all', () => {
  it('scans tracked and untracked files but not ignored ones', async () => {
    repo.write('.gitignore', 'ignored/\n');
    repo.write('ignored/secret.md', `host ${v.PRIVATE_IP}\n`);
    repo.write('tracked.md', 'clean\n');
    repo.git('add', '.gitignore', 'tracked.md');
    expect((await run(['--all'], repo.root)).code).toBe(EXIT.clean);

    repo.write('loose.md', `write to ${v.EMAIL}\n`);
    const result = await run(['--all'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain('loose.md:1:10  email');
    expect(result.err).toContain('git-ignored path');
  });

  it('sniffs a huge working-tree file from its head (a renamed database)', async () => {
    repo.write(
      'db.old',
      Buffer.concat([v.SAMPLE_HEADS.sqlite, Buffer.alloc(MAX_CONTENT_BYTES + 10)]),
    );
    const result = await run(['--all'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain('db.old  blocked-type  SQLite database');
  });

  it('flags a tracked .env even after it is added to .gitignore', async () => {
    repo.write('.env', 'API_KEY=placeholder\n');
    repo.git('add', '.env');
    repo.git('commit', '-q', '-m', 'oops');
    repo.write('.gitignore', '.env\n');
    const result = await run(['--all'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain('.env  blocked-path  .env, .env.*');
  });
});

describe('private terms', () => {
  it('uses docs/private/guard-terms.txt by default and never prints the term', async () => {
    repo.write('.gitignore', 'docs/private/\n');
    repo.write('docs/private/guard-terms.txt', '# private\nExamplecorp\n');
    repo.write('README.md', 'Built for Examplecorp.\n');
    const result = await run(['--all'], repo.root);
    expect(result.code).toBe(EXIT.findings);
    expect(result.err).toContain('README.md:1:11  private-term #2');
    expect(result.err).not.toContain('Examplecorp');
    expect(result.out).not.toContain('Examplecorp');
  });

  it('reports the terms count, or that the rule is off', async () => {
    repo.write('README.md', 'clean\n');
    const off = await run(['--all'], repo.root);
    expect(off.out).toContain('private-term rule off');

    const termsDir = mkdtempSync(join(tmpdir(), 'joinr-guard-terms-'));
    try {
      const termsFile = join(termsDir, 'terms.txt');
      writeFileSync(termsFile, 'Examplecorp\nZZQ\n');
      const on = await run(['--all', '--terms', termsFile], repo.root);
      expect(on.code).toBe(EXIT.clean);
      expect(on.out).toContain('2 private terms');

      // A byte-order mark (e.g. saved from Notepad) must not hide the first term.
      writeFileSync(termsFile, '﻿clean\n');
      const bom = await run(['--all', '--terms', termsFile], repo.root);
      expect(bom.code).toBe(EXIT.findings);
      expect(bom.err).toContain('README.md:1:1  private-term #1');
    } finally {
      rmSync(termsDir, { recursive: true, force: true });
    }
  });
});
