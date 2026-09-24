// Importer errors (stage-1.md §4.1). Re-exported from the package root.

/** The workbook is not a readable template v2.15 export (missing sheet, shifted header, …). */
export class WorkbookFormatError extends Error {
  readonly code = 'INVALID_WORKBOOK';

  constructor(message: string) {
    super(message);
    this.name = 'WorkbookFormatError';
  }
}

/** The corrections file is not valid JSON or does not match CorrectionsFileSchema. */
export class CorrectionsError extends Error {
  readonly code = 'INVALID_CORRECTIONS';

  constructor(message: string) {
    super(message);
    this.name = 'CorrectionsError';
  }
}
