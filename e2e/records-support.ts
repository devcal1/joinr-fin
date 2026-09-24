// Shared e2e helpers for the Stage 1 data pages (stage-1.md §7.6 phase B): get the generic
// synthetic workbook into the server's DATA_DIR. Imports the synthetic workbook module directly,
// not the importer's testing index (which pulls in Vitest).
import { expect, type APIRequestContext } from '@playwright/test';
import type { ImportRunDetail, ImportRunsResponse } from '../packages/schema/src/dto/import';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '../packages/importer/src/testing/syntheticWorkbook';

export const SYNTHETIC_FILE_NAME = 'synthetic-workbook.xlsx';

/** True once the importer reports both flags (the e2e setup and data specs skip until then). */
export const SYNTHETIC_IMPORT_READY = SYNTHETIC_WORKBOOK_IMPLEMENTED && IMPORTER_IMPLEMENTED;
export const NOT_READY_REASON = 'the importer is not implemented yet';

const POLL_MS = 1_000;
const MAX_WAIT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The workbook bytes as the page would upload them. */
export function syntheticWorkbookBuffer(): Buffer {
  return Buffer.from(buildSyntheticWorkbook());
}

async function isInProgress(response: { json(): Promise<unknown> }): Promise<boolean> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === 'IMPORT_IN_PROGRESS';
}

/**
 * Imports the synthetic workbook with `confirmReplace=true` (replacing whatever is there) and
 * returns the committed run. Waits and retries while another import is running.
 */
export async function importSyntheticWorkbook(
  request: APIRequestContext,
): Promise<ImportRunDetail> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const response = await request.post('/api/import?confirmReplace=true', {
      data: syntheticWorkbookBuffer(),
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(SYNTHETIC_FILE_NAME),
      },
      timeout: MAX_WAIT_MS,
    });
    if (response.status() === 409 && (await isInProgress(response)) && Date.now() < deadline) {
      await sleep(POLL_MS);
      continue;
    }
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as ImportRunDetail;
  }
}

/** The import runs list (newest first). */
export async function importRuns(request: APIRequestContext): Promise<ImportRunsResponse> {
  const response = await request.get('/api/import/runs');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ImportRunsResponse;
}

/**
 * Makes sure imported data exists: imports only when `GET /api/import/runs` says there is none,
 * so a spec run on its own still works. Waits for an import that is already running.
 */
export async function ensureImported(request: APIRequestContext): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let runs = await importRuns(request);
  while (runs.inProgress && Date.now() < deadline) {
    await sleep(POLL_MS);
    runs = await importRuns(request);
  }
  if (!runs.hasImportedData) await importSyntheticWorkbook(request);
}

/** The newest committed (not dry-run) successful run, if any. */
export async function latestCommittedRun(
  request: APIRequestContext,
): Promise<ImportRunsResponse['runs'][number] | undefined> {
  const { runs } = await importRuns(request);
  return runs.find((run) => run.status === 'succeeded' && !run.dryRun);
}
