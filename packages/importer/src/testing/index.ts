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
