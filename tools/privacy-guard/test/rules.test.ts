import { describe, expect, it } from 'vitest';
import { isAllowedAbn, isAllowedEmail, isAllowedIpv4, isAllowedPhone } from '../src/allowlist';
import {
  blockedContentType,
  blockedPathPattern,
  createLocator,
  decodeText,
  findContentMatches,
  findPatternMatches,
  hasBinarySignature,
  isLockfile,
  looksBinary,
  maskValue,
  normalizePath,
  parseTerms,
  TermMatcher,
  type ContentRuleId,
} from '../src/rules';
import * as v from './values';

function rulesIn(text: string): ContentRuleId[] {
  return findPatternMatches(text).map((m) => m.rule);
}

function valuesFor(text: string, rule: ContentRuleId): string[] {
  return findPatternMatches(text)
    .filter((m) => m.rule === rule)
    .map((m) => m.value);
}

describe('path rules', () => {
  it.each([
    'reference/specs/01_core_engine.md',
    'reference/workbook.xlsx',
    'Reference/Dumps/Cash.txt',
    'docs/private/notes.md',
    'DOCS/Private/notes.md',
    'docs\\private\\notes.md',
    './docs/private/notes.md',
    'data/finance.db',
    'data/readme.md',
    'apps/server/data/seed.json',
    'Data/x.txt',
    'packages/importer/fixtures/private/sheet.json',
    'fixtures/private/a.json',
    'report.xlsx',
    'a/b/Book.XLSM',
    'old.xls',
    'finance.db',
    'finance.db-wal',
    'finance.db-shm',
    'x.sqlite',
    'x.sqlite3',
    'x.sqlite-journal',
    'finance.db.bak',
    'finance.db.2026-09-24',
    'x.sqlite.bak',
    'x.sqlite3.old',
    'notes.bak',
    '.env',
    'apps/web/.env.local',
    '.ENV.production',
  ])('blocks %s', (path) => {
    expect(blockedPathPattern(path)).toBeDefined();
  });

  it.each([
    'reference/brand/joinr_banner.webp',
    'reference/brand/joinr_wordmark.svg',
    'Reference/Brand/x.png',
    'docs/DECISIONS.md',
    'docs/privacy.md',
    'apps/server/src/db/database.ts',
    'packages/schema/src/metadata.ts',
    'src/data.ts',
    'src/reference/table.ts',
    'fixtures/private.json',
    'fixtures/public/a.json',
    'dbx.txt',
    'notes.db.md',
    'src/schema.db.ts',
    '.envrc',
    '.env-example.md',
    '.env.example',
    'apps/server/.env.sample',
    '.env.template',
    'README.md',
  ])('allows %s', (path) => {
    expect(blockedPathPattern(path)).toBeUndefined();
  });

  it('names the matching pattern', () => {
    expect(blockedPathPattern('docs/private/x.md')).toBe('docs/private/**');
    expect(blockedPathPattern('x/.env')).toBe('.env, .env.*');
  });

  it('normalises paths', () => {
    expect(normalizePath('.\\docs\\private\\x.md')).toBe('docs/private/x.md');
    expect(normalizePath('/a/b')).toBe('a/b');
  });
});

