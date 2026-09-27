// Path and content matchers for the privacy guard (stage-0.md §8). Pure: no I/O.
//
// Patterns that would match real-looking values are written regex-escaped (for example `:\/\/`),
// so this file passes its own scan.
import { isAllowedAbn, isAllowedEmail, isAllowedIpv4, isAllowedPhone } from './allowlist';

// ─── Paths ──────────────────────────────────────────────────────────────────────────────────────

export interface PathRule {
  /** Shown in findings, e.g. "docs/private/**". */
  pattern: string;
  test(segments: readonly string[], lowerPath: string): boolean;
}

const lastSegment = (segments: readonly string[]): string => segments[segments.length - 1] ?? '';

/** Blocked paths. Matching is case-insensitive on `/`-separated repo-relative paths. */
export const PATH_RULES: readonly PathRule[] = [
  {
    pattern: 'reference/** (except reference/brand/**)',
    test: (s) => s.length > 1 && s[0] === 'reference' && s[1] !== 'brand',
  },
  { pattern: 'docs/private/**', test: (s) => s[0] === 'docs' && s[1] === 'private' },
  { pattern: 'a "data" folder', test: (s) => s.slice(0, -1).includes('data') },
  {
    pattern: '**/fixtures/private/**',
    test: (s) =>
      s.some((seg, i) => seg === 'fixtures' && s[i + 1] === 'private' && i + 2 < s.length),
  },
  { pattern: '*.xlsx, *.xlsm, *.xls', test: (_s, p) => /\.xls[xm]?$/.test(p) },
  {
    // Also copies such as "finance.db.bak", "finance.db.2026-09-24" or "x.sqlite.old", but not
    // code or notes about a database ("schema.db.ts", "notes.db.md"). A renamed database is also
    // caught by its content (blockedContentType), whatever it is called.
    pattern: '*.db, *.db-*, *.db.*, *.sqlite, *.sqlite3, *.sqlite-*, *.sqlite*.*',
    test: (s) =>
      /\.(?:db|sqlite3?)(?:-[^/]*|\.(?!(?:md|ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$)[^/]+)?$/.test(
        lastSegment(s),
      ),
  },
  { pattern: '*.bak', test: (s) => /\.bak$/.test(lastSegment(s)) },
  {
    // A committed template (.env.example, .env.sample, .env.template) is allowed; its content is
    // still scanned like any other file.
    pattern: '.env, .env.*',
    test: (s) => {
      const name = lastSegment(s);
      return /^\.env(?:\..*)?$/.test(name) && !/^\.env\.(?:example|sample|template)$/.test(name);
    },
  },
];

/** Normalises a repo-relative path: forward slashes, no leading "./" or "/". */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');
}

/** The pattern that blocks `path`, or undefined when the path may be committed. */
export function blockedPathPattern(path: string): string | undefined {
  const lower = normalizePath(path).toLowerCase();
  const segments = lower.split('/').filter((s) => s !== '');
  return PATH_RULES.find((rule) => rule.test(segments, lower))?.pattern;
}

// ─── Content ────────────────────────────────────────────────────────────────────────────────────

export type ContentRuleId = 'ipv4' | 'email' | 'google-drive' | 'au-phone' | 'abn' | 'private-term';

export interface ContentMatch {
  rule: ContentRuleId;
  /** UTF-16 offset of the match in the text. */
  index: number;
  /** The matched text. Never print it for `private-term`. */
  value: string;
  /** For `private-term`: the 1-based line of the term in the terms file. */
  termLine?: number;
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** Four dotted octets; not part of a longer dotted number or an identifier ("v1.2.3.4"). */
const IPV4_RE = new RegExp(`(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?!\\w|\\.\\d)`, 'g');

const EMAIL_RE = /(?<![\w.%+-])[\w.%+-]+@(?:[A-Za-z0-9-]+\.)+([A-Za-z]{2,24})(?![A-Za-z0-9-])/g;
/** "logo@2x.png" is a file name, not an address. */
const FILE_EXTENSION_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'css', 'map', 'json', 'html', 'txt',
]); // prettier-ignore

