// Size limits shared by the server and the web.

/** The workbook upload limit: 25 MiB = 26,214,400 bytes (the only definition; §3.2). */
export const UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

/** The most rows `GET /api/records/:entity` returns (§3.2). */
export const RECORDS_PAGE_CAP = 5000;

/** The most runs `GET /api/import/runs` returns (§3.2). */
export const IMPORT_RUNS_LIST_CAP = 50;
