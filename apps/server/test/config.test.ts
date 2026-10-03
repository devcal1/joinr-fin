import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import {
  defaultConfigBase,
  defaultMigrationsDir,
  defaultWebDistDir,
  findRepoRoot,
  resolveServerDir,
  SERVER_DIR,
  type ConfigBase,
} from '../src/paths';

const repoRoot = resolve('/joinr-test/repo');
const serverDir = join(repoRoot, 'apps', 'server');
const base: ConfigBase = { repoRoot, workspaceRoot: repoRoot, serverDir };

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
      priceRefreshMinutes: 60,
      marketDataMode: 'live',
      importCorrections: { kind: 'auto' },
      repoRoot,
      autoRecord: null,
      nightlyBackups: true,
      publicPort: null,
      weeklyNasCopy: true,
      intradayRefresh: true,
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
        PRICE_REFRESH_MINUTES: '15',
        MARKET_DATA_MODE: 'fake',
        IMPORT_CORRECTIONS_FILE: resolve('/srv/joinr-corrections.json'),
        AUTO_RECORD: 'yes',
        NIGHTLY_BACKUPS: 'no',
        PUBLIC_PORT: '4932',
        WEEKLY_NAS_COPY: '0',
        INTRADAY_REFRESH: 'no',
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
      priceRefreshMinutes: 15,
      marketDataMode: 'fake',
      importCorrections: { kind: 'file', path: resolve('/srv/joinr-corrections.json') },
      repoRoot,
      autoRecord: true,
      nightlyBackups: false,
      publicPort: 4932,
      weeklyNasCopy: false,
      intradayRefresh: false,
    });
  });

  it('switches prices off and the timer to 0 under NODE_ENV=test', () => {
    const config = loadConfig({ NODE_ENV: 'test' }, base);
    expect(config.marketDataMode).toBe('off');
    expect(config.priceRefreshMinutes).toBe(0);
    const explicit = loadConfig(
      { NODE_ENV: 'test', MARKET_DATA_MODE: 'fake', PRICE_REFRESH_MINUTES: '1' },
      base,
    );
    expect(explicit.marketDataMode).toBe('fake');
    expect(explicit.priceRefreshMinutes).toBe(1);
  });

  it.each(['0', '60', '1440'])('accepts PRICE_REFRESH_MINUTES=%s', (value) => {
    expect(loadConfig({ PRICE_REFRESH_MINUTES: value }, base).priceRefreshMinutes).toBe(
      Number(value),
    );
  });

  it.each(['1441', '-1', '1.5', 'hourly'])('rejects PRICE_REFRESH_MINUTES=%s', (value) => {
    const err = configError({ PRICE_REFRESH_MINUTES: value });
    expect(err.issues[0]).toMatch(/^PRICE_REFRESH_MINUTES: must be a whole number from 0 to 1440/);
  });

  // Stage 5 (stage-5.md §4.6 item 1, §8): the recorder owner extends these (§7.5 item 1).
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', null],
  ])('reads AUTO_RECORD=%j', (value, expected) => {
    expect(loadConfig({ AUTO_RECORD: value }, base).autoRecord).toBe(expected);
  });

  it.each(['on', 'off', 'TRUE', 'Yes', '2', 'y'])('rejects AUTO_RECORD=%j', (value) => {
    expect(configError({ AUTO_RECORD: value }).issues).toEqual([
      expect.stringMatching(/^AUTO_RECORD: must be one of true, 1, yes, false, 0, no/),
    ]);
  });

  it('trims AUTO_RECORD and treats a blank value as unset', () => {
    expect(loadConfig({ AUTO_RECORD: ' yes ' }, base).autoRecord).toBe(true);
    expect(loadConfig({ AUTO_RECORD: '   ' }, base).autoRecord).toBeNull();
    expect(loadConfig({ NODE_ENV: 'production', AUTO_RECORD: '0' }, base).autoRecord).toBe(false);
  });

  it('leaves AUTO_RECORD to the setting when unset, and always under NODE_ENV=test', () => {
    expect(loadConfig({}, base).autoRecord).toBeNull();
    expect(loadConfig({ NODE_ENV: 'test', AUTO_RECORD: 'true' }, base).autoRecord).toBeNull();
    expect(configError({ AUTO_RECORD: 'sometimes' }).issues[0]).toMatch(
      /^AUTO_RECORD: must be one of true, 1, yes, false, 0, no/,
    );
  });

  // Stage 7 (stage-7.md §5.1).
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', true],
  ])('reads NIGHTLY_BACKUPS=%j (default on)', (value, expected) => {
    expect(loadConfig({ NIGHTLY_BACKUPS: value }, base).nightlyBackups).toBe(expected);
  });

  it('turns nightly backups off under NODE_ENV=test unless set', () => {
    expect(loadConfig({ NODE_ENV: 'test' }, base).nightlyBackups).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', NIGHTLY_BACKUPS: 'true' }, base).nightlyBackups).toBe(
      true,
    );
    expect(loadConfig({ NODE_ENV: 'production' }, base).nightlyBackups).toBe(true);
    expect(configError({ NIGHTLY_BACKUPS: 'nightly' }).issues[0]).toMatch(
      /^NIGHTLY_BACKUPS: must be one of true, 1, yes, false, 0, no/,
    );
  });

  // Stage 8 (stage-8.md §5.1).
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', true],
  ])('reads WEEKLY_NAS_COPY=%j (default on)', (value, expected) => {
    expect(loadConfig({ WEEKLY_NAS_COPY: value }, base).weeklyNasCopy).toBe(expected);
  });

  it('turns the weekly NAS copy off under NODE_ENV=test unless set', () => {
    expect(loadConfig({ NODE_ENV: 'test' }, base).weeklyNasCopy).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', WEEKLY_NAS_COPY: 'yes' }, base).weeklyNasCopy).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production' }, base).weeklyNasCopy).toBe(true);
    expect(configError({ WEEKLY_NAS_COPY: 'weekly' }).issues[0]).toMatch(
      /^WEEKLY_NAS_COPY: must be one of true, 1, yes, false, 0, no/,
    );
  });

  // Stage 9 (stage-9.md §5.7): the intraday job's switch (the live kill switch).
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', true],
  ])('reads INTRADAY_REFRESH=%j (default on)', (value, expected) => {
    expect(loadConfig({ INTRADAY_REFRESH: value }, base).intradayRefresh).toBe(expected);
  });

  it('turns the intraday job off under NODE_ENV=test unless set', () => {
    expect(loadConfig({ NODE_ENV: 'test' }, base).intradayRefresh).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', INTRADAY_REFRESH: '1' }, base).intradayRefresh).toBe(
      true,
    );
    expect(loadConfig({ NODE_ENV: 'production' }, base).intradayRefresh).toBe(true);
    expect(configError({ INTRADAY_REFRESH: 'often' }).issues[0]).toMatch(
      /^INTRADAY_REFRESH: must be one of true, 1, yes, false, 0, no/,
    );
  });

  it('reads PUBLIC_PORT (unset by default)', () => {
    expect(loadConfig({}, base).publicPort).toBeNull();
    expect(loadConfig({ PUBLIC_PORT: '4932' }, base).publicPort).toBe(4932);
    expect(loadConfig({ PUBLIC_PORT: ' ' }, base).publicPort).toBeNull();
    for (const bad of ['0', '65536', 'abc', '49.32', '-1']) {
      expect(configError({ PUBLIC_PORT: bad }).issues[0]).toMatch(
        /^PUBLIC_PORT: must be a whole number from 1 to 65535/,
      );
    }
  });

  it('rejects an unknown MARKET_DATA_MODE', () => {
    expect(configError({ MARKET_DATA_MODE: 'demo' }).issues[0]).toMatch(
      /^MARKET_DATA_MODE: must be one of live, fake, off/,
    );
  });

  it('reads IMPORT_CORRECTIONS_FILE: unset → auto, none → off, relative → repo root', () => {
    expect(loadConfig({}, base).importCorrections).toEqual({ kind: 'auto' });
    expect(loadConfig({ IMPORT_CORRECTIONS_FILE: 'none' }, base).importCorrections).toEqual({
      kind: 'off',
    });
    expect(
      loadConfig({ IMPORT_CORRECTIONS_FILE: 'private/corrections.json' }, base).importCorrections,
    ).toEqual({ kind: 'file', path: join(repoRoot, 'private', 'corrections.json') });
  });

  it('reports no repo root outside a workspace, whatever the working directory', () => {
    const outside: ConfigBase = { repoRoot: resolve('/cwd'), workspaceRoot: null, serverDir };
    const config = loadConfig({ DATA_DIR: 'd' }, outside);
    expect(config.repoRoot).toBeNull();
    expect(config.dataDir).toBe(join(resolve('/cwd'), 'd'));
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
    expect(detected.workspaceRoot).toBe(detected.repoRoot);
  });

  // Stage 7 (stage-7.md §5.6): the bundles sit at dist/server.js and dist/cli/<x>.js; both must
  // resolve the server folder (a path seam: no build inside the tests).
  it('resolves the server folder from dist/server.js and dist/cli/<x>.js alike', () => {
    for (const app of [resolve('/app'), resolve('/repo/apps/server')]) {
      const journal = join(app, 'migrations', 'meta', '_journal.json');
      const exists = (path: string) => path === journal;
      const noPackage = (): string => {
        throw new Error('ENOENT');
      };
      expect(
        resolveServerDir(pathToFileURL(join(app, 'dist', 'server.js')).href, exists, noPackage),
      ).toBe(app);
      expect(
        resolveServerDir(
          pathToFileURL(join(app, 'dist', 'cli', 'restore.js')).href,
          exists,
          noPackage,
        ),
      ).toBe(app);
      expect(
        resolveServerDir(pathToFileURL(join(app, 'src', 'paths.ts')).href, exists, noPackage),
      ).toBe(app);
    }
    // The @joinr/server package.json marks the folder too (no migrations beside it).
    const app = resolve('/srv/app');
    const readFile = (path: string): string => {
      if (path === join(app, 'package.json')) return JSON.stringify({ name: '@joinr/server' });
      if (path === join(resolve('/srv'), 'package.json')) return JSON.stringify({ name: 'other' });
      throw new Error('ENOENT');
    };
    expect(
      resolveServerDir(
        pathToFileURL(join(app, 'dist', 'cli', 'import.js')).href,
        () => false,
        readFile,
      ),
    ).toBe(app);
    // Nothing found: the module's parent folder (the Stage 0 rule).
    expect(
      resolveServerDir(
        pathToFileURL(join(resolve('/x'), 'dist', 'server.js')).href,
        () => false,
        () => '{}',
      ),
    ).toBe(join(resolve('/x'), sep));
  });

  it('derives the migrations and web-dist defaults from the server folder', () => {
    expect(defaultMigrationsDir(serverDir)).toBe(join(serverDir, 'migrations'));
    expect(defaultWebDistDir(serverDir)).toBe(join(repoRoot, 'apps', 'web', 'dist'));
    // In the Docker image the server lives in /app, so migrations are /app/migrations.
    expect(defaultMigrationsDir(resolve('/app'))).toBe(join(resolve('/app'), 'migrations'));
  });
});
