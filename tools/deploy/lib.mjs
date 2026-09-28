// Shared helpers for the Umbrel deploy scripts (docs/stages/stage-7.md §7.2–§7.6).
//
// These scripts run on the Windows dev PC with plain `node` (no package.json, no dependencies:
// Node built-ins only). Every remote step is one `ssh <host> -- '<command>'` call, and every value
// placed in a remote command is validated first and single-quoted with `shq()`, so no free text
// from an argument, the environment or the host ever reaches a shell unchecked.
//
// Commands go through a *runner* (`exec(spec)`), so the tests swap in a fake one and `--dry-run`
// swaps in one that prints every remote command instead of running it. A spec is
//   { purpose, cmd, args, remote?, readOnly?, cwd?, env?, input?, inputFile?, pipeFrom?, stream? }
// `purpose` names the step (the fake runner and the dry-run replies key on it).
import { spawn } from 'node:child_process';
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repository root (tools/deploy/../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ─── Constants ─────────────────────────────────────────────────────────────────────────────────

/** The image repository name in the loopback registry. */
export const IMAGE_NAME = 'joinr-finance';
/** The registry image, pinned by tag and index digest (Docker Hub, re-resolved 27/09/2026). */
export const REGISTRY_IMAGE =
  'registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373';
/** The Joinr Registry store app's id and its container (umbreld names it <app-id>_<service>_1). */
export const REGISTRY_APP_ID = 'tenon-joinr-registry';
export const REGISTRY_APP_CONTAINER = `${REGISTRY_APP_ID}_registry_1`;
/** Fallback (a): the plain registry container. */
export const REGISTRY_CONTAINER = 'joinr-registry';
/** The app port in the store manifest (app_proxy listens on it on the host). */
export const APP_PORT = 4932;
/** The live smoke run (§9 step S): container, loopback port and folder under the build root. */
export const SMOKE_CONTAINER = 'joinr-smoke';
export const SMOKE_PORT = 4939;
export const SMOKE_DIR = 'smoke';
/** The time zone the app runs in (D114); the compose file sets it. */
export const DEFAULT_TZ = 'Australia/Melbourne';
/** The build stage needs this much free memory on the host (§7.2). */
export const MIN_MEM_AVAILABLE_KB = 2.5 * 1024 * 1024;
/** Keep this many build contexts under the build root. */
export const KEEP_BUILD_CONTEXTS = 3;
/** The store compose ships this placeholder until the first release. */
export const PLACEHOLDER_DIGEST = `sha256:${'0'.repeat(64)}`;
/** Every manifest media type the registry may hold for the pinned reference. */
export const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

/**
 * A copy of `BACKUP_FILE_NAME_RE` and `BACKUP_DOWNLOAD_PREFIX` from `@joinr/schema`
 * (`packages/schema/src/backups.ts`); a test keeps them equal. Copied because these scripts are
 * plain `.mjs` run with `node`, with no TypeScript loader.
 */
export const BACKUP_FILE_NAME_RE =
  /^(?:(?:nightly|manual|pre-restore|pre-migrate)-\d{8}-\d{6}[+-]\d{4}|pre-import-\d{8}-\d{6}(?:[+-]\d{4})?)(?:-[2-9]|-[1-9]\d{1,2})?\.db$/;
export const BACKUP_DOWNLOAD_PREFIX = 'joinr-finance-';
export const BACKUP_FILE_NAME_MAX = 64;

// ─── Errors ────────────────────────────────────────────────────────────────────────────────────

/** A refusal or failure with the exit code the script ends with. */
export class DeployError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'DeployError';
    this.exitCode = exitCode;
  }
}

// ─── Validation and quoting ────────────────────────────────────────────────────────────────────

const RULES = {
  version: /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/,
  prerelease: /^[0-9A-Za-z.]+$/,
  treeId: /^[0-9a-f]{40}$/,
  port: /^\d{1,5}$/,
  home: /^\/[A-Za-z0-9._/-]+$/,
  appId: /^[a-z0-9][a-z0-9-]{0,62}$/,
  segment: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  relPath: /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
  container: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/,
  imageRef: /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/,
  imageId: /^sha256:[0-9a-f]{64}$/,
  digest: /^sha256:[0-9a-f]{64}$/,
  tz: /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/,
  host: /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/,
};

