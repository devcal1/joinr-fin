import {
  appStatusEmpty,
  importRunDryRun,
  priceItemManualSet,
  pricesLive,
  recordsIndex,
  refreshResponse,
} from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { queryKeys, useImportWorkbook, useRefreshPrices, useSetManualPrice } from './hooks';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.records, recordsIndex);
  queryClient.setQueryData(queryKeys.recordsPage('trades'), { rows: [] });
  queryClient.setQueryData(queryKeys.importRuns, { runs: [] });
  queryClient.setQueryData(queryKeys.prices, pricesLive);
  queryClient.setQueryData(queryKeys.status, appStatusEmpty);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;
  return { queryClient, wrapper, invalidated };
}

describe('api hooks', () => {
  it('uses the planned query keys', () => {
    expect(queryKeys.records).toEqual(['records']);
    expect(queryKeys.recordsPage('trades')).toEqual(['records', 'trades']);
    expect(queryKeys.importRuns).toEqual(['import', 'runs']);
    expect(queryKeys.importRun(7)).toEqual(['import', 'run', 7]);
    expect(queryKeys.prices).toEqual(['prices']);
    expect(queryKeys.status).toEqual(['status']);
  });

  it('an import invalidates records, import runs, prices and status', async () => {
    mockApi({ 'POST /api/import': { body: importRunDryRun } });
    const { wrapper, invalidated, queryClient } = setup();
    const { result } = renderHook(() => useImportWorkbook(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        file: new File(['x'], 'example.xlsx'),
        dryRun: true,
        confirmReplace: false,
      }),
    );
    await waitFor(() => expect(invalidated(queryKeys.records)).toBe(true));
    expect(invalidated(queryKeys.recordsPage('trades'))).toBe(true);
    expect(invalidated(queryKeys.importRuns)).toBe(true);
    expect(invalidated(queryKeys.prices)).toBe(true);
    expect(invalidated(queryKeys.status)).toBe(true);
    expect(queryClient.getQueryData(queryKeys.importRun(importRunDryRun.id))).toEqual(
      importRunDryRun,
    );
  });

  it('a price mutation invalidates prices and status only', async () => {
    mockApi({ 'PUT /api/prices/1/manual': { body: priceItemManualSet } });
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useSetManualPrice(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ instrumentId: 1, input: { price: '13', asOf: '2026-09-24' } }),
    );
    await waitFor(() => expect(invalidated(queryKeys.prices)).toBe(true));
    expect(invalidated(queryKeys.status)).toBe(true);
    expect(invalidated(queryKeys.records)).toBe(false);
    expect(invalidated(queryKeys.importRuns)).toBe(false);
  });

  it('a refresh stores the returned prices', async () => {
    mockApi({ 'POST /api/prices/refresh': { body: refreshResponse } });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.prices, undefined);
    const { result } = renderHook(() => useRefreshPrices(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(queryClient.getQueryData(queryKeys.prices)).toEqual(refreshResponse.prices);
    await waitFor(() => expect(invalidated(queryKeys.status)).toBe(true));
  });
});
