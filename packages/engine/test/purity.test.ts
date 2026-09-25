// Engine purity (stage-2.md §2.1, §7.3 step 10): no clock, no I/O and no node modules anywhere in
// src/**. The ESLint rule covers the syntax forms; this scan also catches text the rule cannot.
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

const BANNED: readonly { label: string; re: RegExp }[] = [
  { label: 'Date.now(', re: /\bDate\.now\s*\(/ },
  { label: 'new Date()', re: /\bnew\s+Date\s*\(\s*\)/ },
  { label: 'node:', re: /['"]node:/ },
  { label: 'fetch(', re: /\bfetch\s*\(/ },
  { label: 'process.', re: /\bprocess\./ },
  { label: 'console.', re: /\bconsole\./ },
];

describe('engine purity', () => {
  const files = sourceFiles(SRC);

  it('scans every source file', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(BANNED.map((b) => [b.label, b.re] as const))('uses no %s', (_label, re) => {
    const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('imports only the @joinr/schema root and its own modules', () => {
    const imports = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!),
    );
    const outside = imports.filter((s) => !s.startsWith('./') && s !== '@joinr/schema');
    expect(outside).toEqual([]);
  });
});