const DRIVE_URL_RE =
  /https?:\/\/(?:(?:drive|docs|sheets|script)\.google\.com|(?:[A-Za-z0-9-]+\.)*googleusercontent\.com)\/[^\s"'`<>)\]]*/gi;
const DRIVE_ID_RE = /(?:\/d\/|\/folders\/|[?&]id=)[A-Za-z0-9_-]{20,}/g;

/** Not inside a word or a longer number, and not the fraction digits of a decimal ("1.0412…"). */
const AU_PHONE_RE = new RegExp(
  [
    '(?<![\\w+])(?<!\\d\\.)(?:',
    [
      '\\+61 ?4\\d{2} ?\\d{3} ?\\d{3}', // +61 4dd ddd ddd
      '04\\d{2} ?\\d{3} ?\\d{3}', // 04dd ddd ddd
      '\\+61 ?[2378] ?\\d{4} ?\\d{4}', // +61 d dddd dddd
      '\\(0[2378]\\) ?\\d{4} ?\\d{4}', // (0d) dddd dddd
      '0[2378] ?\\d{4} ?\\d{4}', // 0d dddd dddd
    ].join('|'),
    ')(?!\\w)',
  ].join(''),
  'g',
);

/** dd ddd ddd ddd, not inside a longer run of spaced numbers or a "+61 4dd ddd ddd" phone. */
const ABN_RE = /(?<![\w.,+])(?<!\d )\d{2} \d{3} \d{3} \d{3}(?!\w|[.,]\d| \d)/g;

function matchAll(re: RegExp, text: string, rule: ContentRuleId): ContentMatch[] {
  return [...text.matchAll(re)].map((m) => ({ rule, index: m.index, value: m[0] }));
}

function findDriveMatches(text: string): ContentMatch[] {
  const urls = matchAll(DRIVE_URL_RE, text, 'google-drive');
  const inUrl = (index: number) =>
    urls.some((u) => index >= u.index && index < u.index + u.value.length);
  const ids = matchAll(DRIVE_ID_RE, text, 'google-drive').filter((m) => !inUrl(m.index));
  return [...urls, ...ids];
}

/** Every rule except `private-term`, with allowlisted values removed. */
export function findPatternMatches(text: string): ContentMatch[] {
  const matches: ContentMatch[] = [
    ...matchAll(IPV4_RE, text, 'ipv4').filter((m) => !isAllowedIpv4(m.value)),
    ...[...text.matchAll(EMAIL_RE)]
      .filter((m) => !FILE_EXTENSION_TLDS.has((m[1] ?? '').toLowerCase()))
      .map((m): ContentMatch => ({ rule: 'email', index: m.index, value: m[0] }))
      .filter((m) => !isAllowedEmail(m.value)),
    ...findDriveMatches(text),
    ...matchAll(AU_PHONE_RE, text, 'au-phone').filter((m) => !isAllowedPhone(m.value)),
    ...matchAll(ABN_RE, text, 'abn').filter((m) => !isAllowedAbn(m.value)),
  ];
  return matches;
}

// ─── Private terms ──────────────────────────────────────────────────────────────────────────────

export interface PrivateTerm {
  term: string;
  /** 1-based line in the terms file; findings report this instead of the term. */
  line: number;
}

/** One term per line; blank lines and lines starting with `#` are ignored; whitespace trimmed. */
export function parseTerms(text: string): PrivateTerm[] {
  const terms: PrivateTerm[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const term = raw.trim();
    if (term !== '' && !term.startsWith('#')) terms.push({ term, line: i + 1 });
  });
  return terms;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A digits-only term (`12345678`, `-1234`, `123456.78`): these also match separator-written numbers. */
const DIGITS_ONLY_TERM_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Runs of digits written with separators (stage-6.md §8.2): a thousands grouping
 * (`12,345,678`, `123,456.78`) or a digit-separator run (`12_345_678`, `123_456.78`).
 * A run never starts inside a word, a longer number or a dotted/grouped run, and never ends
 * before more digits or another `,digit`, so a list (`1, 234`), a hex literal (`0x12_34`), a
 * version (`v1.2.3`) and a comma that does not group by thousands (`12,34,567`, `1,2345`) are
 * left alone. The two kinds have their own boundaries: a comma is a list separator next to an
 * underscore run (`[1,12_345_678]`, `7,12_345_678` in a CSV row), so only the grouping excludes
 * a neighbouring `,` / `,digit` (triage CODE-4).
 */
const SEPARATOR_RUN_RE =
  /(?<![A-Za-z0-9_.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![A-Za-z0-9_]|[,.]\d)|(?<![A-Za-z0-9_.])\d+(?:_\d+)+(?:\.\d+)?(?![A-Za-z0-9_]|\.\d)/g;

/** A term written with thousands commas (`4,321`, `12,345.67`): also matched in its other forms. */
const COMMA_GROUPED_TERM_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * The text with the `,`/`_` separators of every separator run removed, and for each character
 * of the result its offset in the original text (plus one entry for the end). Undefined when the
 * text has no separator run.
 */
export function normaliseSeparatorRuns(
  text: string,
): { text: string; offsets: number[] } | undefined {
  let out = '';
  const offsets: number[] = [];
  let last = 0;
  let changed = false;
  for (const m of text.matchAll(SEPARATOR_RUN_RE)) {
    for (let i = last; i < m.index; i++) offsets.push(i);
    out += text.slice(last, m.index);
    for (let i = 0; i < m[0].length; i++) {
      const c = m[0][i];
      if (c === ',' || c === '_') continue;
      out += c;
      offsets.push(m.index + i);
    }
    last = m.index + m[0].length;
    changed = true;
  }
  if (!changed) return undefined;
  for (let i = last; i < text.length; i++) offsets.push(i);
  out += text.slice(last);
  offsets.push(text.length);
  return { text: out, offsets };
}

const boundedAlternation = (terms: readonly string[]): RegExp | undefined => {
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return alternatives.length > 0
    ? new RegExp(`(?<![A-Za-z0-9_])(?:${alternatives.join('|')})(?![A-Za-z0-9_])`, 'g')
    : undefined;
};

/**
 * Case-sensitive, exact matching of private terms, bounded so a term never matches inside a
 * longer word: `(?<![A-Za-z0-9_])term(?![A-Za-z0-9_])`. Longer terms win when terms overlap.
 *
 * Digits-only terms also match numbers written with separators (stage-6.md §8.2): the separator
 * runs are normalised (their `,`/`_` removed) and matched against those terms with the same
 * boundaries; a hit is reported at its original location. A term written with thousands commas
 * (`4,321`) also matches its other separator forms (`4_321`), never its plain digits (`4321`: a
 * port or a year stays safe): only its comma-stripped form joins the separated pass, which keeps a
 * hit only when a separator was removed inside it (triage CODE-4).
 */
export class TermMatcher {
  readonly size: number;
  private readonly re: RegExp | undefined;
  private readonly digitsRe: RegExp | undefined;
  private readonly lineOf = new Map<string, number>();
  /** The separated pass's terms (digits-only terms, comma-stripped forms) → the term's line. */
  private readonly separatedLineOf = new Map<string, number>();

  constructor(terms: readonly PrivateTerm[]) {
    for (const { term, line } of terms) {
      if (!this.lineOf.has(term)) this.lineOf.set(term, line);
    }
    this.size = this.lineOf.size;
    const all = [...this.lineOf.keys()];
    this.re = boundedAlternation(all);
    for (const term of all) {
      if (DIGITS_ONLY_TERM_RE.test(term)) this.separatedLineOf.set(term, this.lineOf.get(term)!);
    }
    for (const term of all) {
      if (!COMMA_GROUPED_TERM_RE.test(term)) continue;
      const stripped = term.replaceAll(',', '');
      if (!this.separatedLineOf.has(stripped)) {
        this.separatedLineOf.set(stripped, this.lineOf.get(term)!);
      }
    }
    this.digitsRe = boundedAlternation([...this.separatedLineOf.keys()]);
  }

  static fromText(text: string): TermMatcher {
    return new TermMatcher(parseTerms(text));
  }

  find(text: string): ContentMatch[] {
    if (!this.re) return [];
    const exact = [...text.matchAll(this.re)].map((m) => ({
      rule: 'private-term' as const,
      index: m.index,
      value: m[0],
      termLine: this.lineOf.get(m[0]),
    }));
    // A separated hit where an exact one already is (a comma-written term as written): one finding.
    const seen = new Set(exact.map((m) => `${m.index}:${m.value.length}`));
    const separated = this.findSeparated(text).filter(
      (m) => !seen.has(`${m.index}:${m.value.length}`),
    );
    if (separated.length === 0) return exact;
    return [...exact, ...separated].sort((a, b) => a.index - b.index);
  }

  /** Digits-only terms found only once separators are removed (never a plain, exact hit again). */
  private findSeparated(text: string): ContentMatch[] {
    if (!this.digitsRe) return [];
    const normalised = normaliseSeparatorRuns(text);
    if (!normalised) return [];
    const { offsets } = normalised;
    const matches: ContentMatch[] = [];
    for (const m of normalised.text.matchAll(this.digitsRe)) {
      const start = offsets[m.index] ?? 0;
      const end = (offsets[m.index + m[0].length - 1] ?? start) + 1;
      // Same length as the match: no separator was removed inside it, so the exact matcher
      // already reported it (or it is not a term as written).
      if (end - start === m[0].length) continue;
      matches.push({
        rule: 'private-term',
        index: start,
        value: text.slice(start, end),
        termLine: this.separatedLineOf.get(m[0]),
      });
    }
    return matches;
  }
}

/** All content findings for `text`, in file order. */
export function findContentMatches(text: string, terms?: TermMatcher): ContentMatch[] {
  const matches = [...findPatternMatches(text), ...(terms?.find(text) ?? [])];
  return matches.sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
}

// ─── Reporting helpers ──────────────────────────────────────────────────────────────────────────

/** "10…(8 chars)": enough to find the value, not enough to leak it. */
export function maskValue(value: string): string {
  return `${Array.from(value).slice(0, 2).join('')}…(${value.length} char${value.length === 1 ? '' : 's'})`;
}

/** Maps a UTF-16 offset to a 1-based line and column. */
export function createLocator(text: string): (index: number) => { line: number; column: number } {
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - (lineStarts[lo] ?? 0) + 1 };
  };
}

