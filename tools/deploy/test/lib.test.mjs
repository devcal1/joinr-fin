import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_DOWNLOAD_PREFIX as SCHEMA_PREFIX,
  BACKUP_FILE_NAME_MAX as SCHEMA_MAX,
  BACKUP_FILE_NAME_RE as SCHEMA_RE,
} from '../../../packages/schema/src/backups.ts';
import {
  BACKUP_DOWNLOAD_PREFIX,
  BACKUP_FILE_NAME_MAX,
  BACKUP_FILE_NAME_RE,
  DeployError,
  REPO_ROOT,
  createDryRunRunner,
  createFakeRunner,
  createRealRunner,
  loadDeployConfig,
  parseFlags,
  parseListeners,
  remotePath,
  renderSpec,
  resolveBinary,
  shq,
  sshArgs,
  tsxCliPath,
  utcStamp,
  validate,
  validateBackupName,
} from '../lib.mjs';

describe('configuration', () => {
  it('defaults to the generic alias and the plan values', () => {
    const c = loadDeployConfig({}, '/repo');
    expect(c).toMatchObject({
      host: 'umbrel',
      registryPort: 4930,
      registryMode: 'app',
      appId: 'tenon-joinr-finance',
      remoteBuildRoot: 'joinr-build',
      registryData: 'joinr-registry',
    });
    expect(c.storeDir.replace(/\\/g, '/')).toMatch(/\/tenon-umbrel-store$/);
  });

  it('reads the overrides', () => {
    const c = loadDeployConfig(
      {
        JOINR_DEPLOY_HOST: 'nas-box',
        JOINR_REGISTRY_PORT: '5001',
        JOINR_REGISTRY_MODE: 'container',
        JOINR_APP_ID: 'x-app',
      },
      '/repo',
    );
    expect(c).toMatchObject({
      host: 'nas-box',
      registryPort: 5001,
      registryMode: 'container',
      appId: 'x-app',
    });
  });

  it.each([
    ['JOINR_DEPLOY_HOST', 'umbrel; rm -rf /'],
    ['JOINR_DEPLOY_HOST', '-oProxyCommand=x'],
    ['JOINR_REGISTRY_PORT', '49 30'],
    ['JOINR_REGISTRY_PORT', '70000'],
    ['JOINR_REGISTRY_MODE', 'both'],
    ['JOINR_APP_ID', 'App$(id)'],
    ['JOINR_REMOTE_BUILD_ROOT', '../outside'],
    ['JOINR_REMOTE_BUILD_ROOT', '/abs'],
    ['JOINR_REGISTRY_DATA', 'a b'],
  ])('refuses %s=%j', (name, value) => {
    expect(() => loadDeployConfig({ [name]: value }, '/repo')).toThrow(DeployError);
  });
});

describe('validation and quoting', () => {
  const hostile = [
    "1.0.0'",
    '1.0.0 x',
    '1.0.0;id',
    '1.0.0$(id)',
    '1.0.0\nid',
    '1.0.0`id`',
    '../1.0.0',
  ];
  it.each(hostile)('refuses the version %j before any command', (v) => {
    expect(() => validate('version', v)).toThrow(/Invalid version/);
  });

  it('accepts versions and prereleases', () => {
    for (const v of ['1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-beta2'])
      expect(validate('version', v)).toBe(v);
  });

  it.each(['/srv/x/../y', '/a/./b', 'relative', '/a b', "/a'b", '/a;b', '/a$b'])(
    'refuses the home %j',
    (h) => {
      expect(() => validate('home', h)).toThrow(DeployError);
    },
  );

  it('builds absolute remote paths with no ~', () => {
    expect(remotePath('/remote/home', 'joinr-build', '1.0.0-abcdef012345')).toBe(
      '/remote/home/joinr-build/1.0.0-abcdef012345',
    );
    expect(() => remotePath('/remote/home', '../etc')).toThrow(DeployError);
    expect(() => remotePath('/remote/home', '~')).toThrow(DeployError);
  });

  it('shq quotes for a POSIX shell', () => {
    expect(shq('plain')).toBe("'plain'");
    expect(shq("it's")).toBe("'it'\\''s'");
    expect(shq('$(id) `x` "y" ; z\nw')).toBe('\'$(id) `x` "y" ; z\nw\'');
  });

  it('ssh args always carry BatchMode and ServerAliveInterval, and the command after --', () => {
    expect(sshArgs('umbrel', 'true')).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ServerAliveInterval=30',
      'umbrel',
      '--',
      'true',
    ]);
  });
});