/** Throws `DeployError` (exit 2) unless `value` matches the named rule. */
export function validate(kind, value, label = kind) {
  const rule = RULES[kind];
  if (!rule) throw new Error(`unknown rule ${kind}`);
  if (typeof value !== 'string' || !rule.test(value)) {
    throw new DeployError(`Invalid ${label}: ${JSON.stringify(String(value)).slice(0, 80)}`, 2);
  }
  if (kind === 'home' || kind === 'relPath') {
    const segments = value.split('/');
    if (segments.some((s) => s === '..' || s === '.')) {
      throw new DeployError(`Invalid ${label}: no "." or ".." segments`, 2);
    }
  }
  if (kind === 'port') {
    const n = Number(value);
    if (n < 1 || n > 65535) throw new DeployError(`Invalid ${label}: ${value}`, 2);
  }
  return value;
}

/** Wraps a value in single quotes for a POSIX shell (`'` becomes `'\''`). */
export function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Validates a backup name for the restore wrapper: strips the download prefix, then applies the
 * shared name rule and the length limit.
 */
export function validateBackupName(raw) {
  let name = String(raw);
  if (name.startsWith(BACKUP_DOWNLOAD_PREFIX)) name = name.slice(BACKUP_DOWNLOAD_PREFIX.length);
  if (name.length > BACKUP_FILE_NAME_MAX || !BACKUP_FILE_NAME_RE.test(name)) {
    throw new DeployError(
      `Not a backup file name: ${JSON.stringify(String(raw)).slice(0, 80)} (expected e.g. nightly-20300315-023000+1100.db)`,
      2,
    );
  }
  return name;
}

// ─── Configuration ─────────────────────────────────────────────────────────────────────────────

/**
 * The deploy configuration from the environment (§7.6). Remote paths are built later from the
 * resolved remote home; nothing here is a path on the host.
 */
export function loadDeployConfig(env = process.env, repoRoot = REPO_ROOT) {
  const pick = (name, fallback) => {
    const v = env[name];
    return v === undefined || v === '' ? fallback : v;
  };
  const mode = pick('JOINR_REGISTRY_MODE', 'app');
  if (mode !== 'app' && mode !== 'container') {
    throw new DeployError('JOINR_REGISTRY_MODE must be "app" or "container"', 2);
  }
  const config = {
    host: validate('host', pick('JOINR_DEPLOY_HOST', 'umbrel'), 'JOINR_DEPLOY_HOST'),
    registryPort: Number(
      validate('port', pick('JOINR_REGISTRY_PORT', '4930'), 'JOINR_REGISTRY_PORT'),
    ),
    registryMode: mode,
    storeDir: resolve(repoRoot, pick('JOINR_STORE_DIR', '../tenon-umbrel-store')),
    appId: validate('appId', pick('JOINR_APP_ID', 'tenon-joinr-finance'), 'JOINR_APP_ID'),
    remoteBuildRoot: validate(
      'relPath',
      pick('JOINR_REMOTE_BUILD_ROOT', 'joinr-build'),
      'JOINR_REMOTE_BUILD_ROOT',
    ),
    registryData: validate(
      'relPath',
      pick('JOINR_REGISTRY_DATA', 'joinr-registry'),
      'JOINR_REGISTRY_DATA',
    ),
    sshOverride: pick('JOINR_SSH', undefined),
    gitOverride: pick('JOINR_GIT', undefined),
    repoRoot,
  };
  return config;
}

/** The image reference in the loopback registry for a version. */
export function imageRef(config, version) {
  return `127.0.0.1:${config.registryPort}/${IMAGE_NAME}:${validate('version', version)}`;
}

/** The root package.json version (the app version everywhere, §7.5). */
export function readAppVersion(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return validate('version', pkg.version, 'package.json version');
}

// ─── Binaries ──────────────────────────────────────────────────────────────────────────────────

