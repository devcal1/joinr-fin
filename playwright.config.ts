import { defineConfig } from '@playwright/test';

// Ports come from env so parallel agents never collide (docs/stages/stage-0.md §4).
const webPort = process.env.WEB_PORT ?? '5173';
const apiPort = process.env.PORT ?? '3001';

// Use an installed browser; never download one. 'chromium' = the cached Playwright build.
const channelEnv = process.env.PW_CHANNEL ?? 'chrome';
const channel = channelEnv === 'chromium' ? undefined : channelEnv;

export default defineConfig({
  testDir: 'e2e',
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
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
      dependencies: ['setup'],
      testIgnore: [/.*\.setup\.ts/, /trades\.spec\.ts/, /cashflow-mutations\.spec\.ts/],
    },
    {
      name: 'phone',
      use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      dependencies: ['setup'],
      testIgnore: [/.*\.setup\.ts/, /trades\.spec\.ts/, /cashflow-mutations\.spec\.ts/],
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
    },
  },
});
