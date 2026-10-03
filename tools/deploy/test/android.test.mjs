// tools/deploy/android.mjs (stage-9.md §7.5): the argument builder, the platform branch, the
// local.properties writer and the refusals. No Gradle, apksigner or real SDK is ever run.
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_DIR,
  RELEASE_OUTPUT_DIR,
  SIGNING_ENV,
  checkSigningFile,
  ensureLocalProperties,
  findApksigner,
  findSdkDir,
  gradleArgs,
  gradleInvocation,
  localPropertiesText,
  main,
  parseCertDigest,
  readReleaseOutput,
  sdkFromLocalProperties,
  winQuote,
} from '../android.mjs';
import { DeployError } from '../lib.mjs';

const ROOT = join('/', 'repo');
const ANDROID = join(ROOT, ANDROID_DIR);
const SDK = join('/', 'sdk');
const SIGNING = join('/', 'outside', 'signing.properties');
const CERT = 'ab'.repeat(32);

/** A fake file system and spawner for `main`. Records every run; never spawns. */
function harness({
  platform = 'linux',
  files = {},
  env = {},
  gradleCode = 0,
  verify = { code: 0, stdout: `Signer #1 certificate SHA-256 digest: ${CERT}\n` },
} = {}) {
  const fs = new Map(Object.entries(files));
  const runs = [];
  const lines = [];
  const copies = [];
  const deps = {
    platform,
    repoRoot: ROOT,
    env,
    out: (l) => lines.push(l),
    exists: (p) => fs.has(p) || [...fs.keys()].some((k) => k.startsWith(`${p}${sep}`)),
    isFile: (p) => fs.has(p),
    readFile: (p) => {
      if (!fs.has(p)) throw new Error(`ENOENT ${p}`);
      return fs.get(p);
    },
    writeFile: (p, t) => fs.set(p, t),
    readdir: (p) => [
      ...new Set(
        [...fs.keys()]
          .filter((k) => k.startsWith(`${p}${sep}`))
          .map((k) => k.slice(p.length + 1).split(sep)[0]),
      ),
    ],
    mkdir: () => {},
    copyFile: (a, b) => {
      copies.push([a, b]);
      fs.set(b, fs.get(a) ?? 'apk');
    },
    hashFile: () => 'cd'.repeat(32),
    run: async (cmd, args, options) => {
      runs.push({ cmd, args, options });
      const text = [cmd, ...args].join(' ');
      if (text.includes('apksigner')) return verify;
      if (text.includes('--stop')) return { code: 0, stdout: '' };
      return { code: gradleCode, stdout: '' };
    },
  };
  return { deps, fs, runs, lines, copies };
}

const wrapper = (platform = 'linux') =>
  join(ANDROID, platform === 'win32' ? 'gradlew.bat' : 'gradlew');

describe('gradleArgs', () => {
  it('maps each subcommand to its task with a plain console', () => {
    expect(gradleArgs('test')).toEqual(['testDebugUnitTest', '--console=plain']);
    expect(gradleArgs('debug')).toEqual(['assembleDebug', '--console=plain']);
    expect(gradleArgs('release')).toEqual(['assembleRelease', '--console=plain']);
    expect(gradleArgs('lint')).toEqual(['lint', '--console=plain']);
    expect(gradleArgs('stop')).toEqual(['--stop']);
  });

  it('refuses anything else with the usage line (exit 2)', () => {
    for (const bad of ['build', 'clean', 'toString', '__proto__', '']) {
      expect(() => gradleArgs(bad)).toThrow(DeployError);
      try {
        gradleArgs(bad);
      } catch (e) {
        expect(e.exitCode).toBe(2);
        expect(e.message).toMatch(/^Usage:/);
      }
    }
  });
});

