import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import {
  defaultConfigBase,
  defaultMigrationsDir,
  defaultWebDistDir,
  findRepoRoot,
  SERVER_DIR,
  type ConfigBase,
} from '../src/paths';

const repoRoot = resolve('/joinr-test/repo');
const serverDir = join(repoRoot, 'apps', 'server');
const base: ConfigBase = { repoRoot, serverDir };

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env, base);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    expect(loadConfig({}, base)).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3001,
      logLevel: 'info',
      dataDir: join(repoRoot, 'data'),
      dbFile: join(repoRoot, 'data', 'finance.db'),
      serveWeb: false,
      webDistDir: join(repoRoot, 'apps', 'web', 'dist'),
      migrationsDir: join(serverDir, 'migrations'),
    });
  });

  it('reads every variable', () => {
    const config = loadConfig(
      {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3104',
        LOG_LEVEL: 'debug',
        DATA_DIR: resolve('/srv/joinr-data'),
        WEB_DIST_DIR: resolve('/srv/joinr-web'),
        MIGRATIONS_DIR: resolve('/srv/joinr-migrations'),
        SERVE_WEB: 'false',
      },
      base,
    );
    expect(config).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3104,
      logLevel: 'debug',
      dataDir: resolve('/srv/joinr-data'),
      dbFile: join(resolve('/srv/joinr-data'), 'finance.db'),
      serveWeb: false,
      webDistDir: resolve('/srv/joinr-web'),
      migrationsDir: resolve('/srv/joinr-migrations'),
    });
  });

  it('resolves relative paths against the repo root, not the working directory', () => {
    const config = loadConfig(
      { DATA_DIR: 'artifacts/server-infra/data', WEB_DIST_DIR: 'web', MIGRATIONS_DIR: './m' },
      base,
    );
    expect(config.dataDir).toBe(join(repoRoot, 'artifacts', 'server-infra', 'data'));
    expect(config.dbFile).toBe(join(repoRoot, 'artifacts', 'server-infra', 'data', 'finance.db'));
    expect(config.webDistDir).toBe(join(repoRoot, 'web'));
    expect(config.migrationsDir).toBe(join(repoRoot, 'm'));
  });

  it('serves the web app by default only in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }, base).serveWeb).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development' }, base).serveWeb).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test' }, base).serveWeb).toBe(false);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('parses SERVE_WEB=%s', (value, expected) => {
    expect(loadConfig({ SERVE_WEB: value }, base).serveWeb).toBe(expected);
    expect(loadConfig({ NODE_ENV: 'production', SERVE_WEB: value }, base).serveWeb).toBe(expected);
  });

  it('treats blank values as unset and trims whitespace', () => {
    const config = loadConfig({ PORT: '', HOST: '   ', DATA_DIR: ' ', LOG_LEVEL: ' warn ' }, base);
    expect(config.port).toBe(3001);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dataDir).toBe(join(repoRoot, 'data'));
    expect(config.logLevel).toBe('warn');
  });

  it('accepts the port range edges', () => {
    expect(loadConfig({ PORT: '0' }, base).port).toBe(0);
    expect(loadConfig({ PORT: '65535' }, base).port).toBe(65535);
  });

  it.each(['65536', '-1', '3.5', 'abc', '1e3', '123456'])('rejects PORT=%s', (port) => {
    const err = configError({ PORT: port });
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toMatch(/^PORT: must be a whole number from 0 to 65535/);
  });

  it('lists every invalid variable in one error', () => {
    const err = configError({
      NODE_ENV: 'staging',
      PORT: 'eighty',
      LOG_LEVEL: 'loud',
      SERVE_WEB: 'maybe',
      HOST: 'bad host',
    });
    const keys = err.issues.map((issue) => issue.split(':')[0]);
    expect(keys.sort()).toEqual(['HOST', 'LOG_LEVEL', 'NODE_ENV', 'PORT', 'SERVE_WEB']);
    expect(err.message).toContain('Invalid configuration');
    expect(err.message).toContain('NODE_ENV: must be one of development, production, test');
    expect(err.message).toContain('(got "staging")');
    expect(err.name).toBe('ConfigError');
  });

  it('shortens long values in error messages', () => {
    const err = configError({ LOG_LEVEL: 'x'.repeat(100) });
    expect(err.issues[0]).toContain(`(got "${'x'.repeat(40)}…")`);
  });

  it('ignores unrelated variables', () => {
    expect(() => loadConfig({ SOMETHING_ELSE: '!!!', PATH: '/bin' }, base)).not.toThrow();
  });
});

describe('paths', () => {
  it('finds the repo root by walking up to pnpm-workspace.yaml', () => {
    const root = resolve('/a/b');
    const exists = (path: string) => path === join(root, 'pnpm-workspace.yaml');
    expect(findRepoRoot(join(root, 'c', 'd'), exists)).toBe(root);
    expect(findRepoRoot(root, exists)).toBe(root);
    expect(findRepoRoot(resolve('/elsewhere'), exists)).toBeUndefined();
  });

  it('locates the server package and this repo', () => {
    const expectedServerDir = fileURLToPath(new URL('..', import.meta.url));
    expect(resolve(SERVER_DIR)).toBe(resolve(expectedServerDir));
    const detected = defaultConfigBase();
    expect(existsSync(join(detected.repoRoot, 'pnpm-workspace.yaml'))).toBe(true);
    expect(resolve(detected.repoRoot, 'apps', 'server')).toBe(resolve(SERVER_DIR));
  });

  it('derives the migrations and web-dist defaults from the server folder', () => {
    expect(defaultMigrationsDir(serverDir)).toBe(join(serverDir, 'migrations'));
    expect(defaultWebDistDir(serverDir)).toBe(join(repoRoot, 'apps', 'web', 'dist'));
    // In the Docker image the server lives in /app, so migrations are /app/migrations.
    expect(defaultMigrationsDir(resolve('/app'))).toBe(join(resolve('/app'), 'migrations'));
  });
});
