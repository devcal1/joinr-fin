// TanStack Query hooks for the API. Query keys are fixed by the plans:
// Stage 1 (stage-1.md §6.2): ['records'], ['records', id], ['import', 'runs'], ['import', 'run', id],
// ['prices'], ['status']. Stage 2 (stage-2.md §6.2): ['investments', kind],
// ['investments', kind, 'trades'], ['instruments', id]. Stage 3 (stage-3.md §6.2): ['cash'],
// ['side-income'], ['budget'], ['dividends']. Stage 4 (stage-4.md §6.2): ['other-assets'], ['super'],
// ['property']. Stage 5 (stage-5.md §6.2): ['net-worth', unit, count], ['history'],
// ['history-series', unit, count], ['settings'].
import type {
  ChartDateUnit,
  CorrectionResponse,
  DeleteSnapshotResponse,
  HistoryPageResponse,
  HistorySeriesResponse,
  NetWorthPageResponse,
  RecordRequestBody,
  RecordResponse,
  SettingsPageResponse,
  SnapshotCorrectionBody,
  AppStatus,
  LoanBalanceEntryUpdate,
  LoanBalancesInput,
  LoanBalancesResponse,
  LoanCreate,
  LoanMutationResponse,
  LoanOffsetsInput,
  LoanOffsetsResponse,
  LoanUpdate,
  OtherAssetCreateBody,
  OtherAssetMutationResponse,
  OtherAssetPricesInput,
  OtherAssetPricesResponse,
  OtherAssetSaleInput,
  OtherAssetsPageResponse,
  OtherAssetUpdateBody,
  PropertyCreate,
  PropertyMutationResponse,
  PropertyPageResponse,
  PropertyUpdate,
  SgOverrideInput,
  SgOverrideResponse,
  SuperBalancesInput,
  SuperBalancesResponse,
  SuperContributionInput,
  SuperContributionMutationResponse,
  SuperFundCreate,
  SuperFundMutationResponse,
  SuperFundUpdate,
  SuperPageResponse,
  ValuationsInput,
  ValuationsResponse,
  BudgetAutoKind,
  BudgetAutoRowInput,
  BudgetItemInput,
  BudgetItemMutationResponse,
  BudgetPageResponse,
  CashAccountCreate,
  CashAccountMutationResponse,
  CashAccountUpdate,
  CashBalancesInput,
  CashBalancesResponse,
  CashPageResponse,
  DeletedResponse,
  DepositInput,
  DepositMutationResponse,
  DividendEventKey,
  DividendEventsRefreshResponse,
  DividendInputBody,
  DividendMutationResponse,
  DividendsPageResponse,
  EditableNoteKind,
  IncomeStreamInput,
  IncomeStreamMutationResponse,
  IsoMonth,
  PeriodNoteResponse,
  SavingsAdjustmentDto,
  SavingsAdjustmentInput,
  SavingsGoalInput,
  SavingsGoalMutationResponse,
  SettingsPatch,
  SettingsPatchResponse,
  SideIncomePageResponse,
  YearlyExpenseInput,
  YearlyExpenseMutationResponse,
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
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiGet, apiSend, apiUpload, withQuery } from './client';

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
  cash: ['cash'] as const,
  sideIncome: ['side-income'] as const,
  budget: ['budget'] as const,
  dividends: ['dividends'] as const,
  otherAssets: ['other-assets'] as const,
  super: ['super'] as const,
  property: ['property'] as const,
  netWorth: ['net-worth'] as const,
  netWorthPage: (view: ChartView) => ['net-worth', view.unit ?? null, view.count ?? null] as const,
  history: ['history'] as const,
  historySeries: ['history-series'] as const,
  historySeriesPage: (view: ChartView) =>
    ['history-series', view.unit ?? null, view.count ?? null] as const,
  settings: ['settings'] as const,
};

/**
 * A chart view override (the page's view switch, stage-5.md §6.2): sent as the query, never
 * saved. Undefined fields fall back to the saved chart settings on the server.
 */
export interface ChartView {
  unit?: ChartDateUnit;
  count?: number;
}

/** The overview pages' keys (Net Worth, History and its series; stage-5.md §6.2). */
const OVERVIEW_PAGE_KEYS = [
  queryKeys.netWorth,
  queryKeys.history,
  queryKeys.historySeries,
] as const;

