// `pnpm android:(test | debug | release | lint | stop)` (stage-9.md §1.4, §7.5): the Android app's
// Gradle build, run from the repo root on the dev PC.
//
//   test     gradlew testDebugUnitTest   (the JVM tests: Robolectric, Compose and Glance renders)
//   debug    gradlew assembleDebug
//   release  gradlew assembleRelease, then the APK copied to dist/android/joinr-finance-<version>.apk
//            with its SHA-256 and the signing certificate's SHA-256 printed, then gradlew --stop
//   lint     gradlew lint
//   stop     gradlew --stop              (the Gradle daemons; Windows keeps lint caches locked)
//
// Gradle runs in apps/android with --console=plain and this terminal's stdio; the exit code is
// Gradle's. apps/android/local.properties (sdk.dir, forward slashes) is written when missing, from
// ANDROID_HOME, ANDROID_SDK_ROOT or %LOCALAPPDATA%/Android/Sdk.
//
// SIGNING: `release` refuses unless JOINR_ANDROID_SIGNING names an existing absolute file (the
// signing properties file, kept outside the repo). This script never reads, prints or copies that
// file or its path; Gradle reads it (apps/android/app/build.gradle.kts).
//
// Exit codes: 0 done · Gradle's own code when it fails · 1 a release check failed · 2 usage or a
// refusal (no SDK, no project, no signing file).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DeployError, REPO_ROOT, isEntry, runMain } from './lib.mjs';

const USAGE = 'Usage: node tools/deploy/android.mjs (test | debug | release | lint | stop)';

/** The Gradle task (or flag) of each subcommand. */
export const ANDROID_TASKS = Object.freeze({
  test: ['testDebugUnitTest'],
  debug: ['assembleDebug'],
  release: ['assembleRelease'],
  lint: ['lint'],
  stop: ['--stop'],
});

/** The environment variable naming the signing properties file (an absolute path). */
export const SIGNING_ENV = 'JOINR_ANDROID_SIGNING';
/** Where `release` copies the APK, relative to the repo root. */
export const DIST_DIR = 'dist/android';
/** Where the Android project lives, relative to the repo root. */
export const ANDROID_DIR = 'apps/android';
/** AGP's release output folder, relative to the Android project. */
export const RELEASE_OUTPUT_DIR = 'app/build/outputs/apk/release';

const VERSION_NAME_RE = /^\d+\.\d+\.\d+$/;

/** The Gradle arguments for a subcommand (throws a usage error for anything else). */
export function gradleArgs(command) {
  const task = Object.hasOwn(ANDROID_TASKS, command) ? ANDROID_TASKS[command] : undefined;
  if (!task) throw new DeployError(USAGE, 2);
  return command === 'stop' ? [...task] : [...task, '--console=plain'];
}

