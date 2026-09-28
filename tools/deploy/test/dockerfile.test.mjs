// Static checks of the Dockerfile, .dockerignore and the repo compose (stage-7.md §7.1). There is
// no Docker on the dev PC: the real build runs on the Umbrel (the live smoke, §9 step S).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../lib.mjs';

const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8');
const dockerignore = readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf8');
const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
/** The instructions, without comment lines. */
const code = dockerfile
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
const stages = code.split(/^FROM /m).slice(1);
const buildStage = stages.find((s) => /\bAS build\b/.test(s.split('\n')[0])) ?? '';
const runtimeStage = stages.find((s) => /\bAS runtime\b/.test(s.split('\n')[0])) ?? '';

describe('Dockerfile', () => {
  it('has no # syntax= directive', () => {
    expect(dockerfile).not.toMatch(/^#\s*syntax\s*=/im);
  });

  it('pins the base image by tag and a 64-hex index digest, for both stages', () => {
    expect(code).toMatch(/^ARG NODE_IMAGE=node:24\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
    expect(code.match(/^FROM \$\{NODE_IMAGE\} AS (build|runtime)$/gm)).toHaveLength(2);
    expect(code).not.toMatch(/^FROM (?!\$\{NODE_IMAGE\})/m);
  });

  it('checks both CLIs exist in the build output and run --help in the runtime', () => {
    for (const f of [
      'dist/server.js',
      'dist/cli/import.js',
      'dist/cli/restore.js',
      'migrations/meta/_journal.json',
      'web/index.html',
    ]) {
      expect(buildStage).toContain(`test -f /out/app/${f}`);
    }
    expect(runtimeStage).toMatch(/node dist\/cli\/restore\.js --help/);
    expect(runtimeStage).toMatch(/node dist\/cli\/import\.js --help/);
  });

  it('asserts the Melbourne time zone at build time, with the tzdata fallback commented out', () => {
    const tz = runtimeStage
      .split('\n')
      .find((l) => l.startsWith('RUN TZ=Australia/Melbourne node -e'));
    expect(tz).toBeDefined();
    for (const needle of [
      'new Date(Date.UTC(2030,6,1)).getTimezoneOffset() === -600',
      'new Date(Date.UTC(2030,0,1)).getTimezoneOffset() === -660',
      'new Date(2026,9,4,2,30).getHours() === 3',
      "Intl.DateTimeFormat().resolvedOptions().timeZone === 'Australia/Melbourne'",
      'process.exit(1)',
    ]) {
      expect(tz).toContain(needle);
    }
    expect(dockerfile).toMatch(
      /^# RUN apt-get update && apt-get install -y --no-install-recommends tzdata/m,
    );
    // The image sets no TZ of its own (the compose does).
    expect(code).not.toMatch(/^\s*(ENV|ARG)\b[^\n]*\bTZ=/m);
  });

  it('bounds the build stage memory only', () => {
    expect(buildStage).toMatch(/NODE_OPTIONS=--max-old-space-size=1536/);
    expect(runtimeStage).not.toMatch(/NODE_OPTIONS/);
  });

  it('labels the image with version, revision and source', () => {
    expect(runtimeStage).toMatch(/^ARG APP_VERSION$/m);
    expect(runtimeStage).toMatch(/^ARG APP_REVISION$/m);
    for (const label of [
      'title',
      'description',
      'source="https://github.com/devcal1/joinr-fin"',
      'version="${APP_VERSION}"',
      'revision="${APP_REVISION}"',
    ]) {
      expect(runtimeStage).toContain(`org.opencontainers.image.${label}`);
    }
  });

  it('bakes a given APP_VERSION into both builds (validated)', () => {
    expect(buildStage).toMatch(/^ARG APP_VERSION$/m);
    expect(buildStage).toContain('if [ -n "$APP_VERSION" ]');
    expect(buildStage).toContain('\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?$');
  });

  it('runs as node with a root-owned /app, a health check and the server command', () => {
    expect(runtimeStage).toMatch(/^USER node$/m);
    expect(runtimeStage).toMatch(/^WORKDIR \/app$/m);
    expect(runtimeStage).toMatch(/chown node:node \/data/);
    expect(runtimeStage).not.toMatch(/chown[^\n]*\/app/);
    expect(runtimeStage).toMatch(/^HEALTHCHECK /m);
    expect(runtimeStage).toContain('CMD ["node", "--enable-source-maps", "dist/server.js"]');
    expect(runtimeStage.indexOf('USER node')).toBeGreaterThan(
      runtimeStage.indexOf('RUN TZ=Australia/Melbourne'),
    );
  });

  it('keeps pnpm deploy inside the image and the frozen, offline install', () => {
    expect(buildStage).toContain('pnpm install --frozen-lockfile --offline');
    expect(buildStage).toContain('pnpm --filter @joinr/server deploy --prod --legacy /out/app');
  });
});

describe('.dockerignore and the repo compose', () => {
  const lines = dockerignore.split('\n').map((l) => l.trim());
  it('leaves out the deploy tools, e2e, docs and the Playwright config, not the privacy guard', () => {
    for (const p of [
      'tools/deploy',
      'e2e',
      'docs',
      'playwright.config.ts',
      'data',
      '.git',
      'reference/*',
      'docs/private',
    ]) {
      expect(lines).toContain(p);
    }
    expect(lines.some((l) => /^tools(\/\*|\/privacy-guard)?$/.test(l))).toBe(false);
  });

  it('the repo compose: loopback only, a grace period, TZ from the environment', () => {
    expect(compose).toContain("- '127.0.0.1:${JOINR_PORT:-3001}:3001'");
    expect(compose).toMatch(/^\s+stop_grace_period: 30s$/m);
    expect(compose).toContain("TZ: '${TZ:-UTC}'");
  });
});