/** Stage 5: every Stage 2–4 invalidation also refreshes the overview pages. */
function invalidateOverviewPages(queryClient: QueryClient): Promise<void>[] {
  return OVERVIEW_PAGE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

/** The four cash-flow pages' keys (stage-3.md §6.2). */
const CASHFLOW_PAGE_KEYS = [
  queryKeys.cash,
  queryKeys.sideIncome,
  queryKeys.budget,
  queryKeys.dividends,
] as const;

function invalidateCashflowPages(queryClient: QueryClient): Promise<void>[] {
  return CASHFLOW_PAGE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

/** The three assets pages' keys (stage-4.md §6.2). */
const ASSETS_PAGE_KEYS = [queryKeys.otherAssets, queryKeys.super, queryKeys.property] as const;

function invalidateAssetsPages(queryClient: QueryClient): Promise<void>[] {
  return ASSETS_PAGE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

/** How often a page polls while the server reports work in progress. */
export const BUSY_POLL_MS = 2_000;
/** The prices page refetches every minute while it is visible. */
export const PRICES_POLL_MS = 60_000;
/** The header's freshness line refetches every minute. */
export const STATUS_POLL_MS = 60_000;
/** The investment pages, ledgers and holding details refetch every minute while visible. */
export const INVESTMENTS_POLL_MS = 60_000;
/** The four cash-flow pages refetch every minute while visible (stage-3.md §6.2). */
export const CASHFLOW_POLL_MS = 60_000;
/** The three assets pages refetch every minute while visible (stage-4.md §6.2). */
export const ASSETS_POLL_MS = 60_000;
/** Net Worth and History refetch every minute while visible: the recorder status moves (§6.2). */
export const OVERVIEW_POLL_MS = 60_000;

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

// Stage 3: the cash-flow pages (stage-3.md §4.2, §6.2). Each refetches every minute while visible.

/** `GET /api/cash`: accounts, balance history, savings periods, KPIs, goals, charts, settings. */
export function useCashPage(): UseQueryResult<CashPageResponse> {
  return useQuery({
    queryKey: queryKeys.cash,
    queryFn: () => apiGet<CashPageResponse>('/api/cash'),
    refetchInterval: CASHFLOW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/side-income`: streams, deposits, periods, KPIs and the chart. */
export function useSideIncomePage(): UseQueryResult<SideIncomePageResponse> {
  return useQuery({
    queryKey: queryKeys.sideIncome,
    queryFn: () => apiGet<SideIncomePageResponse>('/api/side-income'),
    refetchInterval: CASHFLOW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/budget`: the live budget. */
export function useBudgetPage(): UseQueryResult<BudgetPageResponse> {
  return useQuery({
    queryKey: queryKeys.budget,
    queryFn: () => apiGet<BudgetPageResponse>('/api/budget'),
    refetchInterval: CASHFLOW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/dividends`: the ledger, summaries, holdings this FY and Yahoo suggestions. */
export function useDividendsPage(): UseQueryResult<DividendsPageResponse> {
  return useQuery({
    queryKey: queryKeys.dividends,
    queryFn: () => apiGet<DividendsPageResponse>('/api/dividends'),
    // Faster while a Yahoo check runs, like the prices page.
    refetchInterval: (query) =>
      query.state.data?.events.running ? BUSY_POLL_MS : CASHFLOW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

// Stage 4: the assets pages (stage-4.md §4.2, §6.2). Each refetches every minute while visible.

/** `GET /api/other-assets`: items, prices, sales, totals, spot, FX and the charts. */
export function useOtherAssetsPage(): UseQueryResult<OtherAssetsPageResponse> {
  return useQuery({
    queryKey: queryKeys.otherAssets,
    queryFn: () => apiGet<OtherAssetsPageResponse>('/api/other-assets'),
    refetchInterval: ASSETS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/super`: funds, balance entries, contributions, SG months, periods and the cap years. */
export function useSuperPage(): UseQueryResult<SuperPageResponse> {
  return useQuery({
    queryKey: queryKeys.super,
    queryFn: () => apiGet<SuperPageResponse>('/api/super'),
    refetchInterval: ASSETS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/property`: properties, valuations, loans with their logs, offsets and the charts. */
export function usePropertyPage(): UseQueryResult<PropertyPageResponse> {
  return useQuery({
    queryKey: queryKeys.property,
    queryFn: () => apiGet<PropertyPageResponse>('/api/property'),
    refetchInterval: ASSETS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

// Stage 5: the overview pages and Settings (stage-5.md §4.2, §6.2).

/** The query string of a view override (undefined fields are dropped). */
function viewQuery(view: ChartView): { unit?: string; count?: number } {
  return { unit: view.unit, count: view.count };
}

/**
 * `GET /api/net-worth[?unit=&count=]`: the dashboard. A view change keeps the previous response
 * on screen (`isPlaceholderData`) until the new one arrives, so the page never unmounts.
 */
export function useNetWorthPage(view: ChartView = {}): UseQueryResult<NetWorthPageResponse> {
  return useQuery({
    queryKey: queryKeys.netWorthPage(view),
    queryFn: () => apiGet<NetWorthPageResponse>(withQuery('/api/net-worth', viewQuery(view))),
    placeholderData: keepPreviousData,
    refetchInterval: OVERVIEW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/history`: recorded months, the live row, the recorder, consistency and the audit. */
export function useHistoryPage(): UseQueryResult<HistoryPageResponse> {
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: () => apiGet<HistoryPageResponse>('/api/history'),
    refetchInterval: OVERVIEW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * `GET /api/history/series?unit=&count=` (the aggregation API): the History chart under a view
 * override. Fetched only while `enabled` (the page shows its own groups otherwise); a view
 * change keeps the previous groups on screen.
 */
export function useHistorySeries(
  view: ChartView,
  options: { enabled?: boolean } = {},
): UseQueryResult<HistorySeriesResponse> {
  return useQuery({
    queryKey: queryKeys.historySeriesPage(view),
    queryFn: () => apiGet<HistorySeriesResponse>(withQuery('/api/history/series', viewQuery(view))),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** `GET /api/settings`: every setting by group, the tax suggestion and the recorder status. */
export function useSettingsPage(
  options: { enabled?: boolean } = {},
): UseQueryResult<SettingsPageResponse> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiGet<SettingsPageResponse>('/api/settings'),
    enabled: options.enabled ?? true,
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
    ...invalidateCashflowPages(queryClient),
    ...invalidateAssetsPages(queryClient),
    ...invalidateOverviewPages(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  ]).then(() => undefined);
}

/**
 * A refresh, a manual price or a source change: prices, status, every investment figure and the
 * cash-flow pages (investment values feed the savings goals and the timing chain), and the assets
 * pages (bullion spot and FX come from the same refresh, stage-4.md §6.2).
 */
function invalidatePrices(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
    ...invalidateCashflowPages(queryClient),
    ...invalidateAssetsPages(queryClient),
    ...invalidateOverviewPages(queryClient),
  ]).then(() => undefined);
}

/**
 * After a trade or instrument change: the investment figures, prices (held status), records, the
 * import runs (`hasAppData` changes) and the header status (stage-2.md §6.2), plus the four
 * cash-flow pages: trades and instruments feed added investments, the last-buy date, units at the
 * ex-date and the dividend suggestions (stage-3.md §6.2).
 */
export function invalidateAfterInvestmentChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.prices }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    ...invalidateCashflowPages(queryClient),
    ...invalidateOverviewPages(queryClient),
  ]).then(() => undefined);
}

/**
 * After any Stage 3 mutation (stage-3.md §6.2): the four cash-flow pages, the investment pages
 * (the live budget and cash feed their timing), holding details, records, the import runs
 * (`hasAppData`) and the header status. Stage 4: also the three assets pages (an offset flag or a
 * balance moves the property figures; stage-4.md §6.2).
 */
export function invalidateAfterCashflowChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    ...invalidateCashflowPages(queryClient),
    ...invalidateAssetsPages(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    ...invalidateOverviewPages(queryClient),
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
    ...invalidateCashflowPages(queryClient),
    ...invalidateOverviewPages(queryClient),
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

// ─── Cash flow (stage-3.md §4.2, §6.2) ───────────────────────────────────────────────────────────
// Every Stage 3 mutation invalidates the same keys (invalidateAfterCashflowChange).

/** A mutation whose success refreshes everything a cash-flow change can move. */
function useCashflowMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateAfterCashflowChange(queryClient),
  });
}

export interface UpdateRequest<Body> {
  id: number;
  body: Body;
}

// Cash

/** `POST /api/cash/accounts` → 201 with the new account (and its opening balance entry). */
export function useCreateCashAccount() {
  return useCashflowMutation((body: CashAccountCreate) =>
    apiSend<CashAccountMutationResponse>('POST', '/api/cash/accounts', body),
  );
}

/** `PUT /api/cash/accounts/:id` (a kind-only change keeps the row's origin). */
export function useUpdateCashAccount() {
  return useCashflowMutation(({ id, body }: UpdateRequest<CashAccountUpdate>) =>
    apiSend<CashAccountMutationResponse>('PUT', `/api/cash/accounts/${id}`, body),
  );
}

/** `DELETE /api/cash/accounts/:id` (409 ACCOUNT_IN_USE while budget rows use it). */
export function useDeleteCashAccount() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/cash/accounts/${id}`),
  );
}

/** `PUT /api/cash/balances`: one as-of date and the changed accounts' balances (D58). */
export function useSaveBalances() {
  return useCashflowMutation((body: CashBalancesInput) =>
    apiSend<CashBalancesResponse>('PUT', '/api/cash/balances', body),
  );
}

/** `DELETE /api/cash/balance-entries/:id` (409 LAST_BALANCE_ENTRY for an account's only entry). */
export function useDeleteBalanceEntry() {
  return useCashflowMutation((id: number) =>
    apiSend<CashAccountMutationResponse>('DELETE', `/api/cash/balance-entries/${id}`),
  );
}

export interface AdjustmentRequest {
  periodMonth: IsoMonth;
  body: SavingsAdjustmentInput;
}

/** `PUT /api/cash/adjustments/:periodMonth` (closed periods only, D51). */
export function useSaveAdjustment() {
  return useCashflowMutation(({ periodMonth, body }: AdjustmentRequest) =>
    apiSend<SavingsAdjustmentDto>(
      'PUT',
      `/api/cash/adjustments/${encodeURIComponent(periodMonth)}`,
      body,
    ),
  );
}

/** `DELETE /api/cash/adjustments/:periodMonth` (also removes an orphan). */
export function useDeleteAdjustment() {
  return useCashflowMutation((periodMonth: IsoMonth) =>
    apiSend<{ periodMonth: IsoMonth }>(
      'DELETE',
      `/api/cash/adjustments/${encodeURIComponent(periodMonth)}`,
    ),
  );
}

export interface PeriodNoteRequest {
  kind: EditableNoteKind;
  periodMonth: IsoMonth;
  /** `''` deletes the note. */
  note: string;
}

/** `PUT /api/period-notes/:kind/:periodMonth` (recorded periods only). */
export function useSavePeriodNote() {
  return useCashflowMutation(({ kind, periodMonth, note }: PeriodNoteRequest) =>
    apiSend<PeriodNoteResponse>(
      'PUT',
      `/api/period-notes/${encodeURIComponent(kind)}/${encodeURIComponent(periodMonth)}`,
      { note },
    ),
  );
}

/** `POST /api/savings-goals` → 201. */
export function useCreateSavingsGoal() {
  return useCashflowMutation((body: SavingsGoalInput) =>
    apiSend<SavingsGoalMutationResponse>('POST', '/api/savings-goals', body),
  );
}

/** `PUT /api/savings-goals/:id`. */
export function useUpdateSavingsGoal() {
  return useCashflowMutation(({ id, body }: UpdateRequest<SavingsGoalInput>) =>
    apiSend<SavingsGoalMutationResponse>('PUT', `/api/savings-goals/${id}`, body),
  );
}

/** `DELETE /api/savings-goals/:id`. */
export function useDeleteSavingsGoal() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/savings-goals/${id}`),
  );
}

/** `POST /api/savings-goals/reorder`: every goal id exactly once, in the new order. */
export function useReorderSavingsGoals() {
  return useCashflowMutation((ids: number[]) =>
    apiSend<{ ids: number[] }>('POST', '/api/savings-goals/reorder', { ids }),
  );
}

// Side income

/** `POST /api/side-income/deposits` → 201. */
export function useCreateDeposit() {
  return useCashflowMutation((body: DepositInput) =>
    apiSend<DepositMutationResponse>('POST', '/api/side-income/deposits', body),
  );
}

/** `PUT /api/side-income/deposits/:id`. */
export function useUpdateDeposit() {
  return useCashflowMutation(({ id, body }: UpdateRequest<DepositInput>) =>
    apiSend<DepositMutationResponse>('PUT', `/api/side-income/deposits/${id}`, body),
  );
}

/** `DELETE /api/side-income/deposits/:id`. */
export function useDeleteDeposit() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/side-income/deposits/${id}`),
  );
}

/** `POST /api/side-income/streams` → 201. */
export function useCreateStream() {
  return useCashflowMutation((body: IncomeStreamInput) =>
    apiSend<IncomeStreamMutationResponse>('POST', '/api/side-income/streams', body),
  );
}

/** `PUT /api/side-income/streams/:id` (rename or archive). */
export function useUpdateStream() {
  return useCashflowMutation(({ id, body }: UpdateRequest<IncomeStreamInput>) =>
    apiSend<IncomeStreamMutationResponse>('PUT', `/api/side-income/streams/${id}`, body),
  );
}

/** `DELETE /api/side-income/streams/:id` (409 STREAM_IN_USE while it has deposits). */
export function useDeleteStream() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/side-income/streams/${id}`),
  );
}