describe('ipv4', () => {
  it.each([v.PRIVATE_IP, v.CGNAT_IP, v.LAN_IP])('flags %s in context', (ip) => {
    expect(valuesFor(`host ${ip}`, 'ipv4')).toEqual([ip]);
    expect(valuesFor(`http://${ip}:3001/x`, 'ipv4')).toEqual([ip]);
    expect(valuesFor(`${ip}/24`, 'ipv4')).toEqual([ip]);
    expect(valuesFor(`at ${ip}.`, 'ipv4')).toEqual([ip]);
    expect(valuesFor(`\\\\${ip}\\share`, 'ipv4')).toEqual([ip]);
  });

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '255.255.255.255',
    '255.255.255.0',
    '192.0.2.10',
    '198.51.100.7',
    '203.0.113.99',
  ])('allows %s', (ip) => {
    expect(isAllowedIpv4(ip)).toBe(true);
    expect(rulesIn(`listen on ${ip}`)).toEqual([]);
  });

  it('ignores version strings, identifiers and out-of-range octets', () => {
    const ip = v.PRIVATE_IP;
    expect(rulesIn(`${ip}.5`)).toEqual([]); // a five-part version
    expect(rulesIn(`v${ip}`)).toEqual([]);
    expect(rulesIn(`${ip}x`)).toEqual([]);
    expect(rulesIn(['256', '1', '1', '1'].join('.'))).toEqual([]);
    expect(rulesIn(['1', '2', '3'].join('.'))).toEqual([]);
    expect(rulesIn(['10', '01', '2', '3'].join('.'))).toEqual([]); // zero-padded: not an address
    expect(rulesIn('24.13.6')).toEqual([]);
  });

  it('rejects non-IPv4 text in the allowlist check', () => {
    expect(isAllowedIpv4('1.2.3')).toBe(false);
    expect(isAllowedIpv4('300.0.0.1')).toBe(false);
  });
});

describe('email', () => {
  it('flags real-looking addresses', () => {
    expect(valuesFor(`Contact: ${v.EMAIL}.`, 'email')).toEqual([v.EMAIL]);
    expect(valuesFor(`<${v.EMAIL_UPPER}>`, 'email')).toEqual([v.EMAIL_UPPER]);
    expect(valuesFor(`mailto:${v.EMAIL}`, 'email')).toEqual([v.EMAIL]);
  });

  it.each([
    'user@example.com',
    'x@sub.example.org',
    'y@example.net',
    'a@b.example',
    'noreply@anthropic.com',
    'NoReply@Anthropic.com',
    '12345+someone@users.noreply.github.com',
    'git@github.com',
  ])('allows %s', (email) => {
    expect(isAllowedEmail(email)).toBe(true);
    expect(rulesIn(`see ${email} now`)).toEqual([]);
  });

  it('ignores package specs, decorators, CSS at-rules and retina file names', () => {
    for (const text of [
      '"packageManager": "pnpm@11.23.0"',
      "import { x } from '@joinr/ui';",
      'eslint@10.11.0',
      '@media (max-width: 767.98px)',
      'url(logo@2x.png)',
      'icon@3x.webp',
      'foo@bar',
      'git+ssh://git@github.com:org/repo.git',
    ]) {
      expect(rulesIn(text)).toEqual([]);
    }
  });
});

describe('google-drive', () => {
  it.each([v.DRIVE_DOC_URL, v.DRIVE_FOLDER_URL, v.DRIVE_OPEN_URL, v.USERCONTENT_URL, v.SCRIPT_URL])(
    'flags %s once',
    (url) => {
      expect(valuesFor(`link: ${url} end`, 'google-drive')).toEqual([url]);
    },
  );

  it('flags Drive-style ids in context without a URL', () => {
    expect(valuesFor(`/d/${v.DRIVE_ID}/edit`, 'google-drive')).toEqual([`/d/${v.DRIVE_ID}`]);
    expect(valuesFor(`x/folders/${v.DRIVE_ID}`, 'google-drive')).toHaveLength(1);
    expect(valuesFor(`?a=1&id=${v.DRIVE_ID}`, 'google-drive')).toHaveLength(1);
  });

  it('ignores bare host names, other Google pages and short ids', () => {
    expect(rulesIn('Export it from docs.google.com or drive.google.com.')).toEqual([]);
    expect(rulesIn('https://www.google.com/search?q=x')).toEqual([]);
    expect(rulesIn('/d/short-id')).toEqual([]);
    expect(rulesIn('https://example.com/?id=123')).toEqual([]);
  });
});