/** Double-quotes one cmd.exe argument when it needs it (spaces or shell characters). */
export function winQuote(arg) {
  const s = String(arg);
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

/**
 * How to start the Gradle wrapper on this platform: `gradlew.bat` through the shell on Windows
 * (Node 24 refuses to spawn a .bat without one), `./gradlew` directly elsewhere.
 */
export function gradleInvocation(platform, androidDir, args) {
  if (platform === 'win32') {
    const bat = join(androidDir, 'gradlew.bat');
    return {
      cmd: [bat, ...args].map(winQuote).join(' '),
      args: [],
      options: { cwd: androidDir, shell: true, stdio: 'inherit', windowsHide: true },
    };
  }
  return {
    cmd: join(androidDir, 'gradlew'),
    args,
    options: { cwd: androidDir, shell: false, stdio: 'inherit' },
  };
}

/** The Android SDK folder: ANDROID_HOME, ANDROID_SDK_ROOT, then %LOCALAPPDATA%/Android/Sdk. */
export function findSdkDir(env, exists) {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return undefined;
}

/** The text of local.properties for an SDK folder (forward slashes; Gradle reads either). */
export function localPropertiesText(sdkDir) {
  const dir = sdkDir.replace(/\\/g, '/');
  if (/[\r\n]/.test(dir)) throw new DeployError('The Android SDK path has a line break in it', 2);
  return `# Written by tools/deploy/android.mjs (git-ignored): this PC's Android SDK.\nsdk.dir=${dir}\n`;
}

/**
 * Writes apps/android/local.properties when it is missing. Returns 'kept' or 'written'; refuses
 * with a sentence when no SDK can be found.
 */
export function ensureLocalProperties({ androidDir, env, exists, writeFile }) {
  const file = join(androidDir, 'local.properties');
  if (exists(file)) return 'kept';
  const sdk = findSdkDir(env, exists);
  if (!sdk) {
    throw new DeployError(
      'No Android SDK found: set ANDROID_HOME (or ANDROID_SDK_ROOT) to the SDK folder, or install it in %LOCALAPPDATA%/Android/Sdk.',
      2,
    );
  }
  writeFile(file, localPropertiesText(sdk));
  return 'written';
}

/** `release` refuses unless JOINR_ANDROID_SIGNING names an existing absolute file. Never reads it. */
export function checkSigningFile(env, isFile) {
  const value = env[SIGNING_ENV];
  if (value === undefined || value.trim() === '') {
    throw new DeployError(
      `A release build needs ${SIGNING_ENV}: the absolute path of the signing properties file, kept outside the repo (docs/deploy/RUNBOOK.md, "The signing keystore"). Nothing was built.`,
      2,
    );
  }
  if (!isAbsolute(value) || !isFile(value)) {
    throw new DeployError(
      `${SIGNING_ENV} must name an existing file by its absolute path. Nothing was built.`,
      2,
    );
  }
}

/** The release APK and its versionName, from AGP's output-metadata.json. */
export function readReleaseOutput(outputDir, readFile) {
  let meta;
  try {
    meta = JSON.parse(readFile(join(outputDir, 'output-metadata.json')));
  } catch {
    throw new DeployError(
      `No readable output-metadata.json in ${ANDROID_DIR}/${RELEASE_OUTPUT_DIR}`,
      1,
    );
  }
  const el = Array.isArray(meta?.elements) ? meta.elements[0] : undefined;
  const file = el?.outputFile;
  const versionName = el?.versionName;
  if (typeof file !== 'string' || !/^[A-Za-z0-9._-]+\.apk$/.test(file)) {
    throw new DeployError('The release output names no APK', 1);
  }
  if (typeof versionName !== 'string' || !VERSION_NAME_RE.test(versionName)) {
    throw new DeployError('The release output has no versionName like 1.0.0', 1);
  }
  return { apk: join(outputDir, file), versionName };
}

/** Compares dotted version folder names numerically (35.0.0 > 34.0.0 > 9.0.0). */
function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** apksigner from the newest build-tools folder that has one. */
export function findApksigner(sdkDir, platform, { readdir, exists }) {
  const tools = join(sdkDir, 'build-tools');
  let versions;
  try {
    versions = readdir(tools);
  } catch {
    versions = [];
  }
  const name = platform === 'win32' ? 'apksigner.bat' : 'apksigner';
  for (const v of [...versions].sort(compareVersions).reverse()) {
    const p = join(tools, v, name);
    if (exists(p)) return p;
  }
  throw new DeployError('No apksigner found under the SDK build-tools folder', 1);
}

/** The first signer's certificate SHA-256 from `apksigner verify --print-certs`. */
export function parseCertDigest(stdout) {
  const m = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(stdout);
  return m ? m[1].toLowerCase() : undefined;
}

/** sdk.dir from local.properties, if set. */
export function sdkFromLocalProperties(text) {
  const m = /^sdk\.dir\s*[=:]\s*(.+)$/m.exec(text);
  return m ? m[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\') : undefined;
}

function defaultRun(cmd, args, options) {
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawn(cmd, args, options);
    } catch (err) {
      reject(err);
      return;
    }
    const out = [];
    child.stdout?.on('data', (c) => out.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      resolvePromise({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8') }),
    );
  });
}

const isFileDefault = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `deps` (tests) replace the spawn, file system, environment, platform and output. */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((l) => process.stdout.write(`${l}\n`));
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const exists = deps.exists ?? existsSync;
  const isFile = deps.isFile ?? isFileDefault;
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile ?? ((p, t) => writeFileSync(p, t, 'utf8'));
  const readdir = deps.readdir ?? ((p) => readdirSync(p));
  const run = deps.run ?? defaultRun;
  const hashFile =
    deps.hashFile ?? ((p) => createHash('sha256').update(readFileSync(p)).digest('hex'));
  const copyFile = deps.copyFile ?? ((a, b) => copyFileSync(a, b));
  const mkdir = deps.mkdir ?? ((p) => mkdirSync(p, { recursive: true }));

  if (argv.length !== 1) throw new DeployError(USAGE, 2);
  const command = argv[0];
  if (command === '--help' || command === '-h') {
    out(USAGE);
    return 0;
  }
  const args = gradleArgs(command);
  const androidDir = join(repoRoot, ANDROID_DIR);
  const wrapper = join(androidDir, platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!exists(wrapper)) {
    throw new DeployError(
      `The Android project has no Gradle wrapper yet (${ANDROID_DIR}/${platform === 'win32' ? 'gradlew.bat' : 'gradlew'}).`,
      2,
    );
  }
  if (command === 'release') checkSigningFile(env, isFile);
  if (command !== 'stop') {
    if (ensureLocalProperties({ androidDir, env, exists, writeFile }) === 'written') {
      out(`Wrote ${ANDROID_DIR}/local.properties (sdk.dir; git-ignored).`);
    }
  }

  const gradle = async (gargs) => {
    const inv = gradleInvocation(platform, androidDir, gargs);
    const r = await run(inv.cmd, inv.args, { ...inv.options, env });
    return r.code;
  };

  if (command !== 'release') return gradle(args);

  try {
    const code = await gradle(args);
    if (code !== 0) return code;
    const { apk, versionName } = readReleaseOutput(join(androidDir, RELEASE_OUTPUT_DIR), readFile);
    const distDir = join(repoRoot, DIST_DIR);
    mkdir(distDir);
    const name = `joinr-finance-${versionName}.apk`;
    copyFile(apk, join(distDir, name));
    out(`APK: ${DIST_DIR}/${name}`);
    out(`SHA-256 (APK): ${hashFile(join(distDir, name))}`);

    const props = join(androidDir, 'local.properties');
    const sdk =
      (exists(props) ? sdkFromLocalProperties(readFile(props)) : undefined) ??
      findSdkDir(env, exists);
    if (!sdk) throw new DeployError('No Android SDK found to verify the signature', 1);
    const signer = findApksigner(sdk, platform, { readdir, exists });
    const verifyArgs = ['verify', '--print-certs', join(distDir, name)];
    const v =
      platform === 'win32'
        ? await run([signer, ...verifyArgs].map(winQuote).join(' '), [], {
            shell: true,
            stdio: ['ignore', 'pipe', 'inherit'],
            windowsHide: true,
            env,
          })
        : await run(signer, verifyArgs, { stdio: ['ignore', 'pipe', 'inherit'], env });
    const cert = v.code === 0 ? parseCertDigest(v.stdout) : undefined;
    if (!cert) throw new DeployError('apksigner could not verify the signature of the APK', 1);
    out(`SHA-256 (signing certificate): ${cert}`);
    return 0;
  } finally {
    // The spike's Windows lesson: release lint leaves daemons holding cache locks.
    try {
      await gradle(gradleArgs('stop'));
    } catch {
      out('Could not stop the Gradle daemons: run pnpm android:stop.');
    }
  }
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