// Budget

/** `POST /api/budget/items` → 201. */
export function useCreateBudgetItem() {
  return useCashflowMutation((body: BudgetItemInput) =>
    apiSend<BudgetItemMutationResponse>('POST', '/api/budget/items', body),
  );
}

/** `PUT /api/budget/items/:id` (item rows only). */
export function useUpdateBudgetItem() {
  return useCashflowMutation(({ id, body }: UpdateRequest<BudgetItemInput>) =>
    apiSend<BudgetItemMutationResponse>('PUT', `/api/budget/items/${id}`, body),
  );
}

/** `DELETE /api/budget/items/:id` (item rows only). */
export function useDeleteBudgetItem() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/budget/items/${id}`),
  );
}

/** `POST /api/budget/items/reorder`: every item and the yearly row, each exactly once. */
export function useReorderBudgetItems() {
  return useCashflowMutation((ids: number[]) =>
    apiSend<{ ids: number[] }>('POST', '/api/budget/items/reorder', { ids }),
  );
}

export interface BudgetAutoRowRequest {
  kind: BudgetAutoKind;
  body: BudgetAutoRowInput;
}

/** `PUT /api/budget/auto/:kind`: category, account and (auto_invest, split off) the amount. */
export function useSaveBudgetAutoRow() {
  return useCashflowMutation(({ kind, body }: BudgetAutoRowRequest) =>
    apiSend<BudgetItemMutationResponse>(
      'PUT',
      `/api/budget/auto/${encodeURIComponent(kind)}`,
      body,
    ),
  );
}

/** `POST /api/budget/yearly-expenses` → 201. */
export function useCreateYearlyExpense() {
  return useCashflowMutation((body: YearlyExpenseInput) =>
    apiSend<YearlyExpenseMutationResponse>('POST', '/api/budget/yearly-expenses', body),
  );
}

/** `PUT /api/budget/yearly-expenses/:id`. */
export function useUpdateYearlyExpense() {
  return useCashflowMutation(({ id, body }: UpdateRequest<YearlyExpenseInput>) =>
    apiSend<YearlyExpenseMutationResponse>('PUT', `/api/budget/yearly-expenses/${id}`, body),
  );
}

/** `DELETE /api/budget/yearly-expenses/:id`. */
export function useDeleteYearlyExpense() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/budget/yearly-expenses/${id}`),
  );
}

