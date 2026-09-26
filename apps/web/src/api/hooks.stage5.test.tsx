// Stage 5 API layer (stage-5.md §6.2): the query keys, the view override sent as the query (never
// saved), the previous response kept while a view loads, the three history mutations and what they
// invalidate, and the settings save's wider invalidation.
import {
  cashPages,
  correctionResponse,
  deleteSnapshotResponse,
  historyPages,
  netWorthPages,
  recordResponse,
  settingsPages,
  settingsPatchResponse,
  superPages,
} from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import {
  invalidateAfterHistoryChange,
  queryKeys,
  useCorrectSnapshot,
  useDeleteSnapshot,
  useHistorySeries,
  useNetWorthPage,
  usePatchSettings,
  useRecordMonths,
  type ChartView,
} from './hooks';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;
  return { queryClient, wrapper, invalidated };
}

/** Seeds every page a history change or a settings save must refresh. */
function seedPages(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.netWorthPage({}), netWorthPages.populated);
  queryClient.setQueryData(queryKeys.history, historyPages.populated);
  queryClient.setQueryData(queryKeys.historySeriesPage({ unit: 'quarterly' }), {});
  queryClient.setQueryData(queryKeys.cash, cashPages.populated);
  queryClient.setQueryData(queryKeys.super, superPages.populated);
  queryClient.setQueryData(queryKeys.settings, settingsPages.populated);
  queryClient.setQueryData(queryKeys.records, {});
  queryClient.setQueryData(queryKeys.importRuns, { runs: [] });
  queryClient.setQueryData(queryKeys.status, {});
  queryClient.setQueryData(queryKeys.prices, {});
}

describe('Stage 5 query keys', () => {
  it('uses the planned keys (§6.2)', () => {
    expect(queryKeys.netWorthPage({})).toEqual(['net-worth', null, null]);
    expect(queryKeys.netWorthPage({ unit: 'quarterly', count: 8 })).toEqual([
      'net-worth',
      'quarterly',
      8,
    ]);
    expect(queryKeys.history).toEqual(['history']);
    expect(queryKeys.historySeriesPage({ unit: 'yearly' })).toEqual([
      'history-series',
      'yearly',
      null,
    ]);
    expect(queryKeys.settings).toEqual(['settings']);
  });
});

describe('view overrides', () => {
  it('sends the unit and count as the query and keeps the previous page while loading', async () => {
    let resolveQuarterly: (() => void) | null = null;
    const api = mockApi({
      'GET /api/net-worth': (req) =>
        req.query.get('unit') === 'quarterly'
          ? new Promise((resolve) => {
              resolveQuarterly = () => resolve({ body: netWorthPages.quarterly });
            })
          : { body: netWorthPages.populated },
    });
    const { wrapper } = setup();
    const { result } = renderHook(
      () => {
        const [view, setView] = useState<ChartView>({});
        return { query: useNetWorthPage(view), setView };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.query.data?.charts.unit).toBe('monthly'));
    expect(api.calls('GET /api/net-worth')[0]?.query.toString()).toBe('');
    act(() => result.current.setView({ unit: 'quarterly', count: 8 }));
    await waitFor(() => expect(api.calls('GET /api/net-worth')).toHaveLength(2));
    const second = api.calls('GET /api/net-worth')[1];
    expect(second?.query.get('unit')).toBe('quarterly');
    expect(second?.query.get('count')).toBe('8');
    // The previous response stays on screen, flagged as a placeholder (the charts dim).
    expect(result.current.query.data?.charts.unit).toBe('monthly');
    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.isPending).toBe(false);
    act(() => resolveQuarterly?.());
    await waitFor(() => expect(result.current.query.data?.charts.unit).toBe('quarterly'));
    expect(result.current.query.isPlaceholderData).toBe(false);
    // A view is never saved.
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });

  it('reads the series only while enabled', async () => {
    const api = mockApi({ 'GET /api/history/series': { body: { groups: [] } } });
    const { wrapper } = setup();
    renderHook(() => useHistorySeries({ unit: 'yearly' }, { enabled: false }), { wrapper });
    expect(api.calls('GET /api/history/series')).toHaveLength(0);
    renderHook(() => useHistorySeries({ unit: 'yearly', count: 6 }), { wrapper });
    await waitFor(() => expect(api.calls('GET /api/history/series')).toHaveLength(1));
    expect(api.calls('GET /api/history/series')[0]?.query.get('count')).toBe('6');
  });
});