describe('gradleInvocation (the platform branch)', () => {
  it('Windows: gradlew.bat through the shell, the path quoted when it has spaces', () => {
    const dir = join('C:', 'My Repo', 'apps', 'android');
    const inv = gradleInvocation('win32', dir, ['assembleDebug', '--console=plain']);
    expect(inv.options.shell).toBe(true);
    expect(inv.options.cwd).toBe(dir);
    expect(inv.options.stdio).toBe('inherit');
    expect(inv.args).toEqual([]);
    expect(inv.cmd).toBe(`"${join(dir, 'gradlew.bat')}" assembleDebug --console=plain`);
  });

  it('elsewhere: ./gradlew spawned directly, no shell', () => {
    const inv = gradleInvocation('linux', ANDROID, ['lint', '--console=plain']);
    expect(inv.cmd).toBe(join(ANDROID, 'gradlew'));
    expect(inv.args).toEqual(['lint', '--console=plain']);
    expect(inv.options.shell).toBe(false);
    expect(inv.options.stdio).toBe('inherit');
  });

  it('winQuote leaves plain arguments and quotes the rest', () => {
    expect(winQuote('--console=plain')).toBe('--console=plain');
    expect(winQuote('a b')).toBe('"a b"');
    expect(winQuote('a"b')).toBe('"a""b"');
    expect(winQuote('x&y')).toBe('"x&y"');
  });
});

describe('local.properties', () => {
  it('finds the SDK in order: ANDROID_HOME, ANDROID_SDK_ROOT, %LOCALAPPDATA%/Android/Sdk', () => {
    const has =
      (...ps) =>
      (p) =>
        ps.includes(p);
    expect(findSdkDir({ ANDROID_HOME: '/a', ANDROID_SDK_ROOT: '/b' }, has('/a', '/b'))).toBe('/a');
    expect(findSdkDir({ ANDROID_HOME: '/a', ANDROID_SDK_ROOT: '/b' }, has('/b'))).toBe('/b');
    const local = join('/la', 'Android', 'Sdk');
    expect(findSdkDir({ LOCALAPPDATA: '/la' }, has(local))).toBe(local);
    expect(findSdkDir({}, has())).toBeUndefined();
  });

  it('writes sdk.dir with forward slashes', () => {
    expect(localPropertiesText('C:\\Users\\someone\\AppData\\Local\\Android\\Sdk')).toContain(
      'sdk.dir=C:/Users/someone/AppData/Local/Android/Sdk\n',
    );
    expect(() => localPropertiesText('/sdk\nevil=1')).toThrow(DeployError);
  });

  it('writes the file only when it is missing', () => {
    const written = [];
    const writeFile = (p, t) => written.push([p, t]);
    const file = join(ANDROID, 'local.properties');
    expect(
      ensureLocalProperties({
        androidDir: ANDROID,
        env: { ANDROID_HOME: SDK },
        exists: (p) => p === SDK,
        writeFile,
      }),
    ).toBe('written');
    expect(written).toEqual([[file, localPropertiesText(SDK)]]);
    expect(
      ensureLocalProperties({
        androidDir: ANDROID,
        env: {},
        exists: (p) => p === file,
        writeFile,
      }),
    ).toBe('kept');
    expect(written).toHaveLength(1);
  });

  it('refuses with a sentence when no SDK exists', () => {
    expect(() =>
      ensureLocalProperties({ androidDir: ANDROID, env: {}, exists: () => false, writeFile() {} }),
    ).toThrow(/No Android SDK found: set ANDROID_HOME/);
  });

  it('reads sdk.dir back, escaped or not', () => {
    expect(sdkFromLocalProperties('# c\nsdk.dir=C:/x/Sdk\n')).toBe('C:/x/Sdk');
    expect(sdkFromLocalProperties('sdk.dir=C\\:\\\\x\\\\Sdk\n')).toBe('C:\\x\\Sdk');
    expect(sdkFromLocalProperties('other=1\n')).toBeUndefined();
  });
});

describe('the signing refusal', () => {
  it('refuses when the variable is unset or blank', () => {
    for (const env of [{}, { [SIGNING_ENV]: '' }, { [SIGNING_ENV]: '  ' }]) {
      expect(() => checkSigningFile(env, () => true)).toThrow(/needs JOINR_ANDROID_SIGNING/);
    }
  });

  it('refuses a relative path or a missing file, never echoing the value', () => {
    for (const value of ['signing.properties', join('/', 'missing', 'x.properties')]) {
      try {
        checkSigningFile({ [SIGNING_ENV]: value }, (p) => p === SIGNING);
        expect.unreachable();
      } catch (e) {
        expect(e.exitCode).toBe(2);
        expect(e.message).not.toContain(value);
      }
    }
    expect(() => checkSigningFile({ [SIGNING_ENV]: SIGNING }, (p) => p === SIGNING)).not.toThrow();
  });
});