/**
 * The first `name` on PATH (with PATHEXT on Windows), or the override. A `.cmd`/`.bat` shim is
 * refused: spawning one without a shell fails on Windows (EINVAL since the CVE-2024-27980 fix).
 */
export function resolveBinary(
  name,
  override,
  env = process.env,
  exists = existsSync,
  platform = process.platform,
) {
  const refuseShim = (p) => {
    if (/\.(cmd|bat)$/i.test(p)) {
      throw new DeployError(`${p} is a .cmd/.bat shim; point to the real ${name} executable`, 2);
    }
    return p;
  };
  if (override) {
    if (!exists(override)) throw new DeployError(`${name} not found at ${override}`, 2);
    return refuseShim(override);
  }
  const pathVar = env.PATH ?? env.Path ?? '';
  const exts =
    platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter((e) => /^\.(exe|com)$/i.test(e))
          .map((e) => e.toLowerCase())
      : [''];
  for (const dir of pathVar.split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (exists(candidate)) return candidate;
    }
  }
  throw new DeployError(
    `${name} was not found on PATH (set JOINR_${name.toUpperCase()} to its full path)`,
    2,
  );
}

/** Resolves ssh and git once and prints which binaries are used (§7.2). */
export function resolveBinaries(ctx, { needGit = true } = {}) {
  const bins = {
    ssh: resolveBinary('ssh', ctx.config.sshOverride, ctx.env, ctx.exists, ctx.platform),
    git: needGit
      ? resolveBinary('git', ctx.config.gitOverride, ctx.env, ctx.exists, ctx.platform)
      : undefined,
  };
  ctx.out(`Using ssh: ${bins.ssh}`);
  if (bins.git) ctx.out(`Using git: ${bins.git}`);
  ctx.bins = bins;
  return bins;
}

/** The tsx CLI of this checkout (so the guard runs as `node <tsx cli> …`, never via pnpm). */
export function tsxCliPath() {
  return createRequire(import.meta.url).resolve('tsx/cli');
}

// ─── Runners ───────────────────────────────────────────────────────────────────────────────────

/** How a spec reads when printed. */
export function renderSpec(spec) {
  const one = (cmd, args, env) => {
    const envText = env
      ? Object.entries(env)
          .map(([k, v]) => `${k}=${v} `)
          .join('')
      : '';
    return `${envText}${[cmd, ...args].map(renderArg).join(' ')}`;
  };
  // A remote command is shown as the host's shell will read it (the last argument, raw).
  let text = spec.remote
    ? `${one(spec.cmd, spec.args.slice(0, -1), spec.env)} ${spec.args.at(-1)}`
    : one(spec.cmd, spec.args, spec.env);
  if (spec.pipeFrom)
    text = `${one(spec.pipeFrom.cmd, spec.pipeFrom.args, spec.pipeFrom.env)} | ${text}`;
  if (spec.inputFile) text = `${text} < ${renderArg(spec.inputFile)}`;
  return text;
}

function renderArg(arg) {
  const s = String(arg);
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s) ? s : shq(s);
}

/** Runs commands for real (child_process.spawn, no shell). */
export function createRealRunner() {
  return {
    kind: 'real',
    exec(spec) {
      return new Promise((resolvePromise, reject) => {
        const env = spec.env ? { ...process.env, ...spec.env } : process.env;
        const stdinMode =
          spec.input !== undefined || spec.inputFile || spec.pipeFrom ? 'pipe' : 'ignore';
        const outMode = spec.stream ? 'inherit' : 'pipe';
        let child;
        try {
          child = spawn(spec.cmd, spec.args, {
            cwd: spec.cwd,
            env,
            stdio: [stdinMode, outMode, outMode],
            windowsHide: true,
            shell: false,
          });
        } catch (err) {
          reject(err);
          return;
        }
        const stdout = [];
        const stderr = [];
        child.stdout?.on('data', (c) => stdout.push(c));
        child.stderr?.on('data', (c) => stderr.push(c));

        let source;
        let sourceCode = 0;
        const sourceDone = new Promise((r) => {
          if (!spec.pipeFrom) return r();
          source = spawn(spec.pipeFrom.cmd, spec.pipeFrom.args, {
            cwd: spec.pipeFrom.cwd,
            env: spec.pipeFrom.env ? { ...process.env, ...spec.pipeFrom.env } : process.env,
            stdio: ['ignore', 'pipe', 'inherit'],
            windowsHide: true,
            shell: false,
          });
          source.on('error', (err) => {
            sourceCode = -1;
            child.stdin?.destroy();
            reject(err);
          });
          source.on('close', (code) => {
            sourceCode = code ?? -1;
            r();
          });
          source.stdout.pipe(child.stdin);
        });
        if (spec.inputFile) createReadStream(spec.inputFile).pipe(child.stdin);
        else if (spec.input !== undefined) child.stdin.end(spec.input);
        child.stdin?.on('error', () => {}); // EPIPE when the remote side exits early

        child.on('error', reject);
        child.on('close', async (code) => {
          await sourceDone;
          resolvePromise({
            code: sourceCode !== 0 ? sourceCode : (code ?? -1),
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
          });
        });
      });
    },
  };
}

