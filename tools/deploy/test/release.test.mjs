import { afterEach, describe, expect, it } from 'vitest';
import { PLACEHOLDER_DIGEST } from '../lib.mjs';
import {
  CONTEXT_NAME_RE,
  main,
  parseDigestHeader,
  parseMemAvailable,
  parseRepoDigests,
  planStoreEdit,
} from '../release.mjs';
import {
  DIGEST,
  GIT,
  HEAD,
  HOME,
  SSH,
  TREE,
  fakeHost,
  makeStore,
  remoteCommand,
  remoteCommands,
} from './helpers.mjs';

let store;
afterEach(() => {
  store?.cleanup();
  store = undefined;
});

/** A fake host plus a temporary store clone wired through JOINR_STORE_DIR. */
function setup(overrides = {}, env = {}, storeFiles) {
  store = makeStore(storeFiles);
  return fakeHost(overrides, { JOINR_STORE_DIR: store.dir, ...env });
}

describe('release: the happy path', () => {
  it('runs every step in order and writes the store', async () => {
    const host = setup();
    const logged = [];
    const code = await main(
      [],
      host.deps({ appendReleaseLog: (_root, line) => logged.push(line) }),
    );
    expect(code).toBe(0);
    expect(host.purposes()).toEqual([
      'git-status',
      'git-head',
      'git-tree',
      'guard',
      'preflight',
      'remote-home',
      'container-state', // the Joinr Registry app
      'registry-v2',
      'manifest-head', // the tag
      'meminfo',
      'transfer',
      'docker-build',
      'docker-push',
      'repo-digests',
      'digest-header',
      'list-contexts',
      'manifest-head', // the pinned digest, before the store write
      'manifest-ports',
      'listeners',
      'store-diff',
      'store-status',
    ]);
    const { compose, manifest } = store.read();
    expect(compose).toContain(`    image: 127.0.0.1:4930/joinr-finance:1.2.3@${DIGEST}\n`);
    expect(manifest).toMatch(/^version: '1\.2\.3'$/m);
    // The release log: version, tree, HEAD, clean, digest; never the remote home.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`version=1.2.3 tree=${TREE} head=${HEAD} clean digest=${DIGEST}`);
    expect(logged[0]).not.toContain(HOME);
  });

  it('prints the binaries it resolved', async () => {
    const host = setup();
    await main([], host.deps());
    expect(host.out).toContain(`Using ssh: ${SSH}`);
    expect(host.out).toContain(`Using git: ${GIT}`);
  });

  it('runs the guard first, as node + the tsx CLI, never pnpm', async () => {
    const host = setup();
    await main([], host.deps());
    const guard = host.callsFor('guard')[0];
    expect(guard.cmd).toBe(process.execPath);
    expect(guard.args).toEqual([
      '/repo/node_modules/tsx/dist/cli.mjs',
      'tools/privacy-guard/src/cli.ts',
      '--all',
    ]);
    expect(host.purposes().indexOf('guard')).toBeLessThan(host.purposes().indexOf('preflight'));
    for (const c of host.calls) {
      expect(c.cmd).not.toMatch(/pnpm|\.cmd$/i);
    }
  });

  it('a failing guard ships nothing (exit 2)', async () => {
    const host = setup({ guard: { code: 1 } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
    expect(host.calls.some((c) => c.remote)).toBe(false);
  });

  it('probes ssh with BatchMode and ConnectTimeout, and explains a failure', async () => {
    const host = setup({ preflight: { code: 255 } });
    await expect(main([], host.deps())).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('Cannot reach umbrel over SSH with key auth'),
    });
    const probe = host.callsFor('preflight')[0];
    expect(probe.cmd).toBe(SSH);
    expect(probe.args).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=30',
      'umbrel',
      '--',
      'true',
    ]);
  });

  it('every ssh call has BatchMode and ServerAliveInterval; no remote command uses ~', async () => {
    const host = setup();
    await main([], host.deps());
    for (const c of host.calls.filter((x) => x.remote)) {
      expect(c.args.slice(0, 2)).toEqual(['-o', 'BatchMode=yes']);
      expect(c.args).toContain('ServerAliveInterval=30');
      expect(remoteCommand(c)).not.toMatch(/~/);
    }
  });

  it('ships the tree with git archive into an absolute context folder and builds there', async () => {
    const host = setup();
    await main([], host.deps());
    const transfer = host.callsFor('transfer')[0];
    const dir = `${HOME}/joinr-build/1.2.3-${TREE.slice(0, 12)}`;
    expect(transfer.pipeFrom).toMatchObject({ cmd: GIT, args: ['archive', '--format=tar', TREE] });
    expect(remoteCommand(transfer)).toBe(`mkdir -p '${dir}' && tar -x -C '${dir}'`);
    expect(remoteCommand(host.callsFor('docker-build')[0])).toBe(
      `docker build --provenance=false --build-arg APP_VERSION=1.2.3 --build-arg APP_REVISION=${TREE} -t '127.0.0.1:4930/joinr-finance:1.2.3' '${dir}'`,
    );
    expect(remoteCommand(host.callsFor('docker-push')[0])).toBe(
      "docker push '127.0.0.1:4930/joinr-finance:1.2.3'",
    );
  });
});

