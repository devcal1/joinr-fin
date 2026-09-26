import {
  appStatusEmpty,
  budgetPages,
  cashPages,
  dividendsPages,
  holdingDetails,
  importRunDryRun,
  investmentPages,
  investmentTrades,
  loanOffsetsResponse,
  otherAssetsPages,
  priceItemManualSet,
  pricesLive,
  propertyPages,
  recordsIndex,
  refreshResponse,
  settingsPatchResponse,
  sideIncomePages,
  superPages,
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
  usePatchSettings,
  useRefreshDividendEvents,
  useRefreshPrices,
  useSaveLoanOffsets,
  useSaveSgOverride,
  useSaveSuperOptionNote,
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

  it('uses the planned cash-flow query keys (stage-3 §6.2)', () => {
    expect(queryKeys.cash).toEqual(['cash']);
    expect(queryKeys.sideIncome).toEqual(['side-income']);
    expect(queryKeys.budget).toEqual(['budget']);
    expect(queryKeys.dividends).toEqual(['dividends']);
  });

  it('a cash-flow mutation invalidates the four pages, investments, instruments, records, import and status', async () => {
    const api = mockApi({ 'PATCH /api/settings': { body: settingsPatchResponse } });
    const { wrapper, invalidated, queryClient } = setup();
    const pages = {
      cash: cashPages.populated,
      sideIncome: sideIncomePages.populated,
      budget: budgetPages.autoSplit,
      dividends: dividendsPages.populated,
    } as const;
    for (const [key, page] of Object.entries(pages)) {
      queryClient.setQueryData(queryKeys[key as keyof typeof pages], page);
    }
    queryClient.setQueryData(queryKeys.investmentPage('etf'), investmentPages.etf);
    queryClient.setQueryData(queryKeys.holdingDetail(4), holdingDetails[4]);
    const { result } = renderHook(() => usePatchSettings(), { wrapper });
    await act(() => result.current.mutateAsync({ values: { 'savings.yearBasis': 'calendar' } }));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'savings.yearBasis': 'calendar' },
    });
    await waitFor(() => expect(invalidated(queryKeys.cash)).toBe(true));
    for (const key of [
      queryKeys.sideIncome,
      queryKeys.budget,
      queryKeys.dividends,
      queryKeys.investmentPage('etf'),
      queryKeys.holdingDetail(4),
      queryKeys.records,
      queryKeys.importRuns,
      queryKeys.status,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    // Prices are not moved by a cash-flow change.
    expect(invalidated(queryKeys.prices)).toBe(false);
  });

  it('a trade change and an import also refresh the four cash-flow pages', async () => {
    mockApi({
      'POST /api/trades': { status: 201, body: tradeMutationResponse },
      'POST /api/import': { body: importRunDryRun },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.cash, cashPages.populated);
    queryClient.setQueryData(queryKeys.dividends, dividendsPages.populated);
    const trade = renderHook(() => useCreateTrade(), { wrapper });
    await act(() => trade.result.current.mutateAsync(tradeInputExamples.amount));
    await waitFor(() => expect(invalidated(queryKeys.dividends)).toBe(true));
    expect(invalidated(queryKeys.cash)).toBe(true);
    queryClient.setQueryData(queryKeys.budget, budgetPages.autoSplit);
    const upload = renderHook(() => useImportWorkbook(), { wrapper });
    await act(() =>
      upload.result.current.mutateAsync({
        file: new File(['x'], 'w.xlsx'),
        dryRun: true,
        confirmReplace: false,
      }),
    );
    await waitFor(() => expect(invalidated(queryKeys.budget)).toBe(true));
  });

  it('the suggestion refresh posts an empty body and refreshes the pages even when it fails', async () => {
    const api = mockApi({
      'POST /api/dividends/suggestions/refresh': {
        status: 503,
        body: { error: { code: 'MARKET_DATA_DISABLED', message: 'Market data is switched off' } },
      },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.dividends, dividendsPages.populated);
    const { result } = renderHook(() => useRefreshDividendEvents(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(api.calls('POST /api/dividends/suggestions/refresh')[0]?.body).toBeUndefined();
    await waitFor(() => expect(invalidated(queryKeys.dividends)).toBe(true));
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

  it('uses the planned assets query keys (stage-4 §6.2)', () => {
    expect(queryKeys.otherAssets).toEqual(['other-assets']);
    expect(queryKeys.super).toEqual(['super']);
    expect(queryKeys.property).toEqual(['property']);
  });

  it('a Stage 4 mutation invalidates the assets pages, cash, budget, investments, records, import and status', async () => {
    const api = mockApi({
      'PUT /api/property/loans/1/offsets': { body: loanOffsetsResponse },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.otherAssets, otherAssetsPages.populated);
    queryClient.setQueryData(queryKeys.super, superPages.populated);
    queryClient.setQueryData(queryKeys.property, propertyPages.populated);
    queryClient.setQueryData(queryKeys.cash, cashPages.populated);
    queryClient.setQueryData(queryKeys.budget, budgetPages.autoSplit);
    queryClient.setQueryData(queryKeys.dividends, dividendsPages.populated);
    queryClient.setQueryData(queryKeys.investmentPage('etf'), investmentPages.etf);
    const { result } = renderHook(() => useSaveLoanOffsets(), { wrapper });
    await act(() => result.current.mutateAsync({ loanId: 1, body: { accountIds: [5] } }));
    expect(api.calls('PUT /api/property/loans/1/offsets')[0]?.body).toEqual({ accountIds: [5] });
    await waitFor(() => expect(invalidated(queryKeys.property)).toBe(true));
    for (const key of [
      queryKeys.otherAssets,
      queryKeys.super,
      queryKeys.cash,
      queryKeys.budget,
      queryKeys.investmentPage('etf'),
      queryKeys.records,
      queryKeys.importRuns,
      queryKeys.status,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    // Neither prices nor the dividends move with an assets change.
    expect(invalidated(queryKeys.prices)).toBe(false);
    expect(invalidated(queryKeys.dividends)).toBe(false);
  });

  it('a cash-flow change and a price change also refresh the three assets pages', async () => {
    mockApi({
      'PATCH /api/settings': { body: settingsPatchResponse },
      'PUT /api/prices/1/manual': { body: priceItemManualSet },
    });
    const { wrapper, invalidated, queryClient } = setup();
    queryClient.setQueryData(queryKeys.property, propertyPages.populated);
    const patch = renderHook(() => usePatchSettings(), { wrapper });
    await act(() => patch.result.current.mutateAsync({ values: { 'savings.yearBasis': 'fy' } }));
    await waitFor(() => expect(invalidated(queryKeys.property)).toBe(true));
    queryClient.setQueryData(queryKeys.otherAssets, otherAssetsPages.populated);
    const price = renderHook(() => useSetManualPrice(), { wrapper });
    await act(() =>
      price.result.current.mutateAsync({
        instrumentId: 1,
        input: { price: '13', asOf: '2026-09-24' },
      }),
    );
    await waitFor(() => expect(invalidated(queryKeys.otherAssets)).toBe(true));
  });

  it('month paths are encoded: SG statements and option notes', async () => {
    const api = mockApi({
      'PUT /api/super/sg/2026-08': { body: { month: superPages.populated.sgMonths[1] } },
      'PUT /api/period-notes/super_option/2026-08': {
        body: { note: null },
      },
    });
    const { wrapper } = setup();
    const sg = renderHook(() => useSaveSgOverride(), { wrapper });
    await act(() =>
      sg.result.current.mutateAsync({
        periodMonth: '2026-08',
        body: { grossCents: 1, note: null },
      }),
    );
    expect(api.calls('PUT /api/super/sg/2026-08')).toHaveLength(1);
    const note = renderHook(() => useSaveSuperOptionNote(), { wrapper });
    await act(() => note.result.current.mutateAsync({ periodMonth: '2026-08', note: '' }));
    expect(api.calls('PUT /api/period-notes/super_option/2026-08')[0]?.body).toEqual({ note: '' });
  });
});