describe('au-phone', () => {
  it.each([
    v.MOBILE_SPACED,
    v.MOBILE_PLAIN,
    v.MOBILE_INTL,
    v.MOBILE_INTL_PLAIN,
    v.LANDLINE_PAREN,
    v.LANDLINE_SPACED,
    v.LANDLINE_PLAIN,
    v.LANDLINE_INTL,
  ])('flags %s (and nothing else)', (phone) => {
    expect(valuesFor(`Call ${phone} today`, 'au-phone')).toEqual([phone]);
    expect(rulesIn(`Call ${phone} today`)).toEqual(['au-phone']);
  });

  it('allows the placeholder number', () => {
    expect(isAllowedPhone('0400 000 000')).toBe(true);
    expect(rulesIn('Mobile 0400 000 000')).toEqual([]);
  });

  it('ignores longer numbers, decimals, identifiers and other prefixes', () => {
    expect(rulesIn(`1${v.MOBILE_PLAIN}`)).toEqual([]);
    expect(rulesIn(`${v.MOBILE_PLAIN}9`)).toEqual([]);
    expect(rulesIn(`1.${v.MOBILE_PLAIN}`)).toEqual([]);
    expect(rulesIn(`x${v.MOBILE_PLAIN}`)).toEqual([]);
    expect(rulesIn(['05', '12', '345', '678'].join(''))).toEqual([]);
  });
});

describe('abn', () => {
  it('flags the spaced ABN format', () => {
    expect(valuesFor(`ABN: ${v.ABN}`, 'abn')).toEqual([v.ABN]);
  });

  it('allows the placeholder and ignores longer runs of spaced numbers', () => {
    expect(isAllowedAbn('00 000 000 000')).toBe(true);
    expect(rulesIn('ABN 00 000 000 000')).toEqual([]);
    expect(rulesIn(`1 ${v.ABN}`)).toEqual([]);
    expect(rulesIn(`${v.ABN} 1`)).toEqual([]);
    expect(rulesIn(v.ABN.replace(/ /g, ''))).toEqual([]);
  });
});

describe('private terms', () => {
  const termsText = [
    '# comment line',
    '',
    '  Examplecorp  ',
    'ZZQ',
    'Foo Bar Baz',
    'Foo',
    'A+B (x)',
    'ZZQ',
    '\t# indented comment',
  ].join('\r\n');

  it('parses one trimmed term per line with its line number', () => {
    expect(parseTerms(termsText)).toEqual([
      { term: 'Examplecorp', line: 3 },
      { term: 'ZZQ', line: 4 },
      { term: 'Foo Bar Baz', line: 5 },
      { term: 'Foo', line: 6 },
      { term: 'A+B (x)', line: 7 },
      { term: 'ZZQ', line: 8 },
    ]);
  });

  const matcher = TermMatcher.fromText(termsText);
  const found = (text: string) => matcher.find(text).map((m) => [m.value, m.termLine]);

  it('counts distinct terms and reports the first line of a duplicate', () => {
    expect(matcher.size).toBe(5);
    expect(found('ZZQ')).toEqual([['ZZQ', 4]]);
  });

  it('matches exactly and case-sensitively', () => {
    expect(found('Examplecorp holds')).toEqual([['Examplecorp', 3]]);
    expect(found('examplecorp EXAMPLECORP')).toEqual([]);
  });

  it('respects word boundaries', () => {
    expect(found('Examplecorps XExamplecorp _Examplecorp Examplecorp_ Examplecorp2')).toEqual([]);
    expect(found('(Examplecorp). ASX:ZZQ ZZQ.AX "Foo"')).toEqual([
      ['Examplecorp', 3],
      ['ZZQ', 4],
      ['ZZQ', 4],
      ['Foo', 6],
    ]);
  });

  it('prefers the longest term and escapes regex characters', () => {
    expect(found('see Foo Bar Baz')).toEqual([['Foo Bar Baz', 5]]);
    expect(found('A+B (x) and AAB (x)')).toEqual([['A+B (x)', 7]]);
  });

  it('matches nothing when empty', () => {
    expect(new TermMatcher([]).find('anything')).toEqual([]);
    expect(TermMatcher.fromText('# only comments\n\n').size).toBe(0);
  });

  it('merges with the pattern rules in file order', () => {
    const matches = findContentMatches(`ZZQ at ${v.PRIVATE_IP} and Examplecorp`, matcher);
    expect(matches.map((m) => m.rule)).toEqual(['private-term', 'ipv4', 'private-term']);
  });
});

