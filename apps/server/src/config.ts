// Server configuration from environment variables (stage-0.md §4).
//
// `loadConfig` is pure: it reads only the `env` object and the folders in `base`, never the disk,
// and reports every invalid variable in a single ConfigError.
import { isAbsolute, join, resolve } from 'node:path';
import {
  correctionsSettingFromEnv,
  MARKET_DATA_MODES,
  type CorrectionsSetting,
  type MarketDataMode,
} from '@joinr/schema';
import { z } from 'zod';
import {
  defaultConfigBase,
  defaultMigrationsDir,
  defaultWebDistDir,
  type ConfigBase,
} from './paths';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The SQLite file inside `DATA_DIR`. */
export const DB_FILE_NAME = 'finance.db';

export interface Config {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  logLevel: LogLevel;
  /** Absolute. Holds the database now, and backups/exports in later stages. */
  dataDir: string;
  /** Absolute path of the SQLite file: `<dataDir>/finance.db`. */
  dbFile: string;
  /** Serve the built SPA from `webDistDir` (defaults to on in production). */
  serveWeb: boolean;
  /** Absolute. */
  webDistDir: string;
  /** Absolute. */
  migrationsDir: string;
  /** Scheduled price refresh interval; 0 = no timer (manual refresh still works). */
  priceRefreshMinutes: number;
  /** `live` fetches, `fake` is deterministic and offline, `off` never fetches. */
  marketDataMode: MarketDataMode;
  /** Where the importer's owner corrections come from (`IMPORT_CORRECTIONS_FILE`). */
  importCorrections: CorrectionsSetting;
  /** The folder holding pnpm-workspace.yaml; null outside a checkout (the Docker image). */
  repoRoot: string | null;
  /**
   * Stage 5 (stage-5.md §4.6, D84): `AUTO_RECORD` (true|false|1|0|yes|no) overrides the
   * `history.autoRecord` setting and locks it; null (unset, and always under NODE_ENV=test) lets
   * the setting decide (default off).
   */
  autoRecord: boolean | null;
  /**
   * Stage 7 (stage-7.md §5.1): `NIGHTLY_BACKUPS` (true|false|1|0|yes|no); default on, off under
   * NODE_ENV=test. Off means no timer and no start-up catch-up; the other backups still work.
   */
  nightlyBackups: boolean;
  /**
   * Stage 7 (stage-7.md §5.1, §5.8): `PUBLIC_PORT`, the port the browser uses (the Umbrel store
   * compose sets the manifest port); only the cross-site write guard's Origin rule reads it.
   */
  publicPort: number | null;
  /**
   * Stage 8 (stage-8.md §5.1): `WEEKLY_NAS_COPY` (true|false|1|0|yes|no); default on, off under
   * NODE_ENV=test. Off means no weekly timer and no start-up catch-up; "Copy to NAS now" still
   * works. The NAS files are the copy's only other configuration.
   */
  weeklyNasCopy: boolean;
  /**
   * Stage 9 (stage-9.md §5.7): `INTRADAY_REFRESH` (true|false|1|0|yes|no); default on, off under
   * NODE_ENV=test. Off means no intraday timer and no start-up run (a manual run still works): the
   * live kill switch if the five-minute cadence draws Yahoo 429s.
   */
  intradayRefresh: boolean;
  /**
   * Stage 10 (stage-10.md §5.8): `CLOSES_REFRESH` (true|false|1|0|yes|no); default on, off under
   * NODE_ENV=test. Off means no `closes` timers (daily, start-up, follow-ups); the job stays
   * registered, so a manual run still works. The live kill switch for the daily price history: the
   * stored closes stay and the periods keep working from them.
   */
  closesRefresh: boolean;
}

export const DEFAULTS = {
  host: '127.0.0.1',
  port: 3001,
  dataDir: 'data',
  logLevel: 'info',
  nodeEnv: 'development',
  priceRefreshMinutes: 60,
  marketDataMode: 'live',
} as const;

/** Defaults that differ under NODE_ENV=test (no timers, no network). */
export const TEST_DEFAULTS = {
  priceRefreshMinutes: 0,
  marketDataMode: 'off',
  nightlyBackups: false,
  weeklyNasCopy: false,
  intradayRefresh: false,
  closesRefresh: false,
} as const;

/** The nightly backup default outside NODE_ENV=test (stage-7.md §5.1). */
export const DEFAULT_NIGHTLY_BACKUPS = true;

/** The weekly NAS copy default outside NODE_ENV=test (stage-8.md §5.1). */
export const DEFAULT_WEEKLY_NAS_COPY = true;

/** The intraday job default outside NODE_ENV=test (stage-9.md §5.7). */
export const DEFAULT_INTRADAY_REFRESH = true;

/** The closes job default outside NODE_ENV=test (stage-10.md §5.8). */
export const DEFAULT_CLOSES_REFRESH = true;

/** The largest PRICE_REFRESH_MINUTES (one day). */
export const MAX_PRICE_REFRESH_MINUTES = 1440;

const TRUE_VALUES = ['true', '1', 'yes'] as const;
const BOOLEAN_VALUES = [...TRUE_VALUES, 'false', '0', 'no'] as const;

const booleanFlag = z
  .enum(BOOLEAN_VALUES, { error: `must be one of ${BOOLEAN_VALUES.join(', ')}` })
  .transform((v) => (TRUE_VALUES as readonly string[]).includes(v));

const envSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })
    .default(DEFAULTS.nodeEnv),
  HOST: z
    .string()
    .regex(/^[^\s/]+$/, { error: 'must be a host name or IP address' })
    .default(DEFAULTS.host),
  PORT: z
    .string()
    .regex(/^\d{1,5}$/, { error: 'must be a whole number from 0 to 65535' })
    .transform(Number)
    .pipe(z.number().max(65535, { error: 'must be a whole number from 0 to 65535' }))
    .default(DEFAULTS.port),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default(DEFAULTS.logLevel),
  DATA_DIR: z.string().default(DEFAULTS.dataDir),
  WEB_DIST_DIR: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  SERVE_WEB: booleanFlag.optional(),
  PRICE_REFRESH_MINUTES: z
    .string()
    .regex(/^\d{1,4}$/, { error: `must be a whole number from 0 to ${MAX_PRICE_REFRESH_MINUTES}` })
    .transform(Number)
    .pipe(
      z.number().max(MAX_PRICE_REFRESH_MINUTES, {
        error: `must be a whole number from 0 to ${MAX_PRICE_REFRESH_MINUTES}`,
      }),
    )
    .optional(),
  MARKET_DATA_MODE: z
    .enum(MARKET_DATA_MODES, { error: `must be one of ${MARKET_DATA_MODES.join(', ')}` })
    .optional(),
  IMPORT_CORRECTIONS_FILE: z.string().optional(),
  AUTO_RECORD: booleanFlag.optional(),
  NIGHTLY_BACKUPS: booleanFlag.optional(),
  WEEKLY_NAS_COPY: booleanFlag.optional(),
  INTRADAY_REFRESH: booleanFlag.optional(),
  CLOSES_REFRESH: booleanFlag.optional(),
  PUBLIC_PORT: z
    .string()
    .regex(/^\d{1,5}$/, { error: 'must be a whole number from 1 to 65535' })
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, { error: 'must be a whole number from 1 to 65535' })
        .max(65535, { error: 'must be a whole number from 1 to 65535' }),
    )
    .optional(),
});

type EnvKey = keyof typeof envSchema.shape;
const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/** Thrown by loadConfig; `issues` has one line per invalid variable. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Blank values count as unset, so `PORT=` behaves like no PORT at all. */
function pickEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<EnvKey, string | undefined> {
  const picked = {} as Record<EnvKey, string | undefined>;
  for (const key of ENV_KEYS) {
    const value = env[key]?.trim();
    picked[key] = value === '' ? undefined : value;
  }
  return picked;
}

function describeValue(value: string | undefined): string {
  if (value === undefined) return '';
  const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return ` (got "${shown}")`;
}

function resolveFrom(base: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

/** `IMPORT_CORRECTIONS_FILE` → a CorrectionsSetting with an absolute file path. */
function correctionsSetting(value: string | undefined, base: string): CorrectionsSetting {
  const setting = correctionsSettingFromEnv(value);
  return setting.kind === 'file'
    ? { kind: 'file', path: resolveFrom(base, setting.path) }
    : setting;
}

/**
 * Validates the environment and resolves every path to an absolute one. Relative `DATA_DIR`,
 * `WEB_DIST_DIR`, `MIGRATIONS_DIR` and `IMPORT_CORRECTIONS_FILE` values resolve against the repo
 * root.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  base: ConfigBase = defaultConfigBase(),
): Config {
  const raw = pickEnv(env);
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? 'environment');
      const value = key in raw ? raw[key as EnvKey] : undefined;
      return `${key}: ${issue.message}${describeValue(value)}`;
    });
    throw new ConfigError(issues);
  }

  const e = parsed.data;
  const dataDir = resolveFrom(base.repoRoot, e.DATA_DIR);
  const isTest = e.NODE_ENV === 'test';
  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir,
    dbFile: join(dataDir, DB_FILE_NAME),
    serveWeb: e.SERVE_WEB ?? e.NODE_ENV === 'production',
    webDistDir: e.WEB_DIST_DIR
      ? resolveFrom(base.repoRoot, e.WEB_DIST_DIR)
      : defaultWebDistDir(base.serverDir),
    migrationsDir: e.MIGRATIONS_DIR
      ? resolveFrom(base.repoRoot, e.MIGRATIONS_DIR)
      : defaultMigrationsDir(base.serverDir),
    priceRefreshMinutes:
      e.PRICE_REFRESH_MINUTES ??
      (isTest ? TEST_DEFAULTS.priceRefreshMinutes : DEFAULTS.priceRefreshMinutes),
    marketDataMode:
      e.MARKET_DATA_MODE ?? (isTest ? TEST_DEFAULTS.marketDataMode : DEFAULTS.marketDataMode),
    importCorrections: correctionsSetting(e.IMPORT_CORRECTIONS_FILE, base.repoRoot),
    repoRoot: base.workspaceRoot,
    autoRecord: isTest ? null : (e.AUTO_RECORD ?? null),
    nightlyBackups:
      e.NIGHTLY_BACKUPS ?? (isTest ? TEST_DEFAULTS.nightlyBackups : DEFAULT_NIGHTLY_BACKUPS),
    publicPort: e.PUBLIC_PORT ?? null,
    weeklyNasCopy:
      e.WEEKLY_NAS_COPY ?? (isTest ? TEST_DEFAULTS.weeklyNasCopy : DEFAULT_WEEKLY_NAS_COPY),
    intradayRefresh:
      e.INTRADAY_REFRESH ?? (isTest ? TEST_DEFAULTS.intradayRefresh : DEFAULT_INTRADAY_REFRESH),
    closesRefresh:
      e.CLOSES_REFRESH ?? (isTest ? TEST_DEFAULTS.closesRefresh : DEFAULT_CLOSES_REFRESH),
  };
}
