import {
  appStatusEmpty,
  holdingDetails,
  importRunDryRun,
  investmentPages,
  investmentTrades,
  priceItemManualSet,
  pricesLive,
  recordsIndex,
  refreshResponse,
  tradeInputExamples,
  tradeMutationResponse,
} from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { apiGet } from './client';
import {
  queryKeys,
  useCreateTrade,
  useDeleteInstrument,
  useImportWorkbook,
  useRefreshPrices,
  useSetManualPrice,
} from './hooks';

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

  it('uses the planned investment query keys (stage-2 §6.2)', () => {
    expect(queryKeys.investments).toEqual(['investments']);
    expect(queryKeys.investmentPage('etf')).toEqual(['investments', 'etf']);
    expect(queryKeys.investmentTrades('etf')).toEqual(['investments', 'etf', 'trades']);
    expect(queryKeys.instruments).toEqual(['instruments']);
    expect(queryKeys.holdingDetail(4)).toEqual(['instruments', 4]);
  });

  it('an import and a price change also invalidate the investment figures', async () => {
    mockApi({
      'POST /api/import': { body: importRunDryRun },
      'PUT /api/prices/1/manual': { body: priceItemManualSet },
    });
    const { wrapper, invalidated, queryClient } = setup();
    const seedInvestments = () => {
      queryClient.setQueryData(queryKeys.investmentPage('etf'), investmentPages.etf);
      queryClient.setQueryData(queryKeys.investmentTrades('etf'), investmentTrades.etf);
      queryClient.setQueryData(queryKeys.holdingDetail(4), holdingDetails[4]);
    };
    seedInvestments();
    const imports = renderHook(() => useImportWorkbook(), { wrapper });
    await act(() =>
      imports.result.current.mutateAsync({
        file: new File(['x'], 'example.xlsx'),
        dryRun: true,
        confirmReplace: false,
      }),
    );
    await waitFor(() => expect(invalidated(queryKeys.investmentPage('etf'))).toBe(true));
    expect(invalidated(queryKeys.investmentTrades('etf'))).toBe(true);
    expect(invalidated(queryKeys.holdingDetail(4))).toBe(true);

    seedInvestments();
    const price = renderHook(() => useSetManualPrice(), { wrapper });
    await act(() =>
      price.result.current.mutateAsync({
        instrumentId: 1,
        input: { price: '13', asOf: '2026-09-24' },
      }),
    );
    await waitFor(() => expect(invalidated(queryKeys.investmentPage('etf'))).toBe(true));
    expect(invalidated(queryKeys.holdingDetail(4))).toBe(true);
  });

  it('a trade mutation invalidates investments, instruments, prices, records, import and status', async () => {
    mockApi({
      'POST /api/trades': { status: 201, body: tradeMutationResponse },
      'DELETE /api/instruments/13': { body: { id: 13 } },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.investmentPage('etf'), investmentPages.etf);
    queryClient.setQueryData(queryKeys.holdingDetail(4), holdingDetails[4]);
    const { result } = renderHook(() => useCreateTrade(), { wrapper });
    await act(() => result.current.mutateAsync(tradeInputExamples.amount));
    await waitFor(() => expect(invalidated(queryKeys.investmentPage('etf'))).toBe(true));
    for (const key of [
      queryKeys.holdingDetail(4),
      queryKeys.prices,
      queryKeys.records,
      queryKeys.importRuns,
      queryKeys.status,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    const remove = renderHook(() => useDeleteInstrument(), { wrapper });
    await act(() => remove.result.current.mutateAsync(13));
  });

  it('deleting a holding never refetches its own detail (it would answer 404)', async () => {
    const api = mockApi({
      'GET /api/instruments/4': { body: holdingDetails[4] },
      'GET /api/instruments/13': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x' } },
      },
      'DELETE /api/instruments/13': { body: { id: 13 } },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.investmentPage('etf'), investmentPages.etf);
    queryClient.setQueryData(queryKeys.holdingDetail(4), holdingDetails[4]);
    queryClient.setQueryData(queryKeys.holdingDetail(13), holdingDetails[4]);
    // Both details are on screen (active observers), as on the deleted holding's own page.
    const observe = (id: number) =>
      renderHook(
        () =>
          useQuery({
            queryKey: queryKeys.holdingDetail(id),
            queryFn: () => apiGet(`/api/instruments/${id}`),
          }),
        { wrapper },
      );
    observe(4);
    observe(13);
    const remove = renderHook(() => useDeleteInstrument(), { wrapper });
    await act(() => remove.result.current.mutateAsync(13));
    await waitFor(() => expect(api.calls('GET /api/instruments/4')).toHaveLength(1));
    expect(invalidated(queryKeys.investmentPage('etf'))).toBe(true);
    expect(invalidated(queryKeys.importRuns)).toBe(true);
    expect(invalidated(queryKeys.holdingDetail(13))).toBe(true);
    expect(api.calls('GET /api/instruments/13')).toHaveLength(0);
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