// Dividends

/** `POST /api/dividends` → 201 (also a confirmed suggestion). */
export function useCreateDividend() {
  return useCashflowMutation((body: DividendInputBody) =>
    apiSend<DividendMutationResponse>('POST', '/api/dividends', body),
  );
}

/** `PUT /api/dividends/:id`. */
export function useUpdateDividend() {
  return useCashflowMutation(({ id, body }: UpdateRequest<DividendInputBody>) =>
    apiSend<DividendMutationResponse>('PUT', `/api/dividends/${id}`, body),
  );
}

/** `DELETE /api/dividends/:id`. */
export function useDeleteDividend() {
  return useCashflowMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/dividends/${id}`),
  );
}

/**
 * `POST /api/dividends/suggestions/refresh` ("Check Yahoo"): awaits the run (joins one in flight);
 * 503 MARKET_DATA_DISABLED when market data is off. A failed or partial run still changes the
 * page's status, so the pages refresh either way.
 */
export function useRefreshDividendEvents(): UseMutationResult<
  DividendEventsRefreshResponse,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend<DividendEventsRefreshResponse>('POST', '/api/dividends/suggestions/refresh'),
    onSettled: () => invalidateAfterCashflowChange(queryClient),
  });
}

/** `POST /api/dividends/suggestions/dismiss` (an overlay: a re-import keeps it). */
export function useDismissSuggestion() {
  return useCashflowMutation((key: DividendEventKey) =>
    apiSend<DividendEventKey>('POST', '/api/dividends/suggestions/dismiss', key),
  );
}

/** `POST /api/dividends/suggestions/restore`. */
export function useRestoreSuggestion() {
  return useCashflowMutation((key: DividendEventKey) =>
    apiSend<DividendEventKey>('POST', '/api/dividends/suggestions/restore', key),
  );
}

// Settings

/**
 * After a settings save, from the Settings page or a page's own form (stage-5.md §6.2): settings
 * feed every page, so every page key (the prices page reads none), the Settings page and the
 * header status.
 */
export function invalidateAfterSettingsChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    ...invalidateCashflowPages(queryClient),
    ...invalidateAssetsPages(queryClient),
    ...invalidateOverviewPages(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.instruments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
  ]).then(() => undefined);
}

/** `PATCH /api/settings`: 1–64 editable keys (null clears one); only the changed keys are sent. */
export function usePatchSettings(): UseMutationResult<SettingsPatchResponse, Error, SettingsPatch> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPatch) =>
      apiSend<SettingsPatchResponse>('PATCH', '/api/settings', body),
    onSuccess: () => invalidateAfterSettingsChange(queryClient),
  });
}

// ─── Assets (stage-4.md §4.2, §6.2) ──────────────────────────────────────────────────────────────
// Every Stage 4 mutation invalidates the same keys (invalidateAfterAssetsChange).

/**
 * After any Stage 4 mutation (stage-4.md §6.2): the three assets pages, the Cash page (the
 * provisional savings period), the Budget and the investment pages (the other-assets class value),
 * records, the import runs (`hasAppData`) and the header status.
 */
export function invalidateAfterAssetsChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    ...invalidateAssetsPages(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.cash }),
    queryClient.invalidateQueries({ queryKey: queryKeys.budget }),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    ...invalidateOverviewPages(queryClient),
  ]).then(() => undefined);
}

/** A mutation whose success refreshes everything an assets change can move. */
function useAssetsMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateAfterAssetsChange(queryClient),
  });
}

// Other assets

/** `POST /api/other-assets` → 201 (a manual item may carry its first price). */
export function useCreateOtherAsset() {
  return useAssetsMutation((body: OtherAssetCreateBody) =>
    apiSend<OtherAssetMutationResponse>('POST', '/api/other-assets', body),
  );
}

/** `PUT /api/other-assets/:id`. */
export function useUpdateOtherAsset() {
  return useAssetsMutation(({ id, body }: UpdateRequest<OtherAssetUpdateBody>) =>
    apiSend<OtherAssetMutationResponse>('PUT', `/api/other-assets/${id}`, body),
  );
}

/** `DELETE /api/other-assets/:id` (its prices and sales go with it). */
export function useDeleteOtherAsset() {
  return useAssetsMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/other-assets/${id}`),
  );
}

