// Runs the rules over a set of files and formats the findings.
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { listAllPaths, listStagedPaths, readIndexBlobs } from './git';
import {
  blockedContentType,
  blockedPathPattern,
  createLocator,
  decodeText,
  findContentMatches,
  HEAD_BYTES,
  isLockfile,
  MAX_CONTENT_BYTES,
  maskValue,
  TermMatcher,
  type ContentRuleId,
} from './rules';

export interface FileToScan {
  /** Repo-relative, `/`-separated. */
  path: string;
  size: number;
  /**
   * Undefined when there is nothing to read (deleted, or a blocked path). For a file larger than
   * MAX_CONTENT_BYTES it holds only the first HEAD_BYTES, enough to recognise its type.
   */
  content: Buffer | undefined;
}

export type Finding =
  | { kind: 'path'; path: string; rule: 'blocked-path'; pattern: string }
  /** A database or spreadsheet recognised by its bytes, whatever the file is called. */
  | { kind: 'type'; path: string; rule: 'blocked-type'; type: string }
  /** Text too large to scan; it cannot be committed unscanned. */
  | { kind: 'size'; path: string; rule: 'too-large'; size: number }
  | {
      kind: 'content';
      path: string;
      rule: ContentRuleId;
      line: number;
      column: number;
      /** Masked value; empty for private terms, which report `termLine` instead. */
      masked: string;
      termLine?: number;
    };

export interface ScanResult {
  findings: Finding[];
  filesChecked: number;
  /** Files whose path was checked but whose text was not (binary, lockfile, blocked, deleted). */
  contentSkipped: number;
}

/**
 * Checks one file: its path always; then its type from its bytes (a database or a workbook is
 * blocked whatever its name); then its text, unless it is binary (an image or font signature, or
 * a NUL byte) or the lockfile. UTF-16 text is decoded and scanned. Text over MAX_CONTENT_BYTES
 * is a finding, never a silent skip.
 */
export function scanFile(
  file: FileToScan,
  terms?: TermMatcher,
): { findings: Finding[]; contentScanned: boolean } {
  const pattern = blockedPathPattern(file.path);
  if (pattern) {
    // The whole file is blocked, so its content adds nothing but noise.
    return {
      findings: [{ kind: 'path', path: file.path, rule: 'blocked-path', pattern }],
      contentScanned: false,
    };
  }
  const { content } = file;
  const skipped = { findings: [], contentScanned: false };
  if (!content) return skipped;

  const type = blockedContentType(content);
  if (type) {
    return {
      findings: [{ kind: 'type', path: file.path, rule: 'blocked-type', type }],
      contentScanned: false,
    };
  }
  if (isLockfile(file.path)) return skipped;

  const text = decodeText(content);
  if (text === undefined) return skipped; // binary
  if (file.size > MAX_CONTENT_BYTES) {
    return {
      findings: [{ kind: 'size', path: file.path, rule: 'too-large', size: file.size }],
      contentScanned: false,
    };
  }

  const matches = findContentMatches(text, terms);
  if (matches.length === 0) return { findings: [], contentScanned: true };

  const locate = createLocator(text);
  const findings = matches.map((m): Finding => {
    const { line, column } = locate(m.index);
    return m.rule === 'private-term'
      ? {
          kind: 'content',
          path: file.path,
          rule: m.rule,
          line,
          column,
          masked: '',
          termLine: m.termLine,
        }
      : {
          kind: 'content',
          path: file.path,
          rule: m.rule,
          line,
          column,
          masked: maskValue(m.value),
        };
  });
  return { findings, contentScanned: true };
}

export function scanFiles(files: Iterable<FileToScan>, terms?: TermMatcher): ScanResult {
  const findings: Finding[] = [];
  let filesChecked = 0;
  let contentSkipped = 0;
  for (const file of files) {
    filesChecked++;
    const result = scanFile(file, terms);
    findings.push(...result.findings);
    if (!result.contentScanned) contentSkipped++;
  }
  return { findings, filesChecked, contentSkipped };
}

/** `file:line:col  rule  masked`, `file:line:col  private-term #N` or `file  blocked-path  pattern`. */
export function formatFinding(finding: Finding): string {
  if (finding.kind === 'path') return `${finding.path}  blocked-path  ${finding.pattern}`;
  if (finding.kind === 'type') return `${finding.path}  blocked-type  ${finding.type}`;
  if (finding.kind === 'size') {
    const mb = (finding.size / (1024 * 1024)).toFixed(1);
    const limit = MAX_CONTENT_BYTES / (1024 * 1024);
    return `${finding.path}  too-large  ${mb} MB of text (the guard scans up to ${limit} MB)`;
  }
  const where = `${finding.path}:${finding.line}:${finding.column}`;
  if (finding.rule === 'private-term') return `${where}  private-term #${finding.termLine ?? '?'}`;
  return `${where}  ${finding.rule}  ${finding.masked}`;
}

// ─── Collecting files ───────────────────────────────────────────────────────────────────────────

/** How much of a file to read: nothing for a blocked path, the head of a huge file, else all. */
export function bytesToRead(path: string, size: number): number {
  if (blockedPathPattern(path)) return 0;
  return size > MAX_CONTENT_BYTES ? HEAD_BYTES : size;
}

/** Staged files, with content read from the index (what would actually be committed). */
export async function collectStaged(root: string): Promise<FileToScan[]> {
  const paths = listStagedPaths(root);
  const blobs = await readIndexBlobs(root, paths, (path, size) =>
    blockedPathPattern(path) ? -1 : bytesToRead(path, size),
  );
  return paths.map((path) => {
    const blob = blobs.get(path);
    return { path, size: blob?.size ?? 0, content: blob?.content };
  });
}

function readWorkingFile(root: string, path: string): FileToScan {
  const absolute = join(root, path);
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    return { path, size: 0, content: undefined }; // tracked but deleted from the working tree
  }
  if (stats.isSymbolicLink()) {
    // git stores a symlink as its target text; scan that.
    const target = Buffer.from(readlinkSync(absolute).replace(/\\/g, '/'), 'utf8');
    return { path, size: target.length, content: target };
  }
  if (!stats.isFile()) return { path, size: 0, content: undefined };
  if (blockedPathPattern(path)) return { path, size: stats.size, content: undefined };
  const want = bytesToRead(path, stats.size);
  if (want >= stats.size) return { path, size: stats.size, content: readFileSync(absolute) };
  const head = Buffer.alloc(want);
  const fd = openSync(absolute, 'r');
  try {
    const read = readSync(fd, head, 0, want, 0);
    return { path, size: stats.size, content: head.subarray(0, read) };
  } finally {
    closeSync(fd);
  }
}

/** Every tracked file plus untracked, non-ignored files, with working-tree content. */
export function collectWorkingTree(root: string): FileToScan[] {
  return listAllPaths(root).map((path) => readWorkingFile(root, path));
}

// ─── Private terms ──────────────────────────────────────────────────────────────────────────────

/** The git-ignored terms file, relative to the repo root. */
export const DEFAULT_TERMS_PATH = 'docs/private/guard-terms.txt';

/** Loads a terms file; undefined when it does not exist. */
export function loadTerms(path: string): TermMatcher | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  return TermMatcher.fromText(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // drop a BOM
}
