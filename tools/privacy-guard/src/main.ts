// Command-line behaviour of the privacy guard, separate from cli.ts so tests can call it.
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gitTopLevel, hasHead } from './git';
import {
  collectStaged,
  collectWorkingTree,
  DEFAULT_TERMS_PATH,
  formatFinding,
  loadTerms,
  scanFiles,
} from './scan';

export const EXIT = { clean: 0, findings: 1, error: 2 } as const;

export interface CliIo {
  /** Normal output (the clean summary). */
  out(text: string): void;
  /** Findings, hints and errors. */
  err(text: string): void;
  cwd: string;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
};

export const USAGE = `Usage: privacy-guard (--staged | --all) [--terms <file>]

  --staged        scan the files staged for commit (content read from the index)
  --all           scan every tracked file plus untracked files that are not git-ignored
  --terms <file>  private terms file (default: ${DEFAULT_TERMS_PATH} in the repo root)

Exit codes: 0 clean, 1 findings, 2 internal error. This repo is PUBLIC.`;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export async function main(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let values: { staged?: boolean; all?: boolean; terms?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        staged: { type: 'boolean' },
        all: { type: 'boolean' },
        terms: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    io.err(`privacy-guard: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return EXIT.error;
  }
  if (values.help) {
    io.out(USAGE);
    return EXIT.clean;
  }
  if (Boolean(values.staged) === Boolean(values.all)) {
    io.err(`privacy-guard: pass exactly one of --staged or --all\n\n${USAGE}`);
    return EXIT.error;
  }
  const mode = values.staged ? 'staged' : 'all';

  try {
    const root = gitTopLevel(io.cwd);
    const termsPath = values.terms ? resolve(io.cwd, values.terms) : join(root, DEFAULT_TERMS_PATH);
    const terms = loadTerms(termsPath);
    if (!terms && values.terms) throw new Error(`terms file not found: ${values.terms}`);

    const files = mode === 'staged' ? await collectStaged(root) : collectWorkingTree(root);
    const result = scanFiles(files, terms);
    const scope = mode === 'staged' ? 'staged' : 'tracked and unignored';
    const termsNote = terms
      ? `${plural(terms.size, 'private term')}`
      : `no ${DEFAULT_TERMS_PATH}, private-term rule off`;

    if (result.findings.length === 0) {
      io.out(
        `privacy-guard: OK. ${plural(result.filesChecked, `${scope} file`)} checked ` +
          `(${result.contentSkipped} by path only; ${termsNote}).`,
      );
      return EXIT.clean;
    }

    for (const finding of result.findings) io.err(formatFinding(finding));
    const fileCount = new Set(result.findings.map((f) => f.path)).size;
    io.err(
      `\nprivacy-guard: ${plural(result.findings.length, 'finding')} in ` +
        `${plural(fileCount, 'file')}. This repo is PUBLIC.`,
    );
    if (mode === 'staged') {
      // `git restore --staged` needs HEAD, which does not exist before the first commit.
      const unstage = hasHead(root) ? 'git restore --staged <file>' : 'git rm --cached <file>';
      io.err(`Nothing was committed. Remove the value, or unstage with: ${unstage}`);
    } else {
      io.err(
        'Remove the value, or move the file to a git-ignored path (git rm --cached <file> if tracked).',
      );
    }
    return EXIT.findings;
  } catch (err) {
    io.err(`privacy-guard: internal error: ${err instanceof Error ? err.message : String(err)}`);
    if (mode === 'staged') io.err('The commit is blocked until the guard can run.');
    return EXIT.error;
  }
}
