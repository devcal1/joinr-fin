import { defineConfig } from '@playwright/test';

// Ports come from env so parallel agents never collide (docs/stages/stage-0.md §4).
const webPort = process.env.WEB_PORT ?? '5173';
const apiPort = process.env.PORT ?? '3001';

// Use an installed browser; never download one. 'chromium' = the cached Playwright build.
const channelEnv = process.env.PW_CHANNEL ?? 'chrome';
const channel = channelEnv === 'chromium' ? undefined : channelEnv;

// The setup and warmup projects and the specs that create app rows run in their own projects,
// never in the read-only desktop and phone runs (D34: an app row makes the import spec's upload
// answer 409).
const MUTATING_SPECS = [
  /.*\.setup\.ts/,
  /trades\.spec\.ts/,
  /cashflow-mutations\.spec\.ts/,
  /assets-mutations\.spec\.ts/,
  /history-mutations\.spec\.ts/,
  /fire-mutations\.spec\.ts/,
  /backups-mutations\.spec\.ts/,
];

// The read-only desktop, phone and warmup projects retry a failed test twice: their flakes are
// transient (`net::ERR_NETWORK_CHANGED` or a cold lazy route while the dev server settles) and a
// read-only test is safe to repeat. The setup (the import) and mutating projects keep 0 retries,
// since a retried mutation could double a write; a test inside a retried project that mutates
// shared data opts out with `test.describe.configure({ retries: 0 })` (e2e/import.spec.ts). The
// Integrator and the Verifier list every test that passed only on a retry, the warmup project's
// included (stage-6.md §7.7 step 2, §12).
const READ_ONLY_RETRIES = 2;

export default defineConfig({
  testDir: 'e2e',
  // Every page route loads lazily since Stage 6 (stage-6.md §6.1): under the dev server a page's
  // modules arrive after the load event, one request each, so with parallel workers a first h1 can
  // take longer than the default 5 s. The warmup project opens every route once before
  // desktop and phone run (e2e/warmup.setup.ts).
  expect: { timeout: 10_000 },
  // Playwright empties outputDir at the start of a run, so each port (one per agent) gets its own
  // folders and parallel runs never delete each other's traces. PW_OUTPUT_DIR overrides.
  outputDir: process.env.PW_OUTPUT_DIR ?? `artifacts/playwright/results-${webPort}`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `artifacts/playwright/report-${webPort}`, open: 'never' }],
  ],
  use: {
    baseURL: `http://localhost:${webPort}`,
    channel,
    trace: 'retain-on-failure',
  },
  projects: [
    // Runs once before desktop and phone: imports the synthetic workbook (e2e/import.setup.ts).
    // No retries: a retried import could run twice.
    { name: 'setup', testMatch: /import\.setup\.ts/ },
    // Read-only: opens every lazy route once after the import, so the first test of each page does
    // not pay the cold dev-server load; a transient failure here is retried (triage CODE-5).
    {
      name: 'warmup',
      testMatch: /warmup\.setup\.ts/,
      dependencies: ['setup'],
      retries: READ_ONLY_RETRIES,
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
      dependencies: ['setup', 'warmup'],
      testIgnore: MUTATING_SPECS,
      retries: READ_ONLY_RETRIES,
    },
    {
      name: 'phone',
      use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      dependencies: ['setup', 'warmup'],
      testIgnore: MUTATING_SPECS,
      retries: READ_ONLY_RETRIES,
    },
    // The app rows trades.spec.ts creates would make the import spec's upload answer 409 (D34), so
    // it runs alone, after every desktop and phone spec (stage-2.md §7.6 step 6).
    {
      name: 'mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /trades\.spec\.ts/,
      dependencies: ['desktop', 'phone'],
    },
    // The cash-flow mutations create (and delete) app rows too, so they run alone after the trade
    // mutations; the two mutating projects never overlap (stage-3.md §7.8 step 5, §12).
    {
      name: 'cashflow-mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /cashflow-mutations\.spec\.ts/,
      dependencies: ['mutations'],
    },
    // The assets mutations create (and delete) app rows as well, so they run alone after the
    // cash-flow mutations: the three mutating projects form one chain and never overlap
    // (stage-4.md §7.8 step 5, §12).
    {
      name: 'assets-mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /assets-mutations\.spec\.ts/,
      dependencies: ['cashflow-mutations'],
    },
    // Recording, correcting and deleting a month (and the one app-only setting it flips) are app
    // data too, so the History mutations run alone after the assets mutations: the four mutating
    // projects form one chain and never overlap (stage-5.md §7.8 step 5).
    {
      name: 'history-mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /history-mutations\.spec\.ts/,
      dependencies: ['assets-mutations'],
    },
    // Saving FIRE settings writes preference rows (D103: not app data, but shared state the
    // read-only FIRE specs read), so the FIRE mutations run alone after the History mutations,
    // last in the chain; the spec sets every key it writes back to null (stage-6.md §7.5 step 4).
    {
      name: 'fire-mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /fire-mutations\.spec\.ts/,
      dependencies: ['history-mutations'],
    },
    // "Back up now" writes backup files (not app data, but shared state the read-only Backups
    // specs list), and the cross-site checks POST, so the backups mutations run alone after the FIRE
    // mutations, last in the chain (stage-7.md §6.8).
    {
      name: 'backups-mutations',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /backups-mutations\.spec\.ts/,
      dependencies: ['fire-mutations'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${webPort}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PORT: apiPort,
      WEB_PORT: webPort,
      DATA_DIR: process.env.DATA_DIR ?? 'artifacts/e2e/data',
      // Deterministic offline prices and no refresh timer (stage-1.md §8).
      MARKET_DATA_MODE: process.env.MARKET_DATA_MODE ?? 'fake',
      PRICE_REFRESH_MINUTES: process.env.PRICE_REFRESH_MINUTES ?? '0',
      // The synthetic workbook must never meet the owner's corrections file (stage-1.md §3.4).
      IMPORT_CORRECTIONS_FILE: process.env.IMPORT_CORRECTIONS_FILE ?? 'none',
      // No nightly timer and no start-up catch-up file mid-run (stage-7.md §6.8).
      NIGHTLY_BACKUPS: process.env.NIGHTLY_BACKUPS ?? 'false',
      // No weekly NAS-copy timer and no start-up catch-up; the e2e server has no NAS files anyway,
      // so the copy is off (stage-8.md §8.7).
      WEEKLY_NAS_COPY: process.env.WEEKLY_NAS_COPY ?? 'false',
    },
  },
});