describe('release output and the certificate digest', () => {
  const dir = join(ANDROID, RELEASE_OUTPUT_DIR);
  const meta = (el) => ({
    [join(dir, 'output-metadata.json')]: JSON.stringify({ elements: [el] }),
  });

  it('reads the APK and versionName from output-metadata.json', () => {
    const files = meta({ outputFile: 'app-release.apk', versionName: '1.0.0' });
    expect(readReleaseOutput(dir, (p) => files[p])).toEqual({
      apk: join(dir, 'app-release.apk'),
      versionName: '1.0.0',
    });
  });

  it('refuses a missing or odd metadata file', () => {
    expect(() =>
      readReleaseOutput(dir, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(/output-metadata/);
    for (const el of [
      { outputFile: '../x.apk', versionName: '1.0.0' },
      { outputFile: 'a.apk', versionName: '1.0' },
      {},
    ]) {
      const files = meta(el);
      expect(() => readReleaseOutput(dir, (p) => files[p])).toThrow(DeployError);
    }
  });

  it('parses apksigner --print-certs', () => {
    const text = `Signer #1 certificate DN: CN=Test\nSigner #1 certificate SHA-256 digest: ${CERT.toUpperCase()}\nSigner #1 certificate SHA-1 digest: ${'1'.repeat(40)}\n`;
    expect(parseCertDigest(text)).toBe(CERT);
    expect(parseCertDigest('DOES NOT VERIFY')).toBeUndefined();
  });

  it('takes apksigner from the newest build-tools folder', () => {
    const files = new Set([
      join(SDK, 'build-tools', '9.0.0', 'apksigner.bat'),
      join(SDK, 'build-tools', '35.0.0', 'apksigner.bat'),
      join(SDK, 'build-tools', '34.0.0', 'apksigner.bat'),
      join(SDK, 'build-tools', '36.0.0-rc1', 'aapt'),
    ]);
    const readdir = () => ['9.0.0', '35.0.0', '34.0.0', '36.0.0-rc1'];
    expect(findApksigner(SDK, 'win32', { readdir, exists: (p) => files.has(p) })).toBe(
      join(SDK, 'build-tools', '35.0.0', 'apksigner.bat'),
    );
    expect(() => findApksigner(SDK, 'linux', { readdir: () => [], exists: () => false })).toThrow(
      /No apksigner/,
    );
  });
});

describe('main', () => {
  it('runs the task in apps/android, writes local.properties first, returns the Gradle exit code', async () => {
    const h = harness({ files: { [wrapper()]: '' }, env: { ANDROID_HOME: SDK }, gradleCode: 3 });
    h.fs.set(SDK, '');
    expect(await main(['test'], h.deps)).toBe(3);
    expect(h.fs.get(join(ANDROID, 'local.properties'))).toContain(
      `sdk.dir=${SDK.replace(/\\/g, '/')}\n`,
    );
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].cmd).toBe(wrapper());
    expect(h.runs[0].args).toEqual(['testDebugUnitTest', '--console=plain']);
    expect(h.runs[0].options.cwd).toBe(ANDROID);
  });

  it('refuses without the wrapper, with a bad subcommand, or with extra arguments', async () => {
    const h = harness();
    await expect(main(['debug'], h.deps)).rejects.toThrow(/no Gradle wrapper/);
    await expect(main(['build'], harness({ files: { [wrapper()]: '' } }).deps)).rejects.toThrow(
      /^Usage:/,
    );
    await expect(main(['test', 'x'], h.deps)).rejects.toThrow(/^Usage:/);
    expect(h.runs).toHaveLength(0);
  });

  it('release refuses before any Gradle run when the signing file is not named', async () => {
    const h = harness({
      files: { [wrapper()]: '', [join(ANDROID, 'local.properties')]: `sdk.dir=${SDK}\n` },
    });
    await expect(main(['release'], h.deps)).rejects.toThrow(/needs JOINR_ANDROID_SIGNING/);
    expect(h.runs).toHaveLength(0);
  });

  it('release: Gradle, the copy to dist/android, the two digests, then gradlew --stop', async () => {
    const out = join(ANDROID, RELEASE_OUTPUT_DIR);
    const h = harness({
      platform: 'win32',
      env: { [SIGNING_ENV]: SIGNING },
      files: {
        [wrapper('win32')]: '',
        [SIGNING]: 'never read',
        [join(ANDROID, 'local.properties')]: `sdk.dir=${SDK}\n`,
        [join(out, 'output-metadata.json')]: JSON.stringify({
          elements: [{ outputFile: 'app-release.apk', versionName: '1.0.0' }],
        }),
        [join(out, 'app-release.apk')]: 'apk',
        [join(SDK, 'build-tools', '35.0.0', 'apksigner.bat')]: '',
      },
    });
    const reads = [];
    const readFile = h.deps.readFile;
    h.deps.readFile = (p) => {
      reads.push(p);
      return readFile(p);
    };
    expect(await main(['release'], h.deps)).toBe(0);
    expect(reads).not.toContain(SIGNING);
    expect(h.copies).toEqual([
      [join(out, 'app-release.apk'), join(ROOT, 'dist', 'android', 'joinr-finance-1.0.0.apk')],
    ]);
    expect(h.lines).toContain('APK: dist/android/joinr-finance-1.0.0.apk');
    expect(h.lines).toContain(`SHA-256 (APK): ${'cd'.repeat(32)}`);
    expect(h.lines).toContain(`SHA-256 (signing certificate): ${CERT}`);
    expect(h.lines.join('\n')).not.toContain(SIGNING);
    expect(h.runs.map((r) => r.cmd)).toEqual([
      `${wrapper('win32')} assembleRelease --console=plain`,
      `${join(SDK, 'build-tools', '35.0.0', 'apksigner.bat')} verify --print-certs ${join(ROOT, 'dist', 'android', 'joinr-finance-1.0.0.apk')}`,
      `${wrapper('win32')} --stop`,
    ]);
    // The signing variable reaches Gradle through the environment, never as an argument.
    expect(h.runs[0].options.env[SIGNING_ENV]).toBe(SIGNING);
  });

  it('release: a failed build returns the Gradle exit code and still stops the daemons', async () => {
    const h = harness({
      env: { [SIGNING_ENV]: SIGNING },
      gradleCode: 1,
      files: {
        [wrapper()]: '',
        [SIGNING]: '',
        [join(ANDROID, 'local.properties')]: `sdk.dir=${SDK}\n`,
      },
    });
    expect(await main(['release'], h.deps)).toBe(1);
    expect(h.runs.map((r) => r.args)).toEqual([['assembleRelease', '--console=plain'], ['--stop']]);
    expect(h.copies).toHaveLength(0);
  });

  it('release: an APK apksigner cannot verify fails (exit 1) after stopping the daemons', async () => {
    const out = join(ANDROID, RELEASE_OUTPUT_DIR);
    const h = harness({
      env: { [SIGNING_ENV]: SIGNING },
      verify: { code: 1, stdout: 'DOES NOT VERIFY' },
      files: {
        [wrapper()]: '',
        [SIGNING]: '',
        [join(ANDROID, 'local.properties')]: `sdk.dir=${SDK}\n`,
        [join(out, 'output-metadata.json')]: JSON.stringify({
          elements: [{ outputFile: 'app-release.apk', versionName: '1.0.0' }],
        }),
        [join(out, 'app-release.apk')]: 'apk',
        [join(SDK, 'build-tools', '35.0.0', 'apksigner')]: '',
      },
    });
    await expect(main(['release'], h.deps)).rejects.toThrow(/could not verify/);
    expect(h.runs.at(-1).args).toEqual(['--stop']);
  });

  it('stop runs gradlew --stop without writing local.properties', async () => {
    const h = harness({ files: { [wrapper()]: '' } });
    expect(await main(['stop'], h.deps)).toBe(0);
    expect(h.runs[0].args).toEqual(['--stop']);
    expect(h.fs.has(join(ANDROID, 'local.properties'))).toBe(false);
  });
});
