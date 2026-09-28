// Stage 7 API layer (stage-7.md §6.1): the ['backups'] key, `GET /api/backups` polled every 2 s only
// while a backup runs, and "Back up now" (`POST /api/backups`, no body) refreshing ['backups'] and
// ['status'] on settle, after a failure too (a failed run changes the last run and the stale flag).
// Stage 8 (stage-8.md §8.1): the list also polls while a copy to the NAS runs, and "Copy to NAS now"
// (`POST /api/backups/nas-copy`, no body, 202) refreshes the same two keys on settle.
import {
  apiErrors,
  backupNowResponses,
  backupsPages,
  nasCopyNowResponses,
  nasCopyStates,
} from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { BUSY_POLL_MS, queryKeys, useBackupNow, useBackups, useNasCopyNow } from './hooks';

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

describe('the backups query key', () => {
  it("is ['backups']", () => {
    expect(queryKeys.backups).toEqual(['backups']);
    expect(BUSY_POLL_MS).toBe(2_000);
  });
});

describe('useBackups', () => {
  it('reads GET /api/backups and does not poll while nothing runs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi({ 'GET /api/backups': { body: backupsPages.typical } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBackups(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(backupsPages.typical));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS * 3);
    });
    expect(api.calls('GET /api/backups')).toHaveLength(1);
  });

  it('polls every 2 s while a backup runs, and stops when it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    const api = mockApi({
      'GET /api/backups': () => ({
        body: running ? backupsPages.running : backupsPages.typical,
      }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBackups(), { wrapper });
    await waitFor(() => expect(result.current.data?.running).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(api.calls('GET /api/backups').length).toBeGreaterThanOrEqual(2));
    running = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(result.current.data?.running).toBe(false));
    const settled = api.calls('GET /api/backups').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS * 3);
    });
    expect(api.calls('GET /api/backups')).toHaveLength(settled);
  });
});

describe('useBackupNow', () => {
  it.each([
    ['success', { status: 201, body: backupNowResponses.created }],
    ['a 500', apiError(500, apiErrors.backupFailed)],
    ['a 409', apiError(409, apiErrors.inProgress)],
  ])('POSTs once with no body and refreshes backups and status after %s', async (_name, reply) => {
    const api = mockApi({ 'POST /api/backups': reply });
    const { queryClient, wrapper } = setup();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useBackupNow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    const posts = api.calls('POST /api/backups');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBeUndefined();
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(queryKeys.backups);
    expect(keys).toContainEqual(queryKeys.status);
  });

  it("gives the server's message on a failure", async () => {
    mockApi({ 'POST /api/backups': apiError(500, apiErrors.backupFailed) });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBackupNow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Not enough free space on the server');
  });
});

describe('useBackups while a copy to the NAS runs (stage-8.md §8.1)', () => {
  it('polls every 2 s while nasCopy.running, and stops when it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    const api = mockApi({
      'GET /api/backups': () => ({
        body: {
          ...backupsPages.typical,
          nasCopy: running ? nasCopyStates.running : nasCopyStates.succeeded,
        },
      }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBackups(), { wrapper });
    await waitFor(() => expect(result.current.data?.nasCopy.running).toBe(true));
    expect(result.current.data?.running).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(api.calls('GET /api/backups').length).toBeGreaterThanOrEqual(2));
    running = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS + 50);
    });
    await waitFor(() => expect(result.current.data?.nasCopy.running).toBe(false));
    const settled = api.calls('GET /api/backups').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BUSY_POLL_MS * 3);
    });
    expect(api.calls('GET /api/backups')).toHaveLength(settled);
  });
});

describe('useNasCopyNow (stage-8.md §8.1)', () => {
  it.each([
    ['a 202 (started)', { status: 202, body: nasCopyNowResponses.started }],
    ['a 202 (joined)', { status: 202, body: nasCopyNowResponses.joined }],
    ['a 409 (not ready)', apiError(409, apiErrors.nasCopyNotReady)],
    ['a 409 (fix first)', apiError(409, apiErrors.nasCopyFixFirst)],
  ])('POSTs once with no body and refreshes backups and status after %s', async (_name, reply) => {
    const api = mockApi({ 'POST /api/backups/nas-copy': reply });
    const { queryClient, wrapper } = setup();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useNasCopyNow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    const posts = api.calls('POST /api/backups/nas-copy');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBeUndefined();
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(queryKeys.backups);
    expect(keys).toContainEqual(queryKeys.status);
  });

  it('returns the 202 body (the running row to follow)', async () => {
    mockApi({ 'POST /api/backups/nas-copy': { status: 202, body: nasCopyNowResponses.started } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useNasCopyNow(), { wrapper });
    let body: unknown;
    await act(async () => {
      body = await result.current.mutateAsync();
    });
    expect(body).toEqual(nasCopyNowResponses.started);
    expect(nasCopyNowResponses.started.nasCopy.lastRun.status).toBe('running');
  });

  it("gives the server's message on a 409", async () => {
    mockApi({ 'POST /api/backups/nas-copy': apiError(409, apiErrors.nasCopyFixFirst) });
    const { wrapper } = setup();
    const { result } = renderHook(() => useNasCopyNow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(apiErrors.nasCopyFixFirst.error.message);
  });
});