describe('backup names (shared rule)', () => {
  it('equals the schema constant', () => {
    expect(BACKUP_FILE_NAME_RE.source).toBe(SCHEMA_RE.source);
    expect(BACKUP_FILE_NAME_RE.flags).toBe(SCHEMA_RE.flags);
    expect(BACKUP_DOWNLOAD_PREFIX).toBe(SCHEMA_PREFIX);
    expect(BACKUP_FILE_NAME_MAX).toBe(SCHEMA_MAX);
  });

  it('strips the download prefix and validates', () => {
    expect(validateBackupName('joinr-finance-nightly-20300315-023000+1100.db')).toBe(
      'nightly-20300315-023000+1100.db',
    );
    expect(validateBackupName('pre-import-20300110-093000.db')).toBe(
      'pre-import-20300110-093000.db',
    );
  });

  it.each([
    '../x.db',
    'finance.db',
    'nightly-20300315-023000.db',
    '/data/backups/manual-20300315-023000+1100.db',
    "manual-20300315-023000+1100.db'",
    'manual-20300315-023000+1100.db;id',
    `${'x'.repeat(70)}.db`,
  ])('refuses %j (exit 2)', (n) => {
    expect(() => validateBackupName(n)).toThrow(expect.objectContaining({ exitCode: 2 }));
  });
});

describe('binaries', () => {
  const files = new Set([
    join('C:\\Windows\\System32\\OpenSSH', 'ssh.exe'),
    join('C:\\tools', 'git.cmd'),
    join('/usr/bin', 'ssh'),
  ]);
  const exists = (p) => files.has(p);

  it('finds the first on PATH with PATHEXT on Windows', () => {
    const env = {
      PATH: 'C:\\nothing;C:\\Windows\\System32\\OpenSSH',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    };
    expect(resolveBinary('ssh', undefined, env, exists, 'win32')).toBe(
      join('C:\\Windows\\System32\\OpenSSH', 'ssh.exe'),
    );
  });

  it('never picks a .cmd shim from PATH, and refuses one as an override', () => {
    const env = { PATH: 'C:\\tools', PATHEXT: '.CMD;.EXE' };
    expect(() => resolveBinary('git', undefined, env, exists, 'win32')).toThrow(
      /not found on PATH/,
    );
    expect(() => resolveBinary('git', join('C:\\tools', 'git.cmd'), env, exists, 'win32')).toThrow(
      /\.cmd\/\.bat shim/,
    );
  });

  it('uses the override', () => {
    expect(resolveBinary('ssh', join('/usr/bin', 'ssh'), {}, exists, 'linux')).toBe(
      join('/usr/bin', 'ssh'),
    );
    expect(() => resolveBinary('ssh', '/missing/ssh', {}, exists, 'linux')).toThrow(/not found/);
  });
});