// ─── What to scan ───────────────────────────────────────────────────────────────────────────────
//
// Content decides, not the file name: a database or workbook is blocked whatever it is called,
// an image is skipped only when its bytes are an image, and UTF-16 text is decoded and scanned.

/** Text up to this size is scanned in full. Larger text cannot be committed (a finding). */
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024;

/** For files over MAX_CONTENT_BYTES only this much is read, to sniff the type. */
export const HEAD_BYTES = 64 * 1024;

/** Files whose text is never scanned (hashes and URLs in the lockfile are not secrets). */
const SKIPPED_FILE_NAMES = new Set(['pnpm-lock.yaml']);

/** True for the lockfile, whose text is not scanned (its path and type still are). */
export function isLockfile(path: string): boolean {
  const name = (normalizePath(path).split('/').pop() ?? '').toLowerCase();
  return SKIPPED_FILE_NAMES.has(name);
}

function startsWithBytes(content: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (content.length < offset + bytes.length) return false;
  return bytes.every((b, i) => content[offset + i] === b);
}

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

function includesAscii(content: Uint8Array, text: string): boolean {
  const needle = ascii(text);
  const first = needle[0];
  for (let i = content.indexOf(first ?? 0); i !== -1; i = content.indexOf(first ?? 0, i + 1)) {
    if (startsWithBytes(content, needle, i)) return true;
  }
  return false;
}

