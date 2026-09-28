// Test helpers: a fake host (the fake runner with default replies per step), a context for the
// scripts' `main(argv, deps)`, and a temporary store clone. No test ever spawns ssh, git or docker.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT, createFakeRunner } from '../lib.mjs';

export const SSH = '/usr/bin/ssh';
export const GIT = '/usr/bin/git';
export const HOME = '/remote/home';
export const TREE = 'b'.repeat(40);
export const HEAD = 'a'.repeat(40);
export const DIGEST = `sha256:${'c'.repeat(64)}`;
export const IMAGE_ID = `sha256:${'e'.repeat(64)}`;

/** The real store clone, when present (JOINR_STORE_DIR or the sibling folder). */
export const REAL_STORE_DIR = resolve(
  REPO_ROOT,
  process.env.JOINR_STORE_DIR || '../tenon-umbrel-store',
);
export const HAS_REAL_STORE = existsSync(
  join(REAL_STORE_DIR, 'tenon-joinr-finance', 'umbrel-app.yml'),
);

const SYNTHETIC_COMPOSE = `version: '3.7'
services:
  app_proxy:
    environment:
      APP_HOST: tenon-joinr-finance_app_1
      APP_PORT: 3001
  app:
    image: 127.0.0.1:4930/joinr-finance:1.0.0@sha256:${'0'.repeat(64)}
    restart: on-failure
`;
const SYNTHETIC_MANIFEST = `manifestVersion: 1
id: tenon-joinr-finance
name: Joinr Finance
version: '1.0.0'
port: 4932
`;

/**
 * A temporary store clone with a `tenon-joinr-finance/` folder: a copy of the real store's files
 * when the clone is present, else a small synthetic pair. Returns { dir, compose, manifest, cleanup }.
 */
export function makeStore({ compose, manifest } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-deploy-store-'));
  const app = join(dir, 'tenon-joinr-finance');
  mkdirSync(app, { recursive: true });
  if (HAS_REAL_STORE && compose === undefined && manifest === undefined) {
    cpSync(
      join(REAL_STORE_DIR, 'tenon-joinr-finance', 'docker-compose.yml'),
      join(app, 'docker-compose.yml'),
    );
    cpSync(
      join(REAL_STORE_DIR, 'tenon-joinr-finance', 'umbrel-app.yml'),
      join(app, 'umbrel-app.yml'),
    );
  } else {
    writeFileSync(join(app, 'docker-compose.yml'), compose ?? SYNTHETIC_COMPOSE);
    writeFileSync(join(app, 'umbrel-app.yml'), manifest ?? SYNTHETIC_MANIFEST);
  }
  return {
    dir,
    composePath: join(app, 'docker-compose.yml'),
    manifestPath: join(app, 'umbrel-app.yml'),
    read: () => ({
      compose: readFileSync(join(app, 'docker-compose.yml'), 'utf8'),
      manifest: readFileSync(join(app, 'umbrel-app.yml'), 'utf8'),
    }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The last argument of an ssh spec: the remote command. */
export const remoteCommand = (spec) => spec.args.at(-1);

/**
 * Default replies of a healthy host for a release: registry app running, the tag free, enough
 * memory, a pushed digest, no port conflicts.
 */
export function defaultReply(spec) {
  const cmd = spec.args?.at(-1) ?? '';
  switch (spec.purpose) {
    case 'git-status':
      return { stdout: '' };
    case 'git-head':
      return { stdout: `${HEAD}\n` };
    case 'git-tree':
    case 'git-write-tree':
      return { stdout: `${TREE}\n` };
    case 'remote-home':
      return { stdout: HOME };
    case 'container-state':
      return cmd.includes('tenon-joinr-registry_registry_1')
        ? { stdout: 'running\n' }
        : { code: 1, stderr: 'Error: No such object: x' };
    case 'registry-v2':
      return { stdout: '200' };
    case 'manifest-head':
      return { stdout: cmd.includes('/manifests/sha256:') ? '200' : '404' };
    case 'meminfo':
      return { stdout: 'MemTotal:       16000000 kB\nMemAvailable:    4000000 kB\n' };
    case 'repo-digests':
      return { stdout: JSON.stringify([`127.0.0.1:4930/joinr-finance@${DIGEST}`]) };
    case 'digest-header':
      return {
        stdout: `HTTP/1.1 200 OK\r\nContent-Type: x\r\nDocker-Content-Digest: ${DIGEST}\r\n\r\n`,
      };
    case 'health':
      return { stdout: 'healthy\n' };
    case 'image-id':
      return { stdout: `${IMAGE_ID}\n` };
    default:
      return undefined;
  }
}

/**
 * A fake host: `overrides[purpose]` (an object or a function of the spec) wins over the default
 * replies. Returns { runner, calls, out, err, deps(extra) }.
 */
export function fakeHost(overrides = {}, env = {}) {
  const runner = createFakeRunner((spec) => {
    const o = overrides[spec.purpose];
    if (o !== undefined) return typeof o === 'function' ? o(spec) : o;
    return defaultReply(spec);
  });
  const out = [];
  const err = [];
  let clock = Date.UTC(2030, 2, 15, 3, 0, 0);
  return {
    runner,
    calls: runner.calls,
    out,
    err,
    /** The purposes of every call, in order. */
    purposes: () => runner.calls.map((c) => c.purpose),
    /** The calls for one purpose. */
    callsFor: (p) => runner.calls.filter((c) => c.purpose === p),
    deps: (extra = {}) => ({
      runner,
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      env: { JOINR_SSH: SSH, JOINR_GIT: GIT, PATH: '', ...env },
      exists: () => true,
      platform: 'linux',
      now: () => new Date(clock),
      sleep: async (ms) => {
        clock += ms;
      },
      readVersion: () => '1.2.3',
      tsxCli: '/repo/node_modules/tsx/dist/cli.mjs',
      appendReleaseLog: () => {},
      ...extra,
    }),
  };
}

/** Every remote command string the fake host received. */
export const remoteCommands = (calls) => calls.filter((c) => c.remote).map(remoteCommand);
