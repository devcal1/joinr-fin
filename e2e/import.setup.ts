// Setup project (stage-1.md §7.2 step 7, §7.6): imports the generic synthetic workbook once before
// the desktop and phone projects run, so their read-only views start from a known data state.
// Skipped until the importer reports both flags.
import { expect, test as setup } from '@playwright/test';
import {
  NOT_READY_REASON,
  SYNTHETIC_FILE_NAME,
  SYNTHETIC_IMPORT_READY,
  importSyntheticWorkbook,
} from './records-support';

setup('import the synthetic workbook', async ({ request }) => {
  setup.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  setup.setTimeout(120_000);
  const run = await importSyntheticWorkbook(request);
  expect(run.status).toBe('succeeded');
  expect(run.dryRun).toBe(false);
  expect(run.fileName).toBe(SYNTHETIC_FILE_NAME);
  // The clean synthetic workbook reconciles completely.
  expect(run.totals?.unexplained).toBe(0);
});
