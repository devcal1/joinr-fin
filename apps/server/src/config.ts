// Server configuration from environment variables (stage-0.md §4).
//
// `loadConfig` is pure: it reads only the `env` object and the folders in `base`, never the disk,
// and reports every invalid variable in a single ConfigError.
import { isAbsolute, join, resolve } from 'node:path';
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
}

export const DEFAULTS = {
  host: '127.0.0.1',
  port: 3001,
  dataDir: 'data',
  logLevel: 'info',
  nodeEnv: 'development',
} as const;

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

/**
 * Validates the environment and resolves every path to an absolute one.
 * Relative `DATA_DIR`, `WEB_DIST_DIR` and `MIGRATIONS_DIR` values resolve against the repo root.
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
  };
}
