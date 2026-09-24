import { RECORD_GROUPS } from '@joinr/schema';
import { apiErrors, recordsIndex, recordsIndexEmpty } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';

describe('RecordsIndexPage', () => {
  it('shows a loading line while the index loads', async () => {
    mockApi({ 'GET /api/records': pending });
    renderApp('/records');
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    expect(within(await findMain()).getByRole('status')).toHaveTextContent(
      'Loading the record tables',
    );
  });

  it('lists every group with its tables and row counts', async () => {
    mockApi({ 'GET /api/records': { body: recordsIndex } });
    const { router, user } = renderApp('/records');
    expect(await screen.findByText('Imported data, read-only')).toBeInTheDocument();
    for (const group of RECORD_GROUPS) {
      const heading = await within(await findMain()).findByRole('heading', {
        level: 2,
        name: group.label,
      });
      // Reference / raw data: violet section bars (D33).
      expect(heading.closest('.jf-section-bar')).toHaveClass('jf-section-bar--reference');
    }
    for (const entity of recordsIndex.entities) {
      const label = `${entity.label}: ${entity.count} row${entity.count === 1 ? '' : 's'}`;
      const link = within(await findMain()).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', `/records/${entity.id}`);
    }
    expect(within(await findMain()).queryByText(/Nothing imported yet/)).not.toBeInTheDocument();

    await user.click(within(await findMain()).getByRole('link', { name: /^Trades:/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/records/trades'));
  });

  it('says nothing is imported yet and links to the import page on an empty database', async () => {
    mockApi({ 'GET /api/records': { body: recordsIndexEmpty } });
    renderApp('/records');
    const note = await within(await findMain()).findByRole('note');
    expect(note).toHaveTextContent('Nothing imported yet. Run an import.');
    expect(within(note).getByRole('link', { name: 'Run an import.' })).toHaveAttribute(
      'href',
      '/import',
    );
    expect(
      within(await findMain()).getByRole('link', { name: 'Trades: 0 rows' }),
    ).toBeInTheDocument();
  });

  it('shows the error with a retry button when the API fails', async () => {
    const api = mockApi({ 'GET /api/records': apiError(500, apiErrors.internal) });
    const { user } = renderApp('/records');
    const callout = await within(await findMain()).findByRole('note', {
      name: 'Could not load the records',
    });
    expect(callout).toHaveTextContent('Internal server error');
    await user.click(within(callout).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.calls('GET /api/records')).toHaveLength(2));
  });
});
