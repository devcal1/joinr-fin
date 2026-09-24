// The owner's local workbook for golden tests (stage-1.md §9.2). It lives in the git-ignored
// reference/ folder; tests that need it skip when it is absent. Never a hard-coded file name.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { findWorkbookInDir, type WorkbookLocation } from '../index';

/** `<repo>/reference`. */
export const REFERENCE_DIR = fileURLToPath(new URL('../../../../reference', import.meta.url));

/** What `reference/` holds: exactly one workbook, none, or several. */
export const LOCAL_WORKBOOK_LOCATION: WorkbookLocation = findWorkbookInDir(REFERENCE_DIR);

/** `<repo>/reference/*.xlsx` when exactly one exists, else null. */
export const LOCAL_WORKBOOK_PATH: string | null =
  LOCAL_WORKBOOK_LOCATION.kind === 'found' ? LOCAL_WORKBOOK_LOCATION.path : null;

function skipReason(location: WorkbookLocation): string {
  if (location.kind === 'multiple') {
    const names = location.paths.map((p) => basename(p)).join(', ');
    return `several workbooks in reference/ (${names})`;
  }
  return 'no local workbook in reference/';
}

/** `describe` with the local workbook's path, or a skipped describe naming the reason. */
export function describeWithLocalWorkbook(name: string, fn: (path: string) => void): void {
  const location = LOCAL_WORKBOOK_LOCATION;
  if (location.kind === 'found') {
    describe(name, () => fn(location.path));
    return;
  }
  describe.skip(`${name} (skipped: ${skipReason(location)})`, () => {
    it('needs the local workbook', () => undefined);
  });
}

/** The local workbook's bytes, or null when there is not exactly one. */
export function readLocalWorkbookBytes(): Uint8Array | null {
  return LOCAL_WORKBOOK_PATH === null ? null : new Uint8Array(readFileSync(LOCAL_WORKBOOK_PATH));
}