describe('release: the tree', () => {
  it('refuses a dirty tree without --allow-dirty (exit 2), before anything remote', async () => {
    const host = setup({ 'git-status': { stdout: ' M package.json\n' } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
    expect(host.calls.some((c) => c.remote)).toBe(false);
  });

  it('builds the working-copy tree in a temporary index with --allow-dirty', async () => {
    const host = setup({ 'git-status': { stdout: '?? new.txt\n' } });
    const logged = [];
    await main(['--allow-dirty'], host.deps({ appendReleaseLog: (_r, l) => logged.push(l) }));
    const steps = ['git-read-tree', 'git-add', 'git-write-tree'].map((p) => host.callsFor(p)[0]);
    expect(steps.map((s) => s.args)).toEqual([
      ['read-tree', 'HEAD'],
      ['add', '-A'],
      ['write-tree'],
    ]);
    const index = steps[0].env.GIT_INDEX_FILE;
    expect(index).toMatch(/joinr-release-index-/);
    for (const s of steps) expect(s.env).toEqual({ GIT_INDEX_FILE: index });
    expect(host.callsFor('git-tree')).toHaveLength(0);
    expect(logged[0]).toContain(' dirty ');
  });

  it('refuses a tree id that is not 40 hex characters', async () => {
    const host = setup({ 'git-tree': { stdout: 'not-a-tree' } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('release: host checks', () => {
  it('refuses to build with less than 2.5 GiB available (exit 5)', async () => {
    const host = setup({ meminfo: { stdout: 'MemAvailable:    2000000 kB\n' } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 5 });
    expect(host.callsFor('docker-build')).toHaveLength(0);
  });

  it('--force-build overrides the memory guard', async () => {
    const host = setup({ meminfo: { stdout: 'MemAvailable:    2000000 kB\n' } });
    expect(await main(['--force-build'], host.deps())).toBe(0);
    expect(host.callsFor('docker-build')).toHaveLength(1);
  });

  it('needs the registry (exit 3) before anything is built', async () => {
    const host = setup({ 'registry-v2': { stdout: '000' } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 3 });
    expect(host.callsFor('transfer')).toHaveLength(0);
  });

  it('refuses a remote home that is not a plain absolute path', async () => {
    const host = setup({ 'remote-home': { stdout: '/srv/x y' } });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('release: immutable tags', () => {
  const tagTaken = { 'manifest-head': { stdout: '200' } };

  it('refuses a version already in the registry (exit 4)', async () => {
    const host = setup(tagTaken);
    await expect(main([], host.deps())).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('bump the version'),
    });
    expect(host.callsFor('docker-build')).toHaveLength(0);
  });

  it('--reuse-existing with the same tree label writes the store only', async () => {
    const host = setup({ ...tagTaken, 'image-revision': { stdout: `${TREE}\n` } });
    expect(await main(['--reuse-existing'], host.deps())).toBe(0);
    expect(host.callsFor('docker-build')).toHaveLength(0);
    expect(host.callsFor('docker-push')).toHaveLength(0);
    expect(host.callsFor('transfer')).toHaveLength(0);
    expect(store.read().compose).toContain(`joinr-finance:1.2.3@${DIGEST}`);
  });

  it('--reuse-existing with a different tree label → exit 4', async () => {
    const host = setup({ ...tagTaken, 'image-revision': { stdout: `${'f'.repeat(40)}\n` } });
    await expect(main(['--reuse-existing'], host.deps())).rejects.toMatchObject({ exitCode: 4 });
  });

  it('refuses a digest the registry header does not confirm', async () => {
    const host = setup({
      'digest-header': { stdout: `Docker-Content-Digest: sha256:${'9'.repeat(64)}\r\n` },
    });
    // The store as it was before the release (the real clone's pin since 1.0.0, not the placeholder).
    const before = store.read();
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 1 });
    expect(store.read()).toEqual(before);
    expect(store.read().compose).not.toContain(`sha256:${'9'.repeat(64)}`);
  });
});

describe('release: prerelease and skip-store', () => {
  it('--prerelease needs --skip-store', async () => {
    const host = setup();
    await expect(main(['--prerelease', 'rc.1'], host.deps())).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(host.calls).toHaveLength(0);
  });

  it('--prerelease rc.1 --skip-store tags <v>-rc.1 and never touches the store', async () => {
    const host = setup();
    const before = store.read();
    expect(await main(['--prerelease', 'rc.1', '--skip-store'], host.deps())).toBe(0);
    expect(remoteCommand(host.callsFor('docker-build')[0])).toContain(
      '--build-arg APP_VERSION=1.2.3-rc.1 ',
    );
    expect(remoteCommand(host.callsFor('docker-build')[0])).toContain(
      "-t '127.0.0.1:4930/joinr-finance:1.2.3-rc.1'",
    );
    expect(store.read()).toEqual(before);
    expect(host.callsFor('store-diff')).toHaveLength(0);
  });

  it.each(["rc'1", 'rc 1', 'rc;1', 'rc$(id)'])('refuses the prerelease id %j', async (id) => {
    const host = setup();
    await expect(main(['--prerelease', id, '--skip-store'], host.deps())).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(host.calls).toHaveLength(0);
  });
});

describe('release: old build contexts', () => {
  it('removes only validated context names beyond the newest 3', async () => {
    const listing = [
      '1.2.3-bbbbbbbbbbbb',
      '1.2.2-aaaaaaaaaaaa',
      '..',
      '*',
      'smoke',
      'with space-aaaaaaaaaaaa',
      "quote'-aaaaaaaaaaaa",
      '1.2.1-rc.1-cccccccccccc',
      '1.2.0-dddddddddddd',
      '1.1.0-eeeeeeeeeeee',
    ].join('\n');
    const host = setup({ 'list-contexts': { stdout: listing } });
    await main([], host.deps());
    const removed = host.callsFor('remove-context').map(remoteCommand);
    expect(removed).toEqual([
      `rm -rf -- '${HOME}/joinr-build/1.2.0-dddddddddddd'`,
      `rm -rf -- '${HOME}/joinr-build/1.1.0-eeeeeeeeeeee'`,
    ]);
    for (const bad of ['..', '*', 'smoke', 'with space', "quote'"]) {
      expect(removed.join('\n')).not.toContain(`/${bad}`);
    }
    expect(CONTEXT_NAME_RE.test('1.2.1-rc.1-cccccccccccc')).toBe(true);
  });
});

describe('release: the store write', () => {
  it('refuses when the pinned manifest is not in the registry (exit 2, nothing written)', async () => {
    const host = setup({
      'manifest-head': (s) => ({
        stdout: remoteCommand(s).includes('/manifests/sha256:') ? '404' : '404',
      }),
    });
    const before = store.read();
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
    expect(store.read()).toEqual(before);
  });

  it('refuses when another app manifest claims 4932 or 4930 (exit 2, nothing written)', async () => {
    const host = setup({
      'manifest-ports': {
        stdout: [
          `${HOME}/umbrel/app-stores/some-store/tenon-joinr-finance/umbrel-app.yml:port: 4932`,
          `${HOME}/umbrel/app-stores/some-store/tenon-joinr-registry/umbrel-app.yml:port: 4930`,
          `${HOME}/umbrel/app-stores/other-store/other-app/umbrel-app.yml:port: 4932`,
        ].join('\n'),
      },
    });
    const before = store.read();
    await expect(main([], host.deps())).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('other-app'),
    });
    expect(store.read()).toEqual(before);
  });

  it("accepts the app's own manifests and its own listeners", async () => {
    const host = setup({
      'manifest-ports': {
        stdout: `${HOME}/umbrel/app-stores/s/tenon-joinr-finance/umbrel-app.yml:port: 4932\n`,
      },
      listeners: {
        stdout: 'LISTEN 0 4096 127.0.0.1:4930 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:4932 0.0.0.0:*\n',
      },
      'container-state': (s) => ({
        stdout:
          remoteCommand(s).includes('tenon-joinr-registry_registry_1') ||
          remoteCommand(s).includes('_app_proxy_1')
            ? 'running'
            : 'exited',
      }),
    });
    expect(await main([], host.deps())).toBe(0);
  });

  it('refuses a listener on 4932 that is not the app proxy, and 4930 on a non-loopback address', async () => {
    const host = setup({
      listeners: {
        stdout: 'LISTEN 0 4096 0.0.0.0:4932 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:4930 0.0.0.0:*\n',
      },
    });
    await expect(main([], host.deps())).rejects.toMatchObject({ exitCode: 2 });
  });

  it('refuses a new image without a version bump (exit 4)', async () => {
    const released = `sha256:${'1'.repeat(64)}`;
    const host = setup(
      {},
      {},
      {
        compose: `  app:\n    image: 127.0.0.1:4930/joinr-finance:1.2.3@${released}\n`,
        manifest: "version: '1.2.3'\n",
      },
    );
    await expect(main(['--reuse-existing'], host.deps({}))).rejects.toMatchObject({ exitCode: 4 });
  });

  it('says "Nothing to change" when the store already pins the same version and digest', async () => {
    const host = setup(
      { 'manifest-head': { stdout: '200' }, 'image-revision': { stdout: TREE } },
      {},
      {
        compose: `  app:\n    image: 127.0.0.1:4930/joinr-finance:1.2.3@${DIGEST}\n`,
        manifest: "version: '1.2.3'\n",
      },
    );
    expect(await main(['--reuse-existing'], host.deps())).toBe(0);
    expect(host.out.join('\n')).toContain('Nothing to change');
  });
});

describe('planStoreEdit', () => {
  const app = (compose, manifest) => ({
    compose,
    manifest,
    image: { digest: /@(sha256:[0-9a-f]{64})/.exec(compose)?.[1] },
    version: /'([^']*)'/.exec(manifest)?.[1],
  });
  const line = (d) => `    image: 127.0.0.1:4930/joinr-finance:1.0.0@${d}`;

  it('replaces exactly one image line and one version line, keeping the rest', () => {
    const compose = `a:\n\n${line(PLACEHOLDER_DIGEST)}\n    restart: on-failure\n`;
    const plan = planStoreEdit(app(compose, "# c\nversion: '1.0.0'\nx: 1\n"), {
      version: '1.0.1',
      digest: DIGEST,
      registryPort: 4930,
    });
    expect(plan.compose).toBe(
      `a:\n\n    image: 127.0.0.1:4930/joinr-finance:1.0.1@${DIGEST}\n    restart: on-failure\n`,
    );
    expect(plan.manifest).toBe("# c\nversion: '1.0.1'\nx: 1\n");
  });

  it('zero or two image lines → exit 2', () => {
    const opts = { version: '1.0.1', digest: DIGEST, registryPort: 4930 };
    expect(() => planStoreEdit(app('image: other:1\n', "version: '1.0.0'\n"), opts)).toThrow(
      expect.objectContaining({ exitCode: 2 }),
    );
    expect(() =>
      planStoreEdit(
        app(`${line(PLACEHOLDER_DIGEST)}\n${line(PLACEHOLDER_DIGEST)}\n`, "version: '1.0.0'\n"),
        opts,
      ),
    ).toThrow(expect.objectContaining({ exitCode: 2 }));
    expect(() =>
      planStoreEdit(
        app(`${line(PLACEHOLDER_DIGEST)}\n`, "version: '1.0.0'\nversion: '1.0.0'\n"),
        opts,
      ),
    ).toThrow(expect.objectContaining({ exitCode: 2 }));
  });

  it('the placeholder digest lets the first release keep the manifest version', () => {
    const plan = planStoreEdit(app(`${line(PLACEHOLDER_DIGEST)}\n`, "version: '1.0.0'\n"), {
      version: '1.0.0',
      digest: DIGEST,
      registryPort: 4930,
    });
    expect(plan.action).toBe('write');
  });
});

describe('parsers', () => {
  it('RepoDigests: picks the loopback registry entry', () => {
    const json = JSON.stringify([
      `docker.io/x@sha256:${'2'.repeat(64)}`,
      `127.0.0.1:4930/joinr-finance@${DIGEST}`,
    ]);
    expect(parseRepoDigests(json, 4930)).toBe(DIGEST);
    expect(() => parseRepoDigests('[]', 4930)).toThrow(/no digest/);
    expect(() => parseRepoDigests('nope', 4930)).toThrow(/parse/);
  });

  it('the Docker-Content-Digest header, any case', () => {
    expect(parseDigestHeader(`HTTP/1.1 200 OK\r\ndocker-content-digest: ${DIGEST}\r\n`)).toBe(
      DIGEST,
    );
    expect(parseDigestHeader('HTTP/1.1 404 Not Found\r\n')).toBeUndefined();
  });

  it('MemAvailable', () => {
    expect(parseMemAvailable('MemTotal: 1 kB\nMemAvailable:    4374668 kB\n')).toBe(4374668);
    expect(parseMemAvailable('MemTotal: 1 kB\n')).toBeUndefined();
  });
});

describe('release --dry-run', () => {
  it('runs local reads only and prints every remote step; writes nothing', async () => {
    const host = setup();
    const before = store.read();
    const logged = [];
    expect(
      await main(['--dry-run'], host.deps({ appendReleaseLog: (_r, l) => logged.push(l) })),
    ).toBe(0);
    // Only the local git reads reached the (fake) runner.
    expect(host.calls.every((c) => !c.remote && c.readOnly)).toBe(true);
    expect(host.purposes()).toEqual([
      'git-status',
      'git-head',
      'git-tree',
      'store-diff',
      'store-status',
    ]);
    const printed = host.out.filter((l) => l.startsWith('[dry-run] ')).join('\n');
    for (const needle of [
      'tools/privacy-guard/src/cli.ts --all',
      `${SSH} -o BatchMode=yes -o ConnectTimeout=10`,
      `git archive --format=tar ${TREE} |`,
      'docker build --provenance=false',
      'docker push',
      '/v2/joinr-finance/manifests/sha256:',
      "grep -H '^port:'",
      'ss -ltnH',
      'would write',
    ]) {
      expect(printed).toContain(needle);
    }
    expect(printed).not.toMatch(/~|pnpm /);
    expect(store.read()).toEqual(before);
    expect(logged).toEqual([]);
  });

  it('remote commands never carry unvalidated text', async () => {
    const host = setup();
    await main([], host.deps());
    for (const cmd of remoteCommands(host.calls)) expect(cmd).not.toMatch(/\n|\$\(|`/);
  });
});