describe('runners', () => {
  it('the fake runner records and answers', async () => {
    const r = createFakeRunner((s) => (s.purpose === 'x' ? { stdout: 'hi' } : undefined));
    expect(await r.exec({ purpose: 'x', cmd: 'a', args: [] })).toEqual({
      code: 0,
      stdout: 'hi',
      stderr: '',
    });
    expect(r.calls).toHaveLength(1);
  });

  it('the dry-run runner prints remote and write steps and runs only local reads', async () => {
    const inner = createFakeRunner(() => ({ stdout: 'real' }));
    const out = [];
    const dry = createDryRunRunner(inner, (l) => out.push(l));
    await dry.exec({ purpose: 'read', cmd: 'git', args: ['status'], readOnly: true });
    await dry.exec({
      purpose: 'r',
      cmd: 'ssh',
      args: ['-o', 'BatchMode=yes', 'umbrel', '--', "docker ps -f 'x'"],
      remote: true,
      readOnly: true,
    });
    await dry.exec({ purpose: 'guard', cmd: 'node', args: ['guard'] });
    expect(inner.calls.map((c) => c.purpose)).toEqual(['read']);
    expect(out).toEqual([
      "[dry-run] ssh -o BatchMode=yes umbrel -- docker ps -f 'x'",
      '[dry-run] node guard',
    ]);
  });

  it('renders pipes and uploads', () => {
    expect(
      renderSpec({
        cmd: 'ssh',
        args: ['umbrel', '--', 'tar -x'],
        remote: true,
        pipeFrom: { cmd: 'git', args: ['archive', '--format=tar', 'abc'] },
      }),
    ).toBe('git archive --format=tar abc | ssh umbrel -- tar -x');
    expect(
      renderSpec({
        cmd: 'ssh',
        args: ['umbrel', '--', 'cat > x'],
        remote: true,
        inputFile: 'backups\\b.db',
      }),
    ).toBe('ssh umbrel -- cat > x < backups\\b.db');
  });

  // The real runner (Windows spawn semantics in `pnpm test`): no shell, no .cmd shims.
  it('the real runner spawns node --version', async () => {
    const r = await createRealRunner().exec({ cmd: process.execPath, args: ['--version'] });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^v24\./);
  });

  it("the real runner runs the privacy guard's --help as node + tsx (never pnpm)", async () => {
    const r = await createRealRunner().exec({
      cmd: process.execPath,
      args: [tsxCliPath(), 'tools/privacy-guard/src/cli.ts', '--help'],
      cwd: REPO_ROOT,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: privacy-guard');
  }, 30_000);

  it('the real runner pipes one process into another and feeds input', async () => {
    const upper = [
      '-e',
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.toUpperCase()))",
    ];
    const piped = await createRealRunner().exec({
      cmd: process.execPath,
      args: upper,
      pipeFrom: { cmd: process.execPath, args: ['-e', "process.stdout.write('shipped')"] },
    });
    expect(piped).toMatchObject({ code: 0, stdout: 'SHIPPED' });
    const fed = await createRealRunner().exec({ cmd: process.execPath, args: upper, input: 'fed' });
    expect(fed.stdout).toBe('FED');
  });
});

describe('misc', () => {
  it('parses ss -ltnH', () => {
    const text = [
      'LISTEN 0 4096 127.0.0.1:4930 0.0.0.0:*',
      'LISTEN 0 4096 0.0.0.0:4931 0.0.0.0:*',
      'LISTEN 0 4096 [::]:4931 [::]:*',
      '',
    ].join('\n');
    expect(parseListeners(text)).toEqual([
      { address: '127.0.0.1', port: 4930 },
      { address: '0.0.0.0', port: 4931 },
      { address: '::', port: 4931 },
    ]);
  });

  it('utc stamps', () => {
    expect(utcStamp(new Date(Date.UTC(2030, 2, 15, 2, 30, 5, 123)))).toBe('20300315T023005Z');
  });

  it('parses flags', () => {
    expect(
      parseFlags(['--stop', '--image=x', 'name', '--container', 'c'], {
        stop: 'boolean',
        image: 'string',
        container: 'string',
      }),
    ).toEqual({
      flags: { stop: true, image: 'x', container: 'c' },
      positional: ['name'],
    });
    expect(() => parseFlags(['--nope'], {})).toThrow(/Unknown option/);
    expect(() => parseFlags(['--image'], { image: 'string' })).toThrow(/needs a value/);
  });
});
