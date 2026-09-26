// Recorded months are immutable outside the correction endpoint (stage-5.md §10 #11, §3.1): a static
// scan of the server's source lists every module that writes the `snapshots` table. Only the
// History mutations update or delete a row (a correction, the latest month's delete) and only the
// recorder's writer inserts one; the import replaces rows in `@joinr/importer` (delete + insert, no
// UPDATE, so the identity trigger never fires for it).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

function writers(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).replaceAll('\\', '/'))
    .sort();
}

describe('the modules that write the snapshots table (§10 #11)', () => {
  it('only the History mutations update or delete a snapshot row', () => {
    expect(writers(/\.update\(\s*snapshots\s*\)/)).toEqual(['history/mutations.ts']);
    expect(writers(/\.delete\(\s*snapshots\s*\)/)).toEqual(['history/mutations.ts']);
    expect(writers(/UPDATE\s+snapshots/i)).toEqual([]);
  });

  it('only the recorder’s writer inserts one', () => {
    expect(writers(/\.insert\(\s*snapshots\s*\)/)).toEqual(['history/record.ts']);
  });
});