describe('reporting helpers', () => {
  it('masks values', () => {
    expect(maskValue(v.PRIVATE_IP)).toBe(`10…(${v.PRIVATE_IP.length} chars)`);
    expect(maskValue('x')).toBe('x…(1 char)');
  });

  it('locates offsets as 1-based line and column', () => {
    const text = 'ab\ncd\r\nef';
    const locate = createLocator(text);
    expect(locate(0)).toEqual({ line: 1, column: 1 });
    expect(locate(1)).toEqual({ line: 1, column: 2 });
    expect(locate(3)).toEqual({ line: 2, column: 1 });
    expect(locate(text.indexOf('f'))).toEqual({ line: 3, column: 2 });
  });
});

describe('what gets content-scanned', () => {
  it('recognises databases and spreadsheets by their bytes', () => {
    expect(blockedContentType(v.SAMPLE_HEADS.sqlite)).toBe('SQLite database');
    expect(blockedContentType(v.SAMPLE_HEADS.xlsx)).toBe('Excel workbook');
    expect(blockedContentType(v.SAMPLE_HEADS.ods)).toBe('OpenDocument spreadsheet');
    expect(blockedContentType(v.SAMPLE_HEADS.xls)).toMatch(/^Office binary document/);
    expect(blockedContentType(v.SAMPLE_HEADS.zip)).toBeUndefined(); // any other zip
    expect(blockedContentType(v.SAMPLE_HEADS.png)).toBeUndefined();
    expect(blockedContentType(Buffer.from('SQLite format 2 notes'))).toBeUndefined();
    expect(blockedContentType(Buffer.alloc(0))).toBeUndefined();
  });

  it('knows image and font signatures', () => {
    for (const key of ['png', 'jpeg', 'gif', 'webp', 'woff2'] as const) {
      expect(hasBinarySignature(v.SAMPLE_HEADS[key]), key).toBe(true);
    }
    expect(hasBinarySignature(Buffer.from('<svg xmlns="x"/>'))).toBe(false);
    expect(hasBinarySignature(Buffer.from('plain text'))).toBe(false);
  });

  it('decodes UTF-8 and UTF-16 (with a byte-order mark) text, and refuses binary', () => {
    const text = `host ${v.PRIVATE_IP}\n`;
    expect(decodeText(Buffer.from(text, 'utf8'))).toBe(text);
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeText(le)).toBe(text);
    const be = Buffer.from(Buffer.from(text, 'utf16le')).swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text);
    expect(decodeText(v.SAMPLE_HEADS.png)).toBeUndefined(); // signature, no NUL needed
    expect(decodeText(v.SAMPLE_HEADS.gif)).toBeUndefined();
    expect(decodeText(Buffer.from([0x50, 0x00, 0x51]))).toBeUndefined();
  });

  it('skips only the lockfile by name', () => {
    expect(isLockfile('pnpm-lock.yaml')).toBe(true);
    expect(isLockfile('apps/x/PNPM-LOCK.YAML')).toBe(true);
    expect(isLockfile('lock.yaml')).toBe(false);
    expect(isLockfile('a/logo.png')).toBe(false);
  });

  it('detects binary content by a NUL byte in the first 8 KB', () => {
    expect(looksBinary(Buffer.from('plain text'))).toBe(false);
    expect(looksBinary(Buffer.from([0x50, 0x00, 0x51]))).toBe(true);
    const lateNul = Buffer.alloc(9000, 0x41);
    lateNul[8500] = 0;
    expect(looksBinary(lateNul)).toBe(false);
  });
});
