// Test support (stage-6.md §6.9): every data page with its API routes and fixture states, shared by
// the page-wide tests (states, formatAudit, noStage5, the router's pending-layout test). Not imported
// by the app. FIRE joined in phase B (§6.9). Stage 8 (stage-8.md §8.8, CODE-8): Settings also mocks
// `GET /api/backups` (the server version equal to this build's), so the page-wide suites render the
// real Backups section and the NAS copy block.
import {
  backupsPages,
  budgetPages,
  cashPages,
  dividendsPages,
  firePages,
  historyPages,
  holdingDetails,
  importRunDetails,
  importRunsEmpty,
  importRunsInProgress,
  importRunsPopulated,
  importRunSucceeded,
  importRunsWithAppData,
  investmentPageAllUnpriced,
  investmentPageNulls,
  investmentPageTiming,
  investmentPageUnpriced,
  investmentPages,
  investmentTrades,
  netWorthPages,
  otherAssetsPages,
  pricesByMode,
  pricesEmpty,
  pricesRunning,
  propertyPages,
  recordsIndex,
  recordsIndexEmpty,
  recordsPageEmpty,
  recordsPages,
  settingsPages,
  sideIncomePages,
  superPages,
} from '@joinr/schema/fixtures';
import type { InstrumentKind } from '@joinr/schema';
import type { PageSkeletonLayout } from '../components/QueryStates';

/** "GET /api/cash" → the response body. */
export type RouteBodies = Record<string, unknown>;

export interface PageCase {
  /** A readable id for test names. */
  id: string;
  /** The path the test renders. */
  path: string;
  /** The page's h1. */
  title: string;
  /** Its skeleton's status label and layout (stage-6.md §6.9 A). */
  loading: string;
  layout: PageSkeletonLayout;
  /** The first-load error's title. */
  errorTitle: string;
  /** The GET routes the page's first load reads (the page's own query first). */
  primary: string;
  /** Every fixture state of the page, each a full set of GET routes. */
  states: Record<string, RouteBodies>;
  /** A state rendered at another path than `path` (a record table per entity). */
  paths?: Record<string, string>;
}

/** One state per fixture of a page's fixture map, with the routes every state shares. */
function statesOf(
  fixtures: Readonly<Record<string, unknown>>,
  route: string,
  extra: RouteBodies = {},
): Record<string, RouteBodies> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([name, body]) => [name, { [route]: body, ...extra }]),
  );
}

const PLURAL: Record<InstrumentKind, string> = {
  stock: 'stocks',
  etf: 'ETFs',
  managed_fund: 'managed funds',
  crypto: 'crypto holdings',
};

const KIND_PATH: Record<InstrumentKind, string> = {
  stock: '/stocks',
  etf: '/etfs',
  managed_fund: '/managed-funds',
  crypto: '/crypto',
};

const KIND_TITLE: Record<InstrumentKind, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  managed_fund: 'Managed Funds',
  crypto: 'Crypto',
};

function investmentCase(kind: InstrumentKind): PageCase {
  const route = `GET /api/investments/${kind}`;
  const trades = { [`GET /api/investments/${kind}/trades`]: investmentTrades[kind] };
  const states: Record<string, RouteBodies> = {
    populated: { [route]: investmentPages[kind], ...trades },
  };
  for (const [name, page] of Object.entries({
    unpriced: investmentPageUnpriced,
    allUnpriced: investmentPageAllUnpriced,
    nulls: investmentPageNulls,
    ...investmentPageTiming,
  })) {
    if (page.kind === kind) states[name] = { [route]: page, ...trades };
  }
  return {
    id: kind,
    path: KIND_PATH[kind],
    title: KIND_TITLE[kind],
    loading: `Loading ${PLURAL[kind]}…`,
    layout: 'dashboard',
    errorTitle: `Could not load the ${PLURAL[kind]}`,
    primary: route,
    states,
  };
}

function holdingCases(): PageCase[] {
  return Object.values(holdingDetails).map((detail) => {
    const kind = detail.instrument.kind;
    const route = `GET /api/instruments/${detail.instrument.id}`;
    return {
      id: `holding-${detail.instrument.id}`,
      path: `${KIND_PATH[kind]}/${detail.instrument.id}`,
      title: 'Holding',
      loading: 'Loading the holding…',
      layout: 'dashboard',
      errorTitle: 'Could not load the holding',
      primary: route,
      states: { populated: { [route]: detail } },
    };
  });
}

const IMPORT_RUNS = 'GET /api/import/runs';
const RUNS_BODY = { [IMPORT_RUNS]: importRunsPopulated };

