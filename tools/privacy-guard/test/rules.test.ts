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
  normaliseSeparatorRuns,
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

describe('private terms written with separators (stage-6.md §8.2)', () => {
  // Generic terms only: a digits-only integer, a digits-only decimal, a negative, a term that
  // itself contains a separator, and a word.
  const matcher = TermMatcher.fromText(
    ['12345678', '123456.78', '-7654321', '4,321', '98_765', 'Examplecorp', '2468'].join('\n'),
  );
  const found = (text: string) => matcher.find(text).map((m) => [m.value, m.termLine, m.index]);
  const lines = (text: string) => matcher.find(text).map((m) => m.termLine);

  it('catches a digits-only term written with thousands commas or digit separators', () => {
    expect(found('total 12,345,678 here')).toEqual([['12,345,678', 1, 6]]);
    expect(found('const x = 12_345_678;')).toEqual([['12_345_678', 1, 10]]);
    expect(found('$12,345,678.00')).toEqual([['12,345,678', 1, 1]]);
    expect(found('(12,345,678)')).toEqual([['12,345,678', 1, 1]]);
    expect(lines('12_34_5678')).toEqual([1]);
  });

  it('catches a digits-only decimal term written with separators', () => {
    expect(found('$123,456.78 left')).toEqual([['123,456.78', 2, 1]]);
    expect(found('amount: 123_456.78,')).toEqual([['123_456.78', 2, 8]]);
    expect(found('123,456.789')).toEqual([]);
  });

  it('catches a negative term with its sign', () => {
    expect(found('balance -7,654,321')).toEqual([['-7,654,321', 3, 8]]);
    expect(found('-7_654_321')).toEqual([['-7_654_321', 3, 0]]);
    // The plain digits are not the negative term (as the exact matcher).
    expect(found('7,654,321')).toEqual([]);
  });

  it('keeps reporting plain, exact matches once (no duplicate from the normalised text)', () => {
    expect(found('12345678 and 12,345,678')).toEqual([
      ['12345678', 1, 0],
      ['12,345,678', 1, 13],
    ]);
    expect(found('Examplecorp 2468 1,234')).toEqual([
      ['Examplecorp', 6, 0],
      ['2468', 7, 12],
    ]);
  });

  it('matches a comma-written term in its separator forms, never its plain digits (CODE-4)', () => {
    expect(found('4,321')).toEqual([['4,321', 4, 0]]);
    expect(found('PORT=4321 in 4321')).toEqual([]);
    expect(found('4_321')).toEqual([['4_321', 4, 0]]);
    expect(found('98_765 and 98765 and 98,765')).toEqual([['98_765', 5, 0]]);
  });

  it('catches an underscore run next to a list or CSV comma (triage CODE-4)', () => {
    expect(found('[1,12_345_678]')).toEqual([['12_345_678', 1, 3]]);
    expect(found('[12_345_678,1]')).toEqual([['12_345_678', 1, 1]]);
    expect(found('id,amount\n7,12_345_678')).toEqual([['12_345_678', 1, 12]]);
    expect(found('7,12_345_678')).toEqual([['12_345_678', 1, 2]]);
    // Hex literals and longer numbers stay safe.
    expect(found('0x12_34')).toEqual([]);
    expect(found('9_12_345_678')).toEqual([]);
  });

  it('never makes a digits-only term match inside a longer number', () => {
    expect(found('112,345,678')).toEqual([]);
    expect(found('12,345,6789')).toEqual([]);
    expect(found('12,345,678,901')).toEqual([]);
    expect(found('9_12_345_678')).toEqual([]);
    expect(found('12,345,678px')).toEqual([]);
  });

  it('leaves lists, versions, hex literals, dates and non-grouping commas alone', () => {
    // Each text below would hit one of these terms if its separators were wrongly removed.
    const plain = TermMatcher.fromText(
      ['1234567', '123456', '12345', '1234.5', '123', '20260927'].join('\n'),
    );
    const hits = (text: string) => plain.find(text).map((m) => m.value);
    // A list with a space after the comma.
    expect(hits('[12, 345] f(1, 23)')).toEqual([]);
    // Versions and dotted numbers have no separator run.
    expect(hits('v1.2.3 and 1.23.4')).toEqual([]);
    // Hex, binary and other prefixed digit-separator runs.
    expect(hits('0x12_345 0b1_2345 0x1_234_567')).toEqual([]);
    // Dates.
    expect(hits('2026-09-27 27/09/2026 27 Sep 2026 2026_09_27x')).toEqual([]);
    // Commas inside a longer number that do not group by thousands.
    expect(hits('12,34,567 1,2345 1234,567 12,345,6 1,234.5.6')).toEqual([]);
    // Identifiers with digit runs.
    expect(hits('id_12_345 row12_345 _12_345')).toEqual([]);
    // A grouped number is still matched when it is one.
    expect(hits('1,234,567 and 12_345')).toEqual(['1,234,567', '12_345']);
  });

  it('exposes the normalised text with an offset map back to the original', () => {
    expect(normaliseSeparatorRuns('no runs 1234 here')).toBeUndefined();
    const n = normaliseSeparatorRuns('a 1,234 b 5_6');
    expect(n?.text).toBe('a 1234 b 56');
    expect(n?.offsets).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13]);
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
