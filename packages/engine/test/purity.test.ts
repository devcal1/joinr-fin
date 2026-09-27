// Engine purity (stage-2.md §2.1, stage-3.md §2.1): no clock, no I/O, no node modules, no timers,
// no dynamic import or require, no randomness, no host time zone or locale anywhere in src/**. The
// ESLint rules cover the syntax forms; this scan also catches text the rules cannot. Comments are
// stripped first (strings, template literals and regex literals are kept), so prose that names a
// banned API is not a hit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** A `/` after one of these characters or keywords (or at the start) opens a regex literal. */
const REGEX_AFTER_CHAR = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_AFTER_WORD = /\b(return|typeof|case)$/;

/**
 * Removes `//` and `/* *\/` comments (newlines kept) while leaving strings, template literals
 * and regex literals intact, so `'http://x'` or `/\/\//` is never mistaken for a comment.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  const skipQuoted = (quote: string) => {
    const start = i;
    i += 1;
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') i += 1;
      else if (quote !== '`' && source[i] === '\n') break;
      i += 1;
    }
    i += 1;
    out += source.slice(start, i);
  };
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      skipQuoted(c);
      continue;
    }
    if (c === '/') {
      const before = out.trimEnd();
      if (
        before === '' ||
        REGEX_AFTER_CHAR.test(before.slice(-1)) ||
        REGEX_AFTER_WORD.test(before)
      ) {
        // A regex literal: copy to its closing slash (escapes and [classes] included).
        const start = i;
        i += 1;
        let inClass = false;
        while (i < n && source[i] !== '\n') {
          const ch = source[i]!;
          if (ch === '\\') i += 1;
          else if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          i += 1;
        }
        i += 1;
        out += source.slice(start, i);
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

const LOCAL_TIME_AND_LOCALE =
  'getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|' +
  'getTimezoneOffset|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|' +
  'setMilliseconds|toLocaleString|toLocaleDateString|toLocaleTimeString|localeCompare|' +
  'toDateString|toTimeString';

/** Stage 2 (clock, I/O, node modules) and Stage 3 (timers, dynamic code, randomness, locale). */
const BANNED: readonly { label: string; re: RegExp; sample: string }[] = [
  { label: 'Date.now(', re: /\bDate\.now\s*\(/, sample: 'const t = Date.now();' },
  { label: 'new Date()', re: /\bnew\s+Date\s*\(\s*\)/, sample: 'const d = new Date();' },
  { label: 'node:', re: /['"]node:/, sample: "import { x } from 'node:fs';" },
  { label: 'fetch(', re: /\bfetch\s*\(/, sample: 'await fetch(url);' },
  { label: 'process.', re: /\bprocess\./, sample: 'const e = process.env;' },
  { label: 'console.', re: /\bconsole\./, sample: 'console.log(x);' },
  {
    label: 'timers and require(',
    re: /\b(setTimeout|setInterval|setImmediate|queueMicrotask|require)\s*\(/,
    sample: 'setTimeout(run, 10);',
  },
  { label: 'dynamic import(', re: /\bimport\s*\(/, sample: "const m = await import('./x');" },
  { label: 'Math.random', re: /\bMath\.random\b/, sample: 'const r = Math.random();' },
  { label: 'crypto.', re: /\bcrypto\.[A-Za-z_$]/, sample: 'const id = crypto.randomUUID();' },
  {
    label: 'performance.',
    re: /\bperformance\.[A-Za-z_$]/,
    sample: 'const t = performance.now();',
  },
  { label: 'globalThis', re: /\bglobalThis\b/, sample: 'const g = globalThis;' },
  { label: 'Intl.', re: /\bIntl\.[A-Za-z_$]/, sample: 'new Intl.DateTimeFormat();' },
  { label: 'Date.parse', re: /\bDate\.parse\b/, sample: 'const ms = Date.parse(s);' },
  // new Date(y, m, d) and a zone-less date-time string both read the host time zone.
  {
    label: 'local Date constructor',
    re: /\bnew\s+Date\s*\([^()]*,/,
    sample: 'const d = new Date(2026, 0, 1);',
  },
  {
    label: 'date-time string parse',
    re: /\bnew\s+Date\s*\(\s*['"`][^'"`]*T\d/,
    sample: "const d = new Date('2026-01-01T00:00');",
  },
  // Keep this entry last: the detection test reads BANNED.at(-1) as the accessor regex.
  {
    label: 'local-time and locale accessors',
    re: new RegExp(`\\.(${LOCAL_TIME_AND_LOCALE})\\s*\\(`),
    sample: 'const y = d.getFullYear();',
  },
];

describe('engine purity', () => {
  const files = sourceFiles(SRC);

  it('scans every source file', () => {
    expect(files.length).toBeGreaterThanOrEqual(18);
    // Stage 6 (stage-6.md §2.1): the FIRE modules are scanned like every other.
    const names = files.map((f) => f.split(/[\\/]/).at(-1));
    expect(names).toEqual(expect.arrayContaining(['fire.ts', 'fireSheet.ts']));
  });

  it.each(BANNED.map((b) => [b.label, b.re] as const))('uses no %s', (_label, re) => {
    const hits = files.filter((f) => re.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('detects each banned pattern on a one-line sample', () => {
    for (const b of BANNED) expect(b.re.test(stripComments(b.sample)), b.label).toBe(true);
    // The UTC forms the engine uses are allowed.
    const accessors = BANNED.at(-1)!.re;
    expect(accessors.test('d.getUTCFullYear(); d.setUTCDate(1); d.getUTCMonth();')).toBe(false);
    for (const call of ['a.localeCompare(b);', 'd.toDateString();', 'd.toTimeString();']) {
      expect(accessors.test(call), call).toBe(true);
    }
    // The UTC-safe constructors stay allowed.
    const local = BANNED.find((b) => b.label === 'local Date constructor')!.re;
    const parse = BANNED.find((b) => b.label === 'date-time string parse')!.re;
    for (const ok of ['new Date(0);', 'new Date(day * MS);', "new Date('2026-01-01');"]) {
      expect(local.test(ok) || parse.test(ok), ok).toBe(false);
    }
    expect(local.test('new Date(Date.UTC(2026, 0, 1));')).toBe(false);
  });

  it('does not count a banned word inside a comment', () => {
    for (const text of [
      '// setTimeout(run, 10);',
      '/* uses no crypto.randomUUID() and no Date.now() */',
      'const x = 1; // the engine uses no crypto.',
      '/**\n * No Intl.DateTimeFormat, no globalThis.\n */',
    ]) {
      for (const b of BANNED)
        expect(b.re.test(stripComments(text)), `${b.label}: ${text}`).toBe(false);
    }
  });

  it('keeps strings and regex literals when it strips comments', () => {
    expect(stripComments("const u = 'http://x'; // note")).toBe("const u = 'http://x'; ");
    expect(stripComments('const re = /\\/\\//g; /* c */ run();')).toBe(
      'const re = /\\/\\//g;         run();',
    );
    expect(stripComments('const t = `a // b`;')).toBe('const t = `a // b`;');
    expect(stripComments('const half = a / 2; // c')).toBe('const half = a / 2; ');
  });

  it('imports only the @joinr/schema root and its own modules', () => {
    const imports = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!),
    );
    const outside = imports.filter((s) => !s.startsWith('./') && s !== '@joinr/schema');
    expect(outside).toEqual([]);
  });
});