/** `POST /api/other-assets/reorder`: every item id exactly once, in the new order. */
export function useReorderOtherAssets() {
  return useAssetsMutation((ids: number[]) =>
    apiSend<{ ids: number[] }>('POST', '/api/other-assets/reorder', { ids }),
  );
}

/** `PUT /api/other-assets/prices`: one as-of date and the changed items' prices (D72). */
export function useSaveOtherAssetPrices() {
  return useAssetsMutation((body: OtherAssetPricesInput) =>
    apiSend<OtherAssetPricesResponse>('PUT', '/api/other-assets/prices', body),
  );
}

/** `DELETE /api/other-assets/price-entries/:id`. */
export function useDeleteOtherAssetPriceEntry() {
  return useAssetsMutation((id: number) =>
    apiSend<OtherAssetMutationResponse>('DELETE', `/api/other-assets/price-entries/${id}`),
  );
}

export interface SaleCreateRequest {
  assetId: number;
  body: OtherAssetSaleInput;
}

/** `POST /api/other-assets/:id/sales` → 201 (422 SALE_OVERSELL past the remaining units). */
export function useCreateOtherAssetSale() {
  return useAssetsMutation(({ assetId, body }: SaleCreateRequest) =>
    apiSend<OtherAssetMutationResponse>('POST', `/api/other-assets/${assetId}/sales`, body),
  );
}

