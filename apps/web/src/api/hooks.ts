// TanStack Query hooks for the API. Query keys are fixed by the plans:
// Stage 1 (stage-1.md §6.2): ['records'], ['records', id], ['import', 'runs'], ['import', 'run', id],
// ['prices'], ['status']. Stage 2 (stage-2.md §6.2): ['investments', kind],
// ['investments', kind, 'trades'], ['instruments', id].
import type {
  AppStatus,
  DeletedResponse,
  HoldingDetailResponse,
  InstrumentCreateBody,
  InstrumentDto,
  InstrumentEditableBody,
  InstrumentKind,
  InvestmentPageResponse,
  InvestmentTradesResponse,
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
  TradeInputBody,
  TradeMutationResponse,
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
  investments: ['investments'] as const,
  investmentPage: (kind: InstrumentKind) => ['investments', kind] as const,
  investmentTrades: (kind: InstrumentKind) => ['investments', kind, 'trades'] as const,
  instruments: ['instruments'] as const,
  holdingDetail: (id: number) => ['instruments', id] as const,
};

/** How often a page polls while the server reports work in progress. */
export const BUSY_POLL_MS = 2_000;
/** The prices page refetches every minute while it is visible. */
export const PRICES_POLL_MS = 60_000;
/** The header's freshness line refetches every minute. */
export const STATUS_POLL_MS = 60_000;
/** The investment pages, ledgers and holding details refetch every minute while visible. */
export const INVESTMENTS_POLL_MS = 60_000;

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

/** `GET /api/investments/:kind`: the page (tiles, holdings, allocation, timing, charts). */
export function useInvestmentPage(
  kind: InstrumentKind,
  options: { enabled?: boolean } = {},
): UseQueryResult<InvestmentPageResponse> {
  return useQuery({
    queryKey: queryKeys.investmentPage(kind),
    queryFn: () => apiGet<InvestmentPageResponse>(`/api/investments/${encodeURIComponent(kind)}`),
    refetchInterval: INVESTMENTS_POLL_MS,
    refetchIntervalInBackground: false,
    enabled: options.enabled ?? true,
  });
}

/** `GET /api/investments/:kind/trades`: the kind's ledger, newest first. */
export function useInvestmentTrades(
  kind: InstrumentKind,
): UseQueryResult<InvestmentTradesResponse> {
  return useQuery({
    queryKey: queryKeys.investmentTrades(kind),
    queryFn: () =>
      apiGet<InvestmentTradesResponse>(`/api/investments/${encodeURIComponent(kind)}/trades`),
    refetchInterval: INVESTMENTS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/instruments/:id`: one holding with its parcels, disposals, trades and dividends. */
export function useHoldingDetail(id: number): UseQueryResult<HoldingDetailResponse> {
  return useQuery({
    queryKey: queryKeys.holdingDetail(id),
    queryFn: () => apiGet<HoldingDetailResponse>(`/api/instruments/${id}`),
    refetchInterval: INVESTMENTS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────────────────────

export interface ImportRequest {
  file: File;
  dryRun: boolean;
  confirmReplace: boolean;
}

/**
 * Everything an import can change: records, import runs, prices, the header status and the
 * investment figures (pages, ledgers and holding details).
 */
export function invalidateAfterImport(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
  ]).then(() => undefined);
}

/** A refresh, a manual price or a source change: prices, status and every investment figure. */
function invalidatePrices(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
  ]).then(() => undefined);
}

/**
 * After a trade or instrument change: the investment figures, prices (held status), records, the
 * import runs (`hasAppData` changes) and the header status (stage-2.md §6.2).
 */
export function invalidateAfterInvestmentChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
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

// ─── Investments: trades and instruments (stage-2.md §4.2, §6.2) ─────────────────────────────

export interface UpdateTradeRequest {
  id: number;
  body: TradeInputBody;
}

/** `POST /api/trades` → 201 with the trade as the engine recomputes it. */
export function useCreateTrade(): UseMutationResult<TradeMutationResponse, Error, TradeInputBody> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TradeInputBody) =>
      apiSend<TradeMutationResponse>('POST', '/api/trades', body),
    onSuccess: () => invalidateAfterInvestmentChange(queryClient),
  });
}

/** `PUT /api/trades/:id` (the instrument cannot change). */
export function useUpdateTrade(): UseMutationResult<
  TradeMutationResponse,
  Error,
  UpdateTradeRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateTradeRequest) =>
      apiSend<TradeMutationResponse>('PUT', `/api/trades/${id}`, body),
    onSuccess: () => invalidateAfterInvestmentChange(queryClient),
  });
}

/** `DELETE /api/trades/:id` (422 TRADE_OVERSELL when a later sell needs this buy). */
export function useDeleteTrade(): UseMutationResult<DeletedResponse, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiSend<DeletedResponse>('DELETE', `/api/trades/${id}`),
    onSuccess: () => invalidateAfterInvestmentChange(queryClient),
  });
}

/** `POST /api/instruments` → 201 (409 INSTRUMENT_EXISTS for the same kind and symbol). */
export function useCreateInstrument(): UseMutationResult<
  InstrumentDto,
  Error,
  InstrumentCreateBody
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InstrumentCreateBody) =>
      apiSend<InstrumentDto>('POST', '/api/instruments', body),
    onSuccess: () => invalidateAfterInvestmentChange(queryClient),
  });
}

export interface UpdateInstrumentRequest {
  id: number;
  body: InstrumentEditableBody;
}

/** `PUT /api/instruments/:id`: a full replace of the editable fields. */
export function useUpdateInstrument(): UseMutationResult<
  InstrumentDto,
  Error,
  UpdateInstrumentRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateInstrumentRequest) =>
      apiSend<InstrumentDto>('PUT', `/api/instruments/${id}`, body),
    onSuccess: () => invalidateAfterInvestmentChange(queryClient),
  });
}

/**
 * After a holding is deleted: the same keys as `invalidateAfterInvestmentChange`, except that the
 * deleted holding's own detail is only marked stale. Its page is still mounted until it navigates
 * away, and a refetch there could only answer 404 (a console error in the browser).
 */
export function invalidateAfterInstrumentDelete(
  queryClient: QueryClient,
  id: number,
): Promise<void> {
  const deleted = queryKeys.holdingDetail(id);
  return Promise.all([
    queryClient.cancelQueries({ queryKey: deleted, exact: true }),
    queryClient.invalidateQueries({ queryKey: deleted, exact: true, refetchType: 'none' }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.instruments,
      predicate: (query) => query.queryKey[1] !== id,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
  ]).then(() => undefined);
}

/** `DELETE /api/instruments/:id` (409 INSTRUMENT_IN_USE while trades or dividends reference it). */
export function useDeleteInstrument(): UseMutationResult<DeletedResponse, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiSend<DeletedResponse>('DELETE', `/api/instruments/${id}`),
    onSuccess: (_result, id) => invalidateAfterInstrumentDelete(queryClient, id),
  });
}