/**
 * A runner for tests: records every spec and answers with `respond(spec)` (default: exit 0, no
 * output). It never spawns anything.
 */
export function createFakeRunner(respond = () => undefined) {
  const calls = [];
  return {
    kind: 'fake',
    calls,
    async exec(spec) {
      calls.push(spec);
      const reply = await respond(spec);
      return { code: 0, stdout: '', stderr: '', ...(reply ?? {}) };
    },
  };
}

/**
 * `--dry-run`: prints every command. Local read-only commands (git queries) still run through
 * `inner`, so the printed tree id is real; everything remote, and every local write, is printed
 * only and answered by `reply(spec)` (a plausible stand-in so the flow can continue).
 */
export function createDryRunRunner(inner, out, reply = () => undefined) {
  return {
    kind: 'dry-run',
    inner,
    async exec(spec) {
      if (!spec.remote && spec.readOnly) return inner.exec(spec);
      out(`[dry-run] ${renderSpec(spec)}`);
      const r = await reply(spec);
      return { code: 0, stdout: '', stderr: '', ...(r ?? {}) };
    },
  };
}

// ─── Context and remote helpers ────────────────────────────────────────────────────────────────

/**
 * The context every script runs with. `deps` (tests) may replace the runner, output, clock,
 * sleep, environment and file checks.
 */
export function createContext(deps = {}, { dryRun = false, dryRunReply } = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
  const env = deps.env ?? process.env;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const base = deps.runner ?? createRealRunner();
  const runner = dryRun ? createDryRunRunner(base, out, dryRunReply) : base;
  return {
    config: deps.config ?? loadDeployConfig(env, repoRoot),
    env,
    repoRoot,
    runner,
    dryRun,
    out,
    err,
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    exists: deps.exists ?? existsSync,
    platform: deps.platform ?? process.platform,
    bins: deps.bins,
    home: undefined,
  };
}

/** The ssh arguments for one remote command (BatchMode: never a password prompt). */
export function sshArgs(host, command, extra = []) {
  return ['-o', 'BatchMode=yes', ...extra, '-o', 'ServerAliveInterval=30', host, '--', command];
}

/** Runs one remote command over ssh. */
export function remote(ctx, purpose, command, extra = {}) {
  return ctx.runner.exec({
    purpose,
    cmd: ctx.bins.ssh,
    args: sshArgs(ctx.config.host, command),
    remote: true,
    ...extra,
  });
}

/** Like `remote`, but a non-zero exit throws with `message` (and the remote stderr's first line). */
export async function remoteOk(ctx, purpose, command, message, extra = {}) {
  const r = await remote(ctx, purpose, command, extra);
  if (r.code !== 0) {
    const detail = (r.stderr || '').trim().split('\n')[0];
    throw new DeployError(
      detail ? `${message} (${detail.slice(0, 200)})` : message,
      extra.exitCode ?? 1,
    );
  }
  return r;
}

/** Runs one local command (git, the guard). */
export function local(ctx, purpose, cmd, args, extra = {}) {
  return ctx.runner.exec({ purpose, cmd, args, cwd: ctx.repoRoot, ...extra });
}

