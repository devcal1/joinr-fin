// Stage 6 API layer (stage-6.md §6.2): the ['fire', query] key, the what-if sent as the query
// (only the given fields; never saved), the previous response kept while a what-if loads, the
// "Use the workbook's figure" POST, and ['fire'] refreshed by every invalidation that moves an
// input (settings, history, trades, cash flow, assets, prices, imports).
import { firePages, fireSettingsPatchResponse } from '@joinr/schema/fixtures';
import type { FireQuery } from '@joinr/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import {
  FIRE_POLL_MS,
  invalidateAfterAssetsChange,
  invalidateAfterCashflowChange,
  invalidateAfterHistoryChange,
  invalidateAfterImport,
  invalidateAfterInvestmentChange,
  invalidateAfterSettingsChange,
  queryKeys,
  useFire,
  usePatchSettings,
  useUseWorkbookContribution,
} from './hooks';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;
  return { queryClient, wrapper, invalidated };
}

describe('the FIRE query key', () => {
  it('is ["fire", query] with {} for the saved settings', () => {
    expect(queryKeys.fire).toEqual(['fire']);
    expect(queryKeys.firePage(null)).toEqual(['fire', {}]);
    expect(queryKeys.firePage({ spend: 4_500_000 })).toEqual(['fire', { spend: 4_500_000 }]);
    expect(FIRE_POLL_MS).toBe(60_000);
  });
});

describe('useFire', () => {
  it('sends the what-if as the query and keeps the previous page while it loads', async () => {
    let release: (() => void) | null = null;
    const api = mockApi({
      'GET /api/fire': (req) =>
        [...req.query.keys()].length === 0
          ? { body: firePages.onTrack }
          : new Promise((resolve) => {
              release = () => resolve({ body: firePages.whatIf });
            }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(
      () => {
        const [query, setQuery] = useState<FireQuery | null>(null);
        return { fire: useFire(query), setQuery };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.fire.data).toEqual(firePages.onTrack));
    expect(api.calls('GET /api/fire')[0]?.query.toString()).toBe('');

    act(() => result.current.setQuery({ spend: 5_000_000, withdrawalRate: '0.045' }));
    await waitFor(() => expect(api.calls('GET /api/fire')).toHaveLength(2));
    expect(Object.fromEntries(api.calls('GET /api/fire')[1]?.query ?? [])).toEqual({
      spend: '5000000',
      withdrawalRate: '0.045',
    });
    // The previous response stays on screen while the what-if loads.
    expect(result.current.fire.isPlaceholderData).toBe(true);
    expect(result.current.fire.data).toEqual(firePages.onTrack);
    act(() => release?.());
    await waitFor(() => expect(result.current.fire.data).toEqual(firePages.whatIf));
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });
});

describe('useUseWorkbookContribution', () => {
  it('POSTs with no body and refreshes the FIRE pages and Settings', async () => {
    const api = mockApi({
      'POST /api/fire/use-workbook-contribution': { body: fireSettingsPatchResponse },
    });
    const { wrapper, queryClient, invalidated } = setup();
    queryClient.setQueryData(queryKeys.firePage(null), firePages.workbookContribution);
    queryClient.setQueryData(queryKeys.firePage({ spend: 1 }), firePages.whatIf);
    queryClient.setQueryData(queryKeys.settings, {});
    const { result } = renderHook(() => useUseWorkbookContribution(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    const call = api.calls('POST /api/fire/use-workbook-contribution')[0];
    expect(call?.body).toBeUndefined();
    expect(invalidated(queryKeys.firePage(null))).toBe(true);
    expect(invalidated(queryKeys.firePage({ spend: 1 }))).toBe(true);
    expect(invalidated(queryKeys.settings)).toBe(true);
  });
});

describe('every input change refreshes FIRE', () => {
  it.each([
    ['settings', invalidateAfterSettingsChange],
    ['history', invalidateAfterHistoryChange],
    ['investments', invalidateAfterInvestmentChange],
    ['cash flow', invalidateAfterCashflowChange],
    ['assets', invalidateAfterAssetsChange],
    ['import', invalidateAfterImport],
  ] as const)('after a %s change', async (_name, invalidate) => {
    const { queryClient, invalidated } = setup();
    queryClient.setQueryData(queryKeys.firePage(null), firePages.onTrack);
    queryClient.setQueryData(queryKeys.firePage({ accessAge: 62 }), firePages.whatIf);
    await invalidate(queryClient);
    expect(invalidated(queryKeys.firePage(null))).toBe(true);
    expect(invalidated(queryKeys.firePage({ accessAge: 62 }))).toBe(true);
  });

  it('after a settings save (the FIRE page’s Save)', async () => {
    mockApi({ 'PATCH /api/settings': { body: fireSettingsPatchResponse } });
    const { wrapper, queryClient, invalidated } = setup();
    queryClient.setQueryData(queryKeys.firePage(null), firePages.onTrack);
    const { result } = renderHook(() => usePatchSettings(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ values: { 'fire.extraSavingsPerYearCents': 500_000 } });
    });
    expect(invalidated(queryKeys.firePage(null))).toBe(true);
  });
});
