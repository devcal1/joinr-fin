// @joinr/importer public API (stage-1.md §4.1, frozen): the workbook importer, the corrections
// file helpers and the workbook reader. The implementation lives in the modules re-exported here.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CorrectionsFileSchema,
  type CorrectionsFile,
  type CorrectionsSetting,
} from '@joinr/schema';
import { CorrectionsError } from './errors';

export const packageName = '@joinr/importer' as const;

export type { CorrectionsSetting } from '@joinr/schema';
export { correctionsSettingFromEnv } from '@joinr/schema';

export { CorrectionsError, WorkbookFormatError } from './errors';
export {
  IMPORTER_VERSION,
  importWorkbook,
  type ImportOptions,
  type ImportResult,
} from './importWorkbook';
export { readWorkbook, type CellInfo, type WorkbookReader } from './reader';

/** Parses and validates a corrections file; throws CorrectionsError. */
export function parseCorrectionsFile(json: string): CorrectionsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CorrectionsError('The corrections file is not valid JSON');
  }
  const result = CorrectionsFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.map(String).join('.')}: ` : '';
    throw new CorrectionsError(
      `The corrections file is not valid: ${where}${first?.message ?? 'invalid'}`,
    );
  }
  return result.data;
}

/** The corrections file name looked for in DATA_DIR and in the checkout's reference/ folder. */
export const CORRECTIONS_FILE_NAME = 'import-corrections.json';

/**
 * Where the corrections come from (§3.4 step 4): `off` → null; `file` → that path (existence is
 * the caller's check); `auto` → `<dataDir>/import-corrections.json` if present, else
 * `<repoRoot>/reference/import-corrections.json` if `repoRoot` is set and the file exists, else null.
 */
export function resolveCorrectionsPath(o: {
  setting: CorrectionsSetting;
  dataDir: string;
  repoRoot: string | null;
}): string | null {
  switch (o.setting.kind) {
    case 'off':
      return null;
    case 'file':
      return o.setting.path;
    case 'auto': {
      const inData = join(o.dataDir, CORRECTIONS_FILE_NAME);
      if (existsSync(inData)) return inData;
      if (o.repoRoot !== null) {
        const inCheckout = join(o.repoRoot, 'reference', CORRECTIONS_FILE_NAME);
        if (existsSync(inCheckout)) return inCheckout;
      }
      return null;
    }
  }
}

export type WorkbookLocation =
  { kind: 'found'; path: string } | { kind: 'none' } | { kind: 'multiple'; paths: string[] };

/** The single `*.xlsx` in `dir` (not recursive; `~$` lock files ignored). */
export function findWorkbookInDir(dir: string): WorkbookLocation {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { kind: 'none' };
  }
  const paths = names
    .filter((n) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$'))
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  if (paths.length === 0) return { kind: 'none' };
  if (paths.length === 1) return { kind: 'found', path: paths[0]! };
  return { kind: 'multiple', paths };
}