/** The preflight probe: key auth works and the host answers within 10 s (§7.2). */
export async function preflight(ctx) {
  const r = await ctx.runner.exec({
    purpose: 'preflight',
    cmd: ctx.bins.ssh,
    args: sshArgs(ctx.config.host, 'true', ['-o', 'ConnectTimeout=10']),
    remote: true,
  });
  if (r.code !== 0) {
    throw new DeployError(
      `Cannot reach ${ctx.config.host} over SSH with key auth: check Tailscale and the SSH alias`,
      2,
    );
  }
}

/** The remote user's home, resolved once, validated, never written to any file (§7.2). */
export async function remoteHome(ctx) {
  if (ctx.home) return ctx.home;
  const r = await remoteOk(
    ctx,
    'remote-home',
    'printf %s "$HOME"',
    'Could not read the remote home folder',
  );
  ctx.home = validate('home', r.stdout.trim(), 'remote home');
  if (ctx.dryRun && ctx.home === DRY_RUN_HOME) {
    ctx.out(`(dry run: the remote home is shown as ${DRY_RUN_HOME})`);
  }
  return ctx.home;
}

/** Joins validated path parts under the remote home (absolute; never `~`). */
export function remotePath(home, ...parts) {
  for (const p of parts) validate('relPath', p, 'remote path');
  return [home.replace(/\/+$/, ''), ...parts].join('/');
}

/** The stand-in remote home printed by `--dry-run` (no ssh is run to learn the real one). */
export const DRY_RUN_HOME = '/dry-run-home';

/** Dry-run replies shared by every script. */
export function commonDryRunReply(spec) {
  if (spec.purpose === 'remote-home') return { stdout: DRY_RUN_HOME };
  return undefined;
}

/** `docker inspect` state of a container: 'missing' when there is no such container. */
export async function containerState(ctx, name) {
  validate('container', name, 'container name');
  const r = await remote(
    ctx,
    'container-state',
    `docker inspect -f '{{.State.Status}}' ${shq(name)}`,
  );
  if (r.code !== 0) {
    if (/no such (object|container)/i.test(r.stderr) || r.stderr.trim() === '') return 'missing';
    throw new DeployError(
      `docker inspect failed: ${r.stderr.trim().split('\n')[0].slice(0, 200)}`,
      1,
    );
  }
  const state = r.stdout.trim();
  if (!/^[a-z]+$/.test(state))
    throw new DeployError(`Unexpected container state: ${state.slice(0, 40)}`, 1);
  return state;
}

/** Parses `ss -ltnH` output into the local address and port of each listener. */
export function parseListeners(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const addr = cols[3];
    const m = /^(.*):(\d+)$/.exec(addr);
    if (m) out.push({ address: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) });
  }
  return out;
}

/** The host's TCP listeners. */
export async function listeners(ctx) {
  const r = await remoteOk(ctx, 'listeners', 'ss -ltnH', 'Could not list the host listeners');
  return parseListeners(r.stdout);
}

/** HEAD of a manifest in the loopback registry: the HTTP status as a number (0 = no answer). */
export async function manifestStatus(ctx, reference) {
  const ref = reference.startsWith('sha256:')
    ? validate('digest', reference)
    : validate('version', reference);
  const url = `http://127.0.0.1:${ctx.config.registryPort}/v2/${IMAGE_NAME}/manifests/${ref}`;
  const r = await remote(
    ctx,
    'manifest-head',
    `curl -s -o /dev/null -w '%{http_code}' -I -H ${shq(`Accept: ${MANIFEST_ACCEPT}`)} ${shq(url)}`,
  );
  const status = Number(r.stdout.trim());
  return Number.isInteger(status) ? status : 0;
}

/** Waits for a container's health to be `healthy` (≤ timeoutMs). */
export async function waitHealthy(ctx, name, timeoutMs = 120_000, stepMs = 3_000) {
  const start = ctx.now().getTime();
  for (;;) {
    const r = await remote(
      ctx,
      'health',
      `docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${shq(name)}`,
    );
    const status = r.stdout.trim();
    if (status === 'healthy' || (ctx.dryRun && r.code === 0)) return true;
    if (ctx.now().getTime() - start >= timeoutMs) return false;
    await ctx.sleep(stepMs);
  }
}

