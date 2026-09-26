// Setup project (stage-1.md §7.2 step 7, §7.6): imports the generic synthetic workbook once before
// the desktop and phone projects run, so their read-only views start from a known data state.
// Skipped until the importer reports both flags.
import { expect, test as setup } from '@playwright/test';
import { cleanupAssetsRows } from './assets-support';
import { cleanupCashflowRows } from './cashflow-support';
import { cleanupHistoryRows } from './history-support';
import { cleanupE2eRows } from './investments-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_FILE_NAME,
  SYNTHETIC_IMPORT_READY,
  importSyntheticWorkbook,
} from './records-support';

setup('import the synthetic workbook', async ({ request }) => {
  setup.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  setup.setTimeout(120_000);
  // A crashed earlier run may have left e2e app rows behind; they would make the import answer
  // 409 (D34). Remove them first: the assets rows (and their offset links), then the cash-flow
  // rows, then the trades and instruments (stage-2.md §7.6 step 3, stage-3.md §7.8 step 2,
  // stage-4.md §7.8 step 2). The e2e recorded months go first (a recorded month is app data too,
  // D34/D84; stage-5.md §7.8 step 2).
  await cleanupHistoryRows(request);
  await cleanupAssetsRows(request);
  await cleanupCashflowRows(request);
  await cleanupE2eRows(request);
  const run = await importSyntheticWorkbook(request);
  expect(run.status).toBe('succeeded');
  expect(run.dryRun).toBe(false);
  expect(run.fileName).toBe(SYNTHETIC_FILE_NAME);
  // The clean synthetic workbook reconciles completely.
  expect(run.totals?.unexplained).toBe(0);
});