/** `PUT /api/other-assets/sales/:id` (422 SALE_OVERSELL). */
export function useUpdateOtherAssetSale() {
  return useAssetsMutation(({ id, body }: UpdateRequest<OtherAssetSaleInput>) =>
    apiSend<OtherAssetMutationResponse>('PUT', `/api/other-assets/sales/${id}`, body),
  );
}

/** `DELETE /api/other-assets/sales/:id`. */
export function useDeleteOtherAssetSale() {
  return useAssetsMutation((id: number) =>
    apiSend<OtherAssetMutationResponse>('DELETE', `/api/other-assets/sales/${id}`),
  );
}

// Super

/** `POST /api/super/funds` → 201 with its opening balance entry. */
export function useCreateSuperFund() {
  return useAssetsMutation((body: SuperFundCreate) =>
    apiSend<SuperFundMutationResponse>('POST', '/api/super/funds', body),
  );
}

/** `PUT /api/super/funds/:id` (a `receivesSg`-only change keeps the row's origin). */
export function useUpdateSuperFund() {
  return useAssetsMutation(({ id, body }: UpdateRequest<SuperFundUpdate>) =>
    apiSend<SuperFundMutationResponse>('PUT', `/api/super/funds/${id}`, body),
  );
}

/** `DELETE /api/super/funds/:id` (409 FUND_IN_USE while contributions reference it). */
export function useDeleteSuperFund() {
  return useAssetsMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/super/funds/${id}`),
  );
}

/** `PUT /api/super/balances`: one as-of date and the changed funds' balances (D69). */
export function useSaveSuperBalances() {
  return useAssetsMutation((body: SuperBalancesInput) =>
    apiSend<SuperBalancesResponse>('PUT', '/api/super/balances', body),
  );
}

/** `DELETE /api/super/balance-entries/:id` (409 LAST_BALANCE_ENTRY for a fund's only entry). */
export function useDeleteSuperBalanceEntry() {
  return useAssetsMutation((id: number) =>
    apiSend<SuperFundMutationResponse>('DELETE', `/api/super/balance-entries/${id}`),
  );
}

/** `POST /api/super/contributions` → 201 (typed kinds only, D71). */
export function useCreateSuperContribution() {
  return useAssetsMutation((body: SuperContributionInput) =>
    apiSend<SuperContributionMutationResponse>('POST', '/api/super/contributions', body),
  );
}

/** `PUT /api/super/contributions/:id` (an imported entry becomes typed). */
export function useUpdateSuperContribution() {
  return useAssetsMutation(({ id, body }: UpdateRequest<SuperContributionInput>) =>
    apiSend<SuperContributionMutationResponse>('PUT', `/api/super/contributions/${id}`, body),
  );
}

/** `DELETE /api/super/contributions/:id`. */
export function useDeleteSuperContribution() {
  return useAssetsMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/super/contributions/${id}`),
  );
}