// ─── Store files ───────────────────────────────────────────────────────────────────────────────

/** The one compose image line the release writes (§7.4). */
export const COMPOSE_IMAGE_LINE_RE =
  /^\s*image:\s*127\.0\.0\.1:\d+\/joinr-finance:\S+@sha256:[0-9a-f]{64}\s*$/gm;
/** The manifest version line. */
export const MANIFEST_VERSION_LINE_RE = /^version: '[^']*'$/gm;

/** Reads the pinned image of the store compose: `{ ref, version, digest }`. */
export function parseComposeImage(text) {
  const lines = text.match(COMPOSE_IMAGE_LINE_RE) ?? [];
  if (lines.length !== 1) {
    throw new DeployError(
      `Expected exactly one joinr-finance image line in the compose file, found ${lines.length}`,
      2,
    );
  }
  const m = /image:\s*(127\.0\.0\.1:\d+\/joinr-finance:(\S+)@(sha256:[0-9a-f]{64}))/.exec(lines[0]);
  return { ref: m[1], version: m[2], digest: m[3] };
}

/** Reads `version: '<v>'` of a manifest. */
export function parseManifestVersion(text) {
  const lines = text.match(MANIFEST_VERSION_LINE_RE) ?? [];
  if (lines.length !== 1) {
    throw new DeployError(
      `Expected exactly one version line in umbrel-app.yml, found ${lines.length}`,
      2,
    );
  }
  return /'([^']*)'/.exec(lines[0])[1];
}

/** The store files of the app: paths, text, the pinned image and the manifest version. */
export function readStoreApp(storeDir, appId) {
  const dir = join(storeDir, appId);
  const composePath = join(dir, 'docker-compose.yml');
  const manifestPath = join(dir, 'umbrel-app.yml');
  if (!existsSync(composePath) || !existsSync(manifestPath)) {
    throw new DeployError(`The store clone has no ${appId}/ app folder (JOINR_STORE_DIR)`, 2);
  }
  const compose = readFileSync(composePath, 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');
  return {
    dir,
    composePath,
    manifestPath,
    compose,
    manifest,
    image: parseComposeImage(compose),
    version: parseManifestVersion(manifest),
  };
}

// ─── Misc ──────────────────────────────────────────────────────────────────────────────────────

/** A UTC stamp for file names: 20300315T023000Z. */
export function utcStamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** A tiny argument parser: `spec` maps a flag to 'boolean' or 'string'. */
export function parseFlags(argv, spec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      const kind = spec[name];
      if (!kind) throw new DeployError(`Unknown option --${name}`, 2);
      if (kind === 'boolean') {
        if (inline !== undefined) throw new DeployError(`--${name} takes no value`, 2);
        flags[name] = true;
      } else {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new DeployError(`--${name} needs a value`, 2);
        flags[name] = v;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

/** Runs `main` and turns a DeployError into its exit code. */
export async function runMain(fn, ctxOut = (l) => process.stderr.write(`${l}\n`)) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DeployError) {
      ctxOut(`Error: ${err.message}`);
      return err.exitCode;
    }
    ctxOut(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/** True when `metaUrl` is the file node was started with. */
export function isEntry(metaUrl) {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

/** Checks a local file is a SQLite database file: size and the 16-byte header. */
export function checkSqliteFile(path, readHead = defaultReadHead) {
  if (!isAbsolute(path)) path = resolve(path);
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new DeployError(`No such file: ${path}`, 2);
  }
  if (!st.isFile()) throw new DeployError(`Not a regular file: ${path}`, 2);
  if (st.size < 512) throw new DeployError(`Too small to be a database: ${path}`, 5);
  const head = readHead(path);
  if (!head.equals(Buffer.from('SQLite format 3\0', 'latin1'))) {
    throw new DeployError(`Not a SQLite database (bad header): ${path}`, 5);
  }
  return { path, size: st.size };
}

function defaultReadHead(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
