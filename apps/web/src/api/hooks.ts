// TanStack Query hooks for the Stage 1 API (stage-1.md §6.2). Query keys are fixed by the plan:
// ['records'], ['records', id], ['import', 'runs'], ['import', 'run', id], ['prices'], ['status'].
import type {
  AppStatus,
  ImportRunDetail,
  ImportRunsResponse,
  ManualPriceInput,
  PriceItem,
  PriceSourceInput,
  PricesResponse,
  RecordEntityId,
  RecordsIndexResponse,
  RecordsPageResponse,
  RefreshResponse,
} from '@joinr/schema';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiGet, apiSend, apiUpload } from './client';

export const queryKeys = {
  records: ['records'] as const,
  recordsPage: (entity: RecordEntityId) => ['records', entity] as const,
  import: ['import'] as const,
  importRuns: ['import', 'runs'] as const,
  importRun: (id: number) => ['import', 'run', id] as const,
  prices: ['prices'] as const,
  status: ['status'] as const,
};

/** How often a page polls while the server reports work in progress. */
export const BUSY_POLL_MS = 2_000;
/** The prices page refetches every minute while it is visible. */
export const PRICES_POLL_MS = 60_000;
/** The header's freshness line refetches every minute. */
export const STATUS_POLL_MS = 60_000;

// ─── Queries ──────────────────────────────────────────────────────────────────────────────────

export function useStatus(): UseQueryResult<AppStatus> {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => apiGet<AppStatus>('/api/status'),
    refetchInterval: STATUS_POLL_MS,
  });
}

export function useRecordsIndex(): UseQueryResult<RecordsIndexResponse> {
  return useQuery({
    queryKey: queryKeys.records,
    queryFn: () => apiGet<RecordsIndexResponse>('/api/records'),
  });
}

export function useRecordsPage(entity: RecordEntityId): UseQueryResult<RecordsPageResponse> {
  return useQuery({
    queryKey: queryKeys.recordsPage(entity),
    queryFn: () => apiGet<RecordsPageResponse>(`/api/records/${encodeURIComponent(entity)}`),
  });
}

export function useImportRuns(): UseQueryResult<ImportRunsResponse> {
  return useQuery({
    queryKey: queryKeys.importRuns,
    queryFn: () => apiGet<ImportRunsResponse>('/api/import/runs'),
    refetchInterval: (query) => (query.state.data?.inProgress ? BUSY_POLL_MS : false),
  });
}

export function useImportRun(id: number): UseQueryResult<ImportRunDetail> {
  return useQuery({
    queryKey: queryKeys.importRun(id),
    queryFn: () => apiGet<ImportRunDetail>(`/api/import/runs/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? BUSY_POLL_MS : false),
  });
}

export function usePrices(): UseQueryResult<PricesResponse> {
  return useQuery({
    queryKey: queryKeys.prices,
    queryFn: () => apiGet<PricesResponse>('/api/prices'),
    // Every minute while the page is visible (never in a background tab); faster during a run.
    refetchInterval: (query) => (query.state.data?.running ? BUSY_POLL_MS : PRICES_POLL_MS),
    refetchIntervalInBackground: false,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────────────────────

export interface ImportRequest {
  file: File;
  dryRun: boolean;
  confirmReplace: boolean;
}

/** Everything an import can change: records, import runs, prices and the header status. */
export function invalidateAfterImport(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
  ]).then(() => undefined);
}

function invalidatePrices(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
  ]).then(() => undefined);
}

/** `POST /api/import`: a dry run (preview) or a committed import. */
export function useImportWorkbook(): UseMutationResult<ImportRunDetail, Error, ImportRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun, confirmReplace }: ImportRequest) =>
      apiUpload<ImportRunDetail>('/api/import', file, {
        dryRun: dryRun ? 'true' : undefined,
        confirmReplace: confirmReplace ? 'true' : undefined,
      }),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.importRun(run.id), run);
    },
    // A failed import is recorded as a run too, so refresh the list either way.
    onSettled: () => invalidateAfterImport(queryClient),
  });
}

/** `POST /api/prices/refresh` with `force: true` ("Refresh now" ignores the backoff). */
export function useRefreshPrices(): UseMutationResult<RefreshResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend<RefreshResponse>('POST', '/api/prices/refresh', { force: true }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.prices, result.prices);
    },
    onSettled: () => invalidatePrices(queryClient),
  });
}

export interface ManualPriceRequest {
  instrumentId: number;
  input: ManualPriceInput;
}

export function useSetManualPrice(): UseMutationResult<PriceItem, Error, ManualPriceRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instrumentId, input }: ManualPriceRequest) =>
      apiSend<PriceItem>('PUT', `/api/prices/${instrumentId}/manual`, input),
    onSuccess: () => invalidatePrices(queryClient),
  });
}

export function useClearManualPrice(): UseMutationResult<PriceItem, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instrumentId: number) =>
      apiSend<PriceItem>('DELETE', `/api/prices/${instrumentId}/manual`),
    onSuccess: () => invalidatePrices(queryClient),
  });
}

export interface PriceSourceRequest {
  instrumentId: number;
  input: PriceSourceInput;
}

export function useSetPriceSource(): UseMutationResult<PriceItem, Error, PriceSourceRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instrumentId, input }: PriceSourceRequest) =>
      apiSend<PriceItem>('PUT', `/api/prices/${instrumentId}/source`, input),
    onSuccess: () => invalidatePrices(queryClient),
  });
}
