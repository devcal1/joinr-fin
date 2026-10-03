// Stage 9 API layer (stage-9.md §8.1): the ['phone'] key; `GET /api/phone` polled every 2 s only
// while a pairing code is open; open (POST), cancel (DELETE) and revoke (POST …/revoke), each
// writing the answered section into ['phone'] and refetching it on settle, after a failure too.
import { phoneSections } from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import {
  BUSY_POLL_MS,
  queryKeys,
  useCancelPairing,
  useOpenPairing,
  usePhone,
  useRevokePhone,
} from './hooks';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the phone query key', () => {
  it("is ['phone']", () => {
    expect(queryKeys.phone).toEqual(['phone']);
  });
});

describe('usePhone', () => {
  it('reads GET /api/phone and does not poll while no code is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi({ 'GET /api/phone': { body: phoneSections.onePhone } });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePhone(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(phoneSections.onePhone));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS * 3);
    });
    expect(api.calls('GET /api/phone')).toHaveLength(1);
  });

  it('polls every 2 s while a code is open, and stops when it closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let open = true;
    const api = mockApi({
      'GET /api/phone': () => ({
        body: open ? phoneSections.pairingOpen : phoneSections.justPaired,
      }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePhone(), { wrapper });
    await waitFor(() => expect(result.current.data?.pairing).not.toBeNull());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(api.calls('GET /api/phone').length).toBeGreaterThanOrEqual(2));
    open = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(result.current.data?.pairing).toBeNull());
    const settled = api.calls('GET /api/phone').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS * 3);
    });
    expect(api.calls('GET /api/phone')).toHaveLength(settled);
  });
});

describe('the phone mutations', () => {
  it('open: POST /api/phone/pairing with no body; the section is written at once, then refetched', async () => {
    const api = mockApi({
      'POST /api/phone/pairing': { status: 201, body: phoneSections.pairingOpen },
      'GET /api/phone': { body: phoneSections.pairingOpen },
    });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useOpenPairing(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(api.calls('POST /api/phone/pairing')[0]?.body).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.phone)).toEqual(phoneSections.pairingOpen);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['phone'] });
  });

  it('cancel: DELETE /api/phone/pairing', async () => {
    const api = mockApi({ 'DELETE /api/phone/pairing': { body: phoneSections.none } });
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useCancelPairing(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(api.calls('DELETE /api/phone/pairing')).toHaveLength(1);
    expect(queryClient.getQueryData(queryKeys.phone)).toEqual(phoneSections.none);
  });

  it('revoke: POST /api/phone/devices/:id/revoke; a failure still refetches the section', async () => {
    const api = mockApi({
      'POST /api/phone/devices/d_0000000000000001/revoke': { body: phoneSections.none },
      'POST /api/phone/devices/d_0000000000000009/revoke': apiError(404, {
        error: { code: 'NOT_FOUND', message: 'No such phone.' },
      }),
    });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevokePhone(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('d_0000000000000001');
    });
    expect(api.calls('POST /api/phone/devices/d_0000000000000001/revoke')).toHaveLength(1);
    invalidate.mockClear();
    await act(async () => {
      await expect(result.current.mutateAsync('d_0000000000000009')).rejects.toThrow(
        'No such phone.',
      );
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['phone'] });
  });
});