const SQLITE_MAGIC = ascii('SQLite format 3\0');
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Data files that must never be committed, recognised by their bytes whatever their name
 * (e.g. "finance.db.bak", a workbook renamed to ".txt"). `content` may be just the file's head.
 */
export function blockedContentType(content: Uint8Array): string | undefined {
  if (startsWithBytes(content, SQLITE_MAGIC)) return 'SQLite database';
  if (startsWithBytes(content, ZIP_MAGIC)) {
    if (includesAscii(content, 'xl/workbook')) return 'Excel workbook';
    if (includesAscii(content, 'application/vnd.oasis.opendocument.spreadsheet')) {
      return 'OpenDocument spreadsheet';
    }
  }
  if (startsWithBytes(content, OLE_MAGIC)) return 'Office binary document (e.g. .xls)';
  return undefined;
}

/** Image and font signatures: these bytes are skipped as binary. */
const BINARY_SIGNATURES: readonly ((c: Uint8Array) => boolean)[] = [
  (c) => startsWithBytes(c, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG
  (c) => startsWithBytes(c, [0xff, 0xd8, 0xff]), // JPEG
  (c) => startsWithBytes(c, ascii('GIF87a')) || startsWithBytes(c, ascii('GIF89a')),
  (c) => startsWithBytes(c, ascii('RIFF')) && startsWithBytes(c, ascii('WEBP'), 8),
  (c) => startsWithBytes(c, ascii('ftyp'), 4), // AVIF / HEIC / MP4 family
  (c) => startsWithBytes(c, [0x00, 0x00, 0x01, 0x00]), // ICO
  (c) => startsWithBytes(c, ascii('wOFF')) || startsWithBytes(c, ascii('wOF2')),
  (c) => startsWithBytes(c, [0x00, 0x01, 0x00, 0x00]) || startsWithBytes(c, ascii('OTTO')),
];

/** A known image or font signature. */
export function hasBinarySignature(content: Uint8Array): boolean {
  return BINARY_SIGNATURES.some((matches) => matches(content));
}

/** A NUL byte in the first 8 KB means binary (after UTF-16 text has been ruled out). */
export function looksBinary(content: Uint8Array): boolean {
  return content.subarray(0, 8192).includes(0);
}

/**
 * The text to scan, or undefined for binary content. UTF-16 with a byte-order mark (Windows
 * PowerShell's `Out-File`, `.reg` exports) is decoded rather than mistaken for binary.
 */
export function decodeText(content: Uint8Array): string | undefined {
  if (startsWithBytes(content, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le').decode(content.subarray(2));
  }
  if (startsWithBytes(content, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be').decode(content.subarray(2));
  }
  if (hasBinarySignature(content) || looksBinary(content)) return undefined;
  return new TextDecoder('utf-8').decode(content);
}