/** Every data page. */
export const PAGE_CASES: readonly PageCase[] = [
  {
    id: 'net-worth',
    path: '/',
    title: 'Net worth',
    loading: 'Loading net worth…',
    layout: 'dashboard',
    errorTitle: 'Could not load net worth',
    primary: 'GET /api/net-worth',
    states: statesOf(netWorthPages, 'GET /api/net-worth', RUNS_BODY),
  },
  {
    id: 'history',
    path: '/history',
    title: 'History',
    loading: 'Loading history…',
    layout: 'dashboard',
    errorTitle: 'Could not load history',
    primary: 'GET /api/history',
    states: statesOf(historyPages, 'GET /api/history', RUNS_BODY),
  },
  investmentCase('stock'),
  investmentCase('etf'),
  investmentCase('managed_fund'),
  investmentCase('crypto'),
  ...holdingCases(),
  {
    id: 'cash',
    path: '/cash',
    title: 'Cash',
    loading: 'Loading cash…',
    layout: 'dashboard',
    errorTitle: 'Could not load the cash page',
    primary: 'GET /api/cash',
    states: statesOf(cashPages, 'GET /api/cash', RUNS_BODY),
  },
  {
    id: 'side-income',
    path: '/side-income',
    title: 'Side Income',
    loading: 'Loading side income…',
    layout: 'dashboard',
    errorTitle: 'Could not load the side income page',
    primary: 'GET /api/side-income',
    states: statesOf(sideIncomePages, 'GET /api/side-income', RUNS_BODY),
  },
  {
    id: 'dividends',
    path: '/dividends',
    title: 'Dividends',
    loading: 'Loading dividends…',
    layout: 'dashboard',
    errorTitle: 'Could not load the dividends',
    primary: 'GET /api/dividends',
    states: statesOf(dividendsPages, 'GET /api/dividends', RUNS_BODY),
  },
  {
    id: 'budget',
    path: '/budget',
    title: 'Budget',
    loading: 'Loading the budget…',
    layout: 'dashboard',
    errorTitle: 'Could not load the budget',
    primary: 'GET /api/budget',
    states: statesOf(budgetPages, 'GET /api/budget', RUNS_BODY),
  },
  {
    id: 'other-assets',
    path: '/other-assets',
    title: 'Other Assets',
    loading: 'Loading other assets…',
    layout: 'dashboard',
    errorTitle: 'Could not load other assets',
    primary: 'GET /api/other-assets',
    states: statesOf(otherAssetsPages, 'GET /api/other-assets', RUNS_BODY),
  },
  {
    id: 'super',
    path: '/super',
    title: 'Super',
    loading: 'Loading super…',
    layout: 'dashboard',
    errorTitle: 'Could not load super',
    primary: 'GET /api/super',
    states: statesOf(superPages, 'GET /api/super', {
      ...RUNS_BODY,
      'GET /api/settings': settingsPages.populated,
    }),
  },
  {
    id: 'property',
    path: '/property',
    title: 'Property',
    loading: 'Loading property…',
    layout: 'dashboard',
    errorTitle: 'Could not load property',
    primary: 'GET /api/property',
    states: statesOf(propertyPages, 'GET /api/property', RUNS_BODY),
  },
  {
    id: 'records',
    path: '/records',
    title: 'Records',
    loading: 'Loading the record tables…',
    layout: 'table',
    errorTitle: 'Could not load the records',
    primary: 'GET /api/records',
    states: {
      populated: { 'GET /api/records': recordsIndex },
      empty: { 'GET /api/records': recordsIndexEmpty },
    },
  },
  {
    id: 'records-trades',
    path: '/records/trades',
    title: 'Records',
    loading: 'Loading trades…',
    layout: 'table',
    errorTitle: 'Could not load trades',
    primary: 'GET /api/records/trades',
    states: {
      trades: { 'GET /api/records/trades': recordsPages.trades },
      ...Object.fromEntries(
        Object.entries(recordsPages).map(([entity, page]) => [
          entity,
          { [`GET /api/records/${entity}`]: page },
        ]),
      ),
      empty: { 'GET /api/records/trades': recordsPageEmpty },
    },
    paths: Object.fromEntries(Object.keys(recordsPages).map((e) => [e, `/records/${e}`])),
  },
  {
    id: 'import',
    path: '/import',
    title: 'Import',
    loading: 'Loading the import runs…',
    layout: 'table',
    errorTitle: 'Could not load the import runs',
    primary: IMPORT_RUNS,
    states: {
      populated: { [IMPORT_RUNS]: importRunsPopulated },
      empty: { [IMPORT_RUNS]: importRunsEmpty },
      inProgress: { [IMPORT_RUNS]: importRunsInProgress },
      withAppData: { [IMPORT_RUNS]: importRunsWithAppData },
    },
  },
  {
    id: 'import-run',
    path: '/import/runs/3',
    title: 'Import',
    loading: 'Loading run #3…',
    layout: 'table',
    errorTitle: 'Could not load run #3',
    primary: 'GET /api/import/runs/3',
    states: {
      succeeded: { 'GET /api/import/runs/3': importRunSucceeded },
      ...Object.fromEntries(
        Object.values(importRunDetails).map((run) => [
          run.status + (run.dryRun ? '-dry' : ''),
          { 'GET /api/import/runs/3': { ...run, id: 3 } },
        ]),
      ),
    },
  },
  {
    id: 'prices',
    path: '/prices',
    title: 'Prices',
    loading: 'Loading prices…',
    layout: 'table',
    errorTitle: 'Could not load prices',
    primary: 'GET /api/prices',
    states: {
      ...Object.fromEntries(
        Object.entries(pricesByMode).map(([mode, body]) => [mode, { 'GET /api/prices': body }]),
      ),
      running: { 'GET /api/prices': pricesRunning },
      empty: { 'GET /api/prices': pricesEmpty },
    },
  },
  {
    id: 'fire',
    path: '/fire',
    title: 'FIRE',
    loading: 'Loading FIRE…',
    layout: 'dashboard',
    errorTitle: 'Could not load FIRE',
    primary: 'GET /api/fire',
    states: statesOf(firePages, 'GET /api/fire'),
  },
  {
    id: 'settings',
    path: '/settings',
    title: 'Settings',
    loading: 'Loading settings…',
    layout: 'form',
    errorTitle: 'Could not load settings',
    primary: 'GET /api/settings',
    states: statesOf(settingsPages, 'GET /api/settings', {
      'GET /api/backups': {
        ...backupsPages.typical,
        app: { ...backupsPages.typical.app, version: __APP_VERSION__ },
      },
    }),
  },
];
