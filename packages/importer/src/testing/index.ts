// `@joinr/importer/testing`: the synthetic workbook and the local-workbook helpers.
// This entry imports Vitest (describeWithLocalWorkbook); Playwright imports
// ./syntheticWorkbook directly instead.
export {
  buildSyntheticWorkbook,
  buildSyntheticWorkbookObject,
  HISTORY_HEADERS as SYNTHETIC_HISTORY_HEADERS,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_FACTS,
  SYNTHETIC_HISTORY_TMP,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
  type SyntheticWorkbookOptions,
} from './syntheticWorkbook';
export {
  describeWithLocalWorkbook,
  LOCAL_WORKBOOK_LOCATION,
  LOCAL_WORKBOOK_PATH,
  readLocalWorkbookBytes,
  REFERENCE_DIR,
} from './localWorkbook';

/**
 * True once the importer's own suite passes with the Stage 3 changes (dated side-income deposits,
 * balance entries, kinds kept across a re-import, Budget C28, the settings gap; stage-3.md §3.5
 * item 7). It gates the server's Stage 3 golden and the synthetic-workbook integration tests;
 * never fake it.
 */
export const IMPORTER_STAGE3_IMPLEMENTED: boolean = true;
