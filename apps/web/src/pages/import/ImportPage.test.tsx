import { UPLOAD_LIMIT_BYTES } from '@joinr/schema';
import {
  apiErrors,
  importRunDryRun,
  importRunSucceeded,
  importRunsEmpty,
  importRunsInProgress,
  importRunsPopulated,
  importRunsWithAppData,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import {
  APP_DATA_KEPT,
  APP_DATA_MESSAGE,
  APP_DATA_OVERRIDE,
  APP_DATA_TITLE,
  CONFIRM_MESSAGE,
  NOT_XLSX_MESSAGE,
  NO_FILE_MESSAGE,
  REPLACE_LABEL,
  REPLACE_WARNING,
  TOO_LARGE_MESSAGE,
} from './ImportPage';

function workbook(name = 'example-workbook.xlsx', size?: number): File {
  const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function fileInput(): Promise<HTMLInputElement> {
  return screen.findByLabelText<HTMLInputElement>('Workbook file');
}

/** The field-level alert showing `message` (the page also keeps an empty outcome alert region). */
function fieldAlert(message: string): HTMLElement | null {
  return (
    screen
      .getAllByRole('alert')
      .find((el) => el.classList.contains('jf-app-error') && el.textContent?.includes(message)) ??
    null
  );
}

describe('ImportPage', () => {
  it('renders the header, the upload card and an empty runs table', async () => {
    mockApi({ 'GET /api/import/runs': { body: importRunsEmpty } });
    renderApp('/import');
    expect(await screen.findByRole('heading', { level: 1, name: 'Import' })).toBeInTheDocument();
    expect(screen.getByText('Bring in the workbook export')).toBeInTheDocument();
    const main = await findMain();
    expect(within(main).getByRole('heading', { name: 'Import a workbook' })).toBeInTheDocument();
    expect(await within(main).findByText('No imports yet.')).toBeInTheDocument();
    expect(within(main).queryByRole('checkbox', { name: REPLACE_LABEL })).not.toBeInTheDocument();
    expect(await fileInput()).toHaveAttribute('accept', expect.stringContaining('.xlsx'));
  });

  it('shows a loading line while the runs load', async () => {
    mockApi({ 'GET /api/import/runs': pending });
    renderApp('/import');
    const loading = await within(await findMain()).findByText(/Loading the import runs/);
    expect(loading.closest('[role="status"]')).not.toBeNull();
  });

  it('shows the error when the runs cannot load', async () => {
    mockApi({ 'GET /api/import/runs': apiError(500, apiErrors.internal) });
    renderApp('/import');
    expect(
      await within(await findMain()).findByRole('note', { name: 'Could not load the import runs' }),
    ).toHaveTextContent('Internal server error');
  });

  it('lists runs newest first with kind, status and counts, linking to each report', async () => {
    mockApi({ 'GET /api/import/runs': { body: importRunsPopulated } });
    renderApp('/import');
    const table = await within(await findMain()).findByRole('table', {
      name: 'Import runs, newest first',
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const [committed, dryRun, failed] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(committed).getByRole('link')).toHaveAttribute('href', '/import/runs/3');
    expect(within(committed).getByText('Import')).toHaveClass('jf-pill');
    // Succeeded with unexplained checks: an orange "Needs review" badge (D33); clean runs stay green.
    expect(within(committed).getByText('Needs review').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'check',
    );
    expect(within(dryRun).getByText('Succeeded').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'go',
    );
    // Unexplained is the key column: a non-zero count stands out.
    const cells = within(committed).getAllByRole('cell');
    const unexplainedCell = cells[3] as HTMLElement;
    expect(unexplainedCell).toHaveTextContent(String(importRunSucceeded.totals.unexplained));
    expect(within(unexplainedCell).getByText(/\d/)).toHaveClass('jf-app-strong');
    expect(within(dryRun).getByText('Dry run')).toHaveClass('jf-pill');
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(failed).getByText('notes.xlsx')).toBeInTheDocument();
    expect(within(failed).getAllByText('—')).toHaveLength(4);
  });

  it('asks for a file before previewing', async () => {
    const api = mockApi({ 'GET /api/import/runs': { body: importRunsEmpty } });
    const { user } = renderApp('/import');
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(fieldAlert(NO_FILE_MESSAGE)).toBeInTheDocument();
    expect(api.calls('POST /api/import')).toHaveLength(0);
  });

  it('rejects a file over the upload limit and a file that is not .xlsx', async () => {
    const api = mockApi({ 'GET /api/import/runs': { body: importRunsEmpty } });
    renderApp('/import');
    const user = userEvent.setup({ applyAccept: false });
    const input = await fileInput();
    await user.upload(input, workbook('huge.xlsx', UPLOAD_LIMIT_BYTES + 1));
    expect(fieldAlert(TOO_LARGE_MESSAGE)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.upload(input, new File(['a,b'], 'notes.csv', { type: 'text/csv' }));
    expect(fieldAlert(NOT_XLSX_MESSAGE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(api.calls('POST /api/import')).toHaveLength(0);
  });

  it('previews: posts the raw bytes as a dry run and shows the result tiles', async () => {
    const api = mockApi({
      'GET /api/import/runs': { body: importRunsEmpty },
      'POST /api/import': { status: 200, body: importRunDryRun },
    });
    const { user } = renderApp('/import');
    const file = workbook();
    await user.upload(await fileInput(), file);
    expect(screen.getByText(/example-workbook\.xlsx/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const result = await screen.findByRole('region', { name: 'Preview result' });
    expect(result).toHaveTextContent('Preview finished; nothing was saved.');
    const unexplained = within(result).getByRole('group', { name: 'Unexplained' });
    expect(unexplained).toHaveTextContent('0');
    expect(unexplained).toHaveClass('jf-stat-tile--key');
    expect(within(result).getByRole('link', { name: /full report for run #2/ })).toHaveAttribute(
      'href',
      '/import/runs/2',
    );

    const [request] = api.calls('POST /api/import');
    expect(request?.query.get('dryRun')).toBe('true');
    expect(request?.query.has('confirmReplace')).toBe(false);
    expect(request?.headers['content-type']).toBe('application/octet-stream');
    expect(request?.headers['x-file-name']).toBe('example-workbook.xlsx');
    expect(request?.body).toBe(file);
  });

  it('URI-encodes the file name header', async () => {
    const api = mockApi({
      'GET /api/import/runs': { body: importRunsEmpty },
      'POST /api/import': { status: 200, body: importRunDryRun },
    });
    const { user } = renderApp('/import');
    await user.upload(await fileInput(), workbook('Finance – copy.xlsx'));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.calls('POST /api/import')).toHaveLength(1));
    expect(api.calls('POST /api/import')[0]?.headers['x-file-name']).toBe(
      encodeURIComponent('Finance – copy.xlsx'),
    );
  });

  it('requires "Replace the imported data" before importing over existing data', async () => {
    const api = mockApi({
      'GET /api/import/runs': { body: importRunsPopulated },
      'POST /api/import': { status: 201, body: importRunSucceeded },
    });
    const { user } = renderApp('/import');
    const warning = await screen.findByText(REPLACE_WARNING);
    expect(warning.closest('.jf-callout')).toHaveClass('jf-callout--important');
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(fieldAlert(CONFIRM_MESSAGE)).toBeInTheDocument();
    expect(api.calls('POST /api/import')).toHaveLength(0);

    await user.click(screen.getByRole('checkbox', { name: REPLACE_LABEL }));
    expect(screen.queryByText(CONFIRM_MESSAGE)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const result = await screen.findByRole('region', { name: 'Import result' });
    // The result sits in a polite live region, so it is announced.
    expect(screen.getByRole('status', { name: 'Import outcome' })).toContainElement(result);
    expect(within(result).getByRole('group', { name: 'Unexplained' })).toHaveTextContent(
      String(importRunSucceeded.totals.unexplained),
    );
    const [request] = api.calls('POST /api/import');
    expect(request?.query.get('confirmReplace')).toBe('true');
    expect(request?.query.has('dryRun')).toBe(false);
    // The checkbox resets, so the next import asks again.
    expect(screen.getByRole('checkbox', { name: REPLACE_LABEL })).not.toBeChecked();
    // The runs list is refreshed after the import.
    await waitFor(() => expect(api.calls('GET /api/import/runs').length).toBeGreaterThan(1));
  });

  it('previews over existing data without the confirmation', async () => {
    const api = mockApi({
      'GET /api/import/runs': { body: importRunsPopulated },
      'POST /api/import': { status: 200, body: importRunDryRun },
    });
    const { user } = renderApp('/import');
    await screen.findByText(REPLACE_WARNING);
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Preview result' });
    expect(api.calls('POST /api/import')[0]?.query.get('dryRun')).toBe('true');
  });

  it('marks the pressed button busy while the upload runs', async () => {
    mockApi({ 'GET /api/import/runs': { body: importRunsEmpty }, 'POST /api/import': pending });
    const { user } = renderApp('/import');
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const busy = await screen.findByRole('button', { name: 'Previewing…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import' })).not.toHaveAttribute('aria-busy');
  });

  it('shows the API message when the workbook is rejected', async () => {
    mockApi({
      'GET /api/import/runs': { body: importRunsEmpty },
      'POST /api/import': apiError(422, apiErrors.invalidWorkbook),
    });
    const { user } = renderApp('/import');
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const callout = await screen.findByRole('note', { name: 'Import failed' });
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(screen.getByRole('alert', { name: 'Import error' })).toContainElement(callout);
    expect(callout).toHaveTextContent('Missing required sheet "History"');
  });

  it('shows the server confirmation message when it still asks for one', async () => {
    mockApi({
      'GET /api/import/runs': { body: importRunsEmpty },
      'POST /api/import': apiError(409, apiErrors.confirmRequired),
    });
    const { user } = renderApp('/import');
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('note', { name: 'Import failed' })).toHaveTextContent(
      'Imported data exists; confirm to replace it',
    );
  });

  it('blocks Import (not Preview) once app-entered data exists', async () => {
    const api = mockApi({
      'GET /api/import/runs': { body: importRunsWithAppData },
      'POST /api/import': { status: 200, body: importRunDryRun },
    });
    const { user } = renderApp('/import');
    const callout = await screen.findByRole('note', { name: APP_DATA_TITLE });
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(callout).toHaveTextContent(APP_DATA_MESSAGE);
    expect(within(callout).getByText(APP_DATA_OVERRIDE, { selector: 'code' })).toBeInTheDocument();
    // Stage 3 (§6.7): the overlays a re-import keeps.
    expect(callout).toHaveTextContent(APP_DATA_KEPT);
    expect(APP_DATA_KEPT).toBe(
      'Savings goals, one-off adjustments and dismissed suggestions are kept by a re-import.',
    );
    // No replace confirmation: Import is off whatever is ticked.
    expect(screen.queryByRole('checkbox', { name: REPLACE_LABEL })).not.toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton).toBeDisabled();

    await user.upload(await fileInput(), workbook());
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview).toBeEnabled();
    await user.click(preview);
    await screen.findByRole('region', { name: 'Preview result' });
    expect(api.calls('POST /api/import')).toHaveLength(1);
    expect(api.calls('POST /api/import')[0]?.query.get('dryRun')).toBe('true');
  });

  it('explains a 409 IMPORT_APP_DATA_EXISTS the same way', async () => {
    mockApi({
      'GET /api/import/runs': { body: importRunsEmpty },
      'POST /api/import': apiError(409, apiErrors.appDataExists),
    });
    const { user } = renderApp('/import');
    await user.upload(await fileInput(), workbook());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const callout = await screen.findByRole('note', { name: APP_DATA_TITLE });
    expect(screen.getByRole('alert', { name: 'Import error' })).toContainElement(callout);
    expect(callout).toHaveTextContent(APP_DATA_MESSAGE);
    expect(callout).toHaveTextContent(APP_DATA_OVERRIDE);
    expect(screen.queryByRole('note', { name: 'Import failed' })).not.toBeInTheDocument();
  });

  it('notes an import in progress', async () => {
    mockApi({ 'GET /api/import/runs': { body: importRunsInProgress } });
    renderApp('/import');
    expect(await screen.findByText(/An import is running/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Import runs, newest first' });
    expect(within(table).getByText('Running')).toBeInTheDocument();
  });
});