describe('history mutations (§4.2, §6.2)', () => {
  it('record posts the months and note and closes every provisional period', async () => {
    const api = mockApi({ 'POST /api/history/record': { status: 201, body: recordResponse } });
    const { wrapper, invalidated, queryClient } = setup();
    seedPages(queryClient);
    const { result } = renderHook(() => useRecordMonths(), { wrapper });
    await act(() => result.current.mutateAsync({ periodMonths: ['2026-09'], note: null }));
    expect(api.calls('POST /api/history/record')[0]?.body).toEqual({
      periodMonths: ['2026-09'],
      note: null,
    });
    await waitFor(() => expect(invalidated(queryKeys.history)).toBe(true));
    for (const key of [
      queryKeys.netWorthPage({}),
      queryKeys.historySeriesPage({ unit: 'quarterly' }),
      queryKeys.cash,
      queryKeys.super,
      queryKeys.records,
      queryKeys.importRuns,
      queryKeys.status,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    expect(invalidated(queryKeys.prices)).toBe(false);
  });

  it('correct PUTs the month with the changed values; delete DELETEs it', async () => {
    const api = mockApi({
      'PUT /api/history/snapshots/2026-06': { body: correctionResponse },
      'DELETE /api/history/snapshots/2026-07': { body: deleteSnapshotResponse },
    });
    const { wrapper, invalidated, queryClient } = setup();
    seedPages(queryClient);
    const correct = renderHook(() => useCorrectSnapshot(), { wrapper });
    await act(() =>
      correct.result.current.mutateAsync({
        periodMonth: '2026-06',
        body: { values: { cashValueCents: 100 }, note: 'Typo' },
      }),
    );
    expect(api.calls('PUT /api/history/snapshots/2026-06')[0]?.body).toEqual({
      values: { cashValueCents: 100 },
      note: 'Typo',
    });
    await waitFor(() => expect(invalidated(queryKeys.history)).toBe(true));
    const remove = renderHook(() => useDeleteSnapshot(), { wrapper });
    await act(() => remove.result.current.mutateAsync('2026-07'));
    expect(api.calls('DELETE /api/history/snapshots/2026-07')).toHaveLength(1);
  });

  it('the Stage 2–4 helpers also refresh net worth and history', async () => {
    const { invalidated, queryClient } = setup();
    seedPages(queryClient);
    await invalidateAfterHistoryChange(queryClient);
    expect(invalidated(queryKeys.netWorthPage({}))).toBe(true);
  });
});

describe('settings save (§6.2)', () => {
  it('refreshes every page key, the Settings page and the status (not prices)', async () => {
    mockApi({ 'PATCH /api/settings': { body: settingsPatchResponse } });
    const { wrapper, invalidated, queryClient } = setup();
    seedPages(queryClient);
    const { result } = renderHook(() => usePatchSettings(), { wrapper });
    await act(() => result.current.mutateAsync({ values: { 'savings.yearBasis': 'calendar' } }));
    await waitFor(() => expect(invalidated(queryKeys.settings)).toBe(true));
    for (const key of [
      queryKeys.netWorthPage({}),
      queryKeys.history,
      queryKeys.cash,
      queryKeys.super,
      queryKeys.records,
      queryKeys.importRuns,
      queryKeys.status,
    ]) {
      expect(invalidated(key)).toBe(true);
    }
    expect(invalidated(queryKeys.prices)).toBe(false);
  });
});
