import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_BYTES, TermMatcher } from '../src/rules';
import { formatFinding, scanFile, scanFiles, type FileToScan } from '../src/scan';
import * as v from './values';

const file = (path: string, text: string): FileToScan => {
  const content = Buffer.from(text, 'utf8');
  return { path, size: content.length, content };
};

describe('scanFile', () => {
  it('reports a blocked path once and skips its content', () => {
    const result = scanFile(file('docs/private/notes.md', `ip ${v.PRIVATE_IP}\n${v.EMAIL}`));
    expect(result.contentScanned).toBe(false);
    expect(result.findings).toEqual([
      {
        kind: 'path',
        path: 'docs/private/notes.md',
        rule: 'blocked-path',
        pattern: 'docs/private/**',
      },
    ]);
  });

  it('reports content findings with line, column and a masked value', () => {
    const result = scanFile(file('src/a.ts', `// ok\nconst host = '${v.PRIVATE_IP}';\n`));
    expect(result.contentScanned).toBe(true);
    expect(result.findings).toEqual([
      {
        kind: 'content',
        path: 'src/a.ts',
        rule: 'ipv4',
        line: 2,
        column: 15,
        masked: `10…(${v.PRIVATE_IP.length} chars)`,
      },
    ]);
  });

  it('reports private terms by term line only', () => {
    const terms = TermMatcher.fromText('# header\nExamplecorp\n');
    const [finding] = scanFile(file('README.md', 'Owned by Examplecorp.'), terms).findings;
    expect(finding).toEqual({
      kind: 'content',
      path: 'README.md',
      rule: 'private-term',
      line: 1,
      column: 10,
      masked: '',
      termLine: 2,
    });
    expect(formatFinding(finding!)).toBe('README.md:1:10  private-term #2');
  });

  it('reports a digits-only term written with separators at its original location', () => {
    const terms = TermMatcher.fromText('# header\n12345678\n4,321\n');
    const text = 'const a = 1;\nconst total = 12_345_678; // $12,345,678.00\nport 4321';
    const found = scanFile(file('src/a.ts', text), terms).findings.map(formatFinding);
    expect(found).toEqual(['src/a.ts:2:15  private-term #2', 'src/a.ts:2:31  private-term #2']);
  });

  it('skips binary content, the lockfile and unreadable files', () => {
    const leaky = `${v.PRIVATE_IP} ${v.EMAIL}`;
    const bytes = (path: string, head: Buffer): FileToScan => {
      const content = Buffer.concat([head, Buffer.from(leaky)]);
      return { path, size: content.length, content };
    };
    const cases: FileToScan[] = [
      bytes('blob.bin', Buffer.from([0])),
      file('pnpm-lock.yaml', leaky),
      bytes('reference/brand/logo.png', v.SAMPLE_HEADS.png), // a real PNG: its bytes say so
      bytes('fonts/x.woff2', v.SAMPLE_HEADS.woff2),
      { path: 'deleted.txt', size: 0, content: undefined },
    ];
    for (const c of cases) {
      expect(scanFile(c), c.path).toEqual({ findings: [], contentScanned: false });
    }
  });

  it('scans text whatever its extension, and UTF-16 text', () => {
    const leaky = `host ${v.PRIVATE_IP}\n`;
    for (const name of ['notes.png', 'notes.PNG', 'a/x.woff2']) {
      const result = scanFile(file(name, leaky));
      expect(result.contentScanned, name).toBe(true);
      expect(result.findings.map((f) => f.rule)).toEqual(['ipv4']);
    }
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`ok\n${leaky}`, 'utf16le')]);
    const [finding] = scanFile({ path: 'u16.txt', size: u16.length, content: u16 }).findings;
    expect(finding).toMatchObject({ rule: 'ipv4', line: 2, column: 6 });
  });

  it('blocks a database or spreadsheet by its bytes, whatever it is called', () => {
    const cases: [string, Buffer, string][] = [
      ['backup/finance.old', v.SAMPLE_HEADS.sqlite, 'SQLite database'],
      ['notes.txt', v.SAMPLE_HEADS.sqlite, 'SQLite database'],
      ['export.csv', v.SAMPLE_HEADS.xlsx, 'Excel workbook'],
      ['logo.png', v.SAMPLE_HEADS.xls, 'Office binary document (e.g. .xls)'],
    ];
    for (const [path, content, type] of cases) {
      const result = scanFile({ path, size: content.length, content });
      expect(result.findings, path).toEqual([{ kind: 'type', path, rule: 'blocked-type', type }]);
      expect(formatFinding(result.findings[0]!)).toBe(`${path}  blocked-type  ${type}`);
    }
  });

  it('reports text too large to scan instead of skipping it', () => {
    const size = MAX_CONTENT_BYTES + 1;
    const big: FileToScan = { ...file('big.csv', `a,b\n${v.PRIVATE_IP},1\n`), size };
    const result = scanFile(big);
    expect(result).toEqual({
      findings: [{ kind: 'size', path: 'big.csv', rule: 'too-large', size }],
      contentScanned: false,
    });
    expect(formatFinding(result.findings[0]!)).toBe(
      'big.csv  too-large  16.0 MB of text (the guard scans up to 16 MB)',
    );
    // A large binary (by its head) is skipped like any binary; a large database is blocked.
    expect(scanFile({ path: 'clip.bin', size, content: Buffer.from([0, 1, 2]) }).findings).toEqual(
      [],
    );
    expect(
      scanFile({ path: 'db.old', size, content: v.SAMPLE_HEADS.sqlite }).findings[0],
    ).toMatchObject({ rule: 'blocked-type' });
  });

  it('passes clean text', () => {
    expect(scanFile(file('README.md', 'Listen on 127.0.0.1; mail user@example.com.'))).toEqual({
      findings: [],
      contentScanned: true,
    });
  });
});

describe('scanFiles', () => {
  it('counts files and content skips', () => {
    const result = scanFiles([
      file('a.md', 'clean'),
      file('b.md', v.EMAIL),
      file('.env', 'X=1'),
      file('pnpm-lock.yaml', 'x'),
    ]);
    expect(result.filesChecked).toBe(4);
    expect(result.contentSkipped).toBe(2);
    expect(result.findings.map((f) => `${f.path}:${f.rule}`)).toEqual([
      'b.md:email',
      '.env:blocked-path',
    ]);
  });
});

describe('formatFinding', () => {
  it('formats path and content findings', () => {
    expect(
      formatFinding({ kind: 'path', path: 'x.xlsx', rule: 'blocked-path', pattern: '*.xlsx' }),
    ).toBe('x.xlsx  blocked-path  *.xlsx');
    expect(
      formatFinding({
        kind: 'content',
        path: 'a.ts',
        rule: 'email',
        line: 3,
        column: 7,
        masked: 'so…(20 chars)',
      }),
    ).toBe('a.ts:3:7  email  so…(20 chars)');
  });
});