export interface SgOverrideRequest {
  periodMonth: IsoMonth;
  body: SgOverrideInput;
}

/** `PUT /api/super/sg/:periodMonth`: a statement's SG for the month earned (an overlay). */
export function useSaveSgOverride() {
  return useAssetsMutation(({ periodMonth, body }: SgOverrideRequest) =>
    apiSend<SgOverrideResponse>('PUT', `/api/super/sg/${encodeURIComponent(periodMonth)}`, body),
  );
}

/** `DELETE /api/super/sg/:periodMonth`. */
export function useDeleteSgOverride() {
  return useAssetsMutation((periodMonth: IsoMonth) =>
    apiSend<{ periodMonth: IsoMonth }>(
      'DELETE',
      `/api/super/sg/${encodeURIComponent(periodMonth)}`,
    ),
  );
}

export interface SuperOptionNoteRequest {
  periodMonth: IsoMonth;
  /** `''` deletes the note. */
  note: string;
}

/** `PUT /api/period-notes/super_option/:periodMonth` (any month up to this one; '' deletes). */
export function useSaveSuperOptionNote() {
  return useAssetsMutation(({ periodMonth, note }: SuperOptionNoteRequest) =>
    apiSend<PeriodNoteResponse>(
      'PUT',
      `/api/period-notes/super_option/${encodeURIComponent(periodMonth)}`,
      { note },
    ),
  );
}

// Property

/** `POST /api/property/properties` → 201 with its opening valuation. */
export function useCreateProperty() {
  return useAssetsMutation((body: PropertyCreate) =>
    apiSend<PropertyMutationResponse>('POST', '/api/property/properties', body),
  );
}

/** `PUT /api/property/properties/:id`. */
export function useUpdateProperty() {
  return useAssetsMutation(({ id, body }: UpdateRequest<PropertyUpdate>) =>
    apiSend<PropertyMutationResponse>('PUT', `/api/property/properties/${id}`, body),
  );
}

/** `DELETE /api/property/properties/:id` (409 PROPERTY_HAS_LOAN while a loan references it). */
export function useDeleteProperty() {
  return useAssetsMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/property/properties/${id}`),
  );
}

/** `PUT /api/property/valuations`: one as-of date and the changed properties' values. */
export function useSaveValuations() {
  return useAssetsMutation((body: ValuationsInput) =>
    apiSend<ValuationsResponse>('PUT', '/api/property/valuations', body),
  );
}

/** `DELETE /api/property/valuation-entries/:id` (409 LAST_BALANCE_ENTRY for the only one). */
export function useDeleteValuationEntry() {
  return useAssetsMutation((id: number) =>
    apiSend<PropertyMutationResponse>('DELETE', `/api/property/valuation-entries/${id}`),
  );
}

/** `POST /api/property/loans` → 201 with its current balance entry. */
export function useCreateLoan() {
  return useAssetsMutation((body: LoanCreate) =>
    apiSend<LoanMutationResponse>('POST', '/api/property/loans', body),
  );
}

/** `PUT /api/property/loans/:id` (a changed start or repayment re-derives the log, D76). */
export function useUpdateLoan() {
  return useAssetsMutation(({ id, body }: UpdateRequest<LoanUpdate>) =>
    apiSend<LoanMutationResponse>('PUT', `/api/property/loans/${id}`, body),
  );
}

/** `DELETE /api/property/loans/:id` (its entries and offset links go with it). */
export function useDeleteLoan() {
  return useAssetsMutation((id: number) =>
    apiSend<DeletedResponse>('DELETE', `/api/property/loans/${id}`),
  );
}

/** `PUT /api/property/loan-balances`: one as-of date and the changed loans' balances (D66). */
export function useSaveLoanBalances() {
  return useAssetsMutation((body: LoanBalancesInput) =>
    apiSend<LoanBalancesResponse>('PUT', '/api/property/loan-balances', body),
  );
}

/** `PUT /api/property/loan-balance-entries/:id` (the entry's date is fixed). */
export function useUpdateLoanBalanceEntry() {
  return useAssetsMutation(({ id, body }: UpdateRequest<LoanBalanceEntryUpdate>) =>
    apiSend<LoanMutationResponse>('PUT', `/api/property/loan-balance-entries/${id}`, body),
  );
}

/** `DELETE /api/property/loan-balance-entries/:id` (409 LAST_BALANCE_ENTRY for the only one). */
export function useDeleteLoanBalanceEntry() {
  return useAssetsMutation((id: number) =>
    apiSend<LoanMutationResponse>('DELETE', `/api/property/loan-balance-entries/${id}`),
  );
}

export interface LoanOffsetsRequest {
  loanId: number;
  body: LoanOffsetsInput;
}

/** `PUT /api/property/loans/:id/offsets`: the loan's offset accounts, as a set (D67). */
export function useSaveLoanOffsets() {
  return useAssetsMutation(({ loanId, body }: LoanOffsetsRequest) =>
    apiSend<LoanOffsetsResponse>('PUT', `/api/property/loans/${loanId}/offsets`, body),
  );
}

// ─── History (stage-5.md §4.2, §6.2) ─────────────────────────────────────────────────────────────

/**
 * After a record, a correction or a delete: a recorded month closes every page's provisional
 * period, so every page that shows one, plus records, the import runs (`hasAppData`) and the
 * header status.
 */
export function invalidateAfterHistoryChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    ...invalidateOverviewPages(queryClient),
    ...invalidateCashflowPages(queryClient),
    ...invalidateAssetsPages(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.investments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.import }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status }),
  ]).then(() => undefined);
}

/** A mutation whose success refreshes everything a recorded month can move. */
function useHistoryMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateAfterHistoryChange(queryClient),
  });
}

/** `POST /api/history/record` → 201 with the recorded months (ascending). */
export function useRecordMonths() {
  return useHistoryMutation((body: RecordRequestBody) =>
    apiSend<RecordResponse>('POST', '/api/history/record', body),
  );
}

export interface CorrectSnapshotRequest {
  periodMonth: IsoMonth;
  body: SnapshotCorrectionBody;
}

/** `PUT /api/history/snapshots/:periodMonth`: the changed figures and a reason. */
export function useCorrectSnapshot() {
  return useHistoryMutation(({ periodMonth, body }: CorrectSnapshotRequest) =>
    apiSend<CorrectionResponse>(
      'PUT',
      `/api/history/snapshots/${encodeURIComponent(periodMonth)}`,
      body,
    ),
  );
}

/** `DELETE /api/history/snapshots/:periodMonth`: the latest app-recorded month only (D92). */
export function useDeleteSnapshot() {
  return useHistoryMutation((periodMonth: IsoMonth) =>
    apiSend<DeleteSnapshotResponse>(
      'DELETE',
      `/api/history/snapshots/${encodeURIComponent(periodMonth)}`,
    ),
  );
}
