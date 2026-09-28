// `pnpm umbrel:restore (<backup-name> | --from-file <local path>) [--stop] [--no-start]
//  [--container <name>] [--data-dir <path>] [--image <ref>] [--dry-run]` (stage-7.md §7.6).
//
// Restores a backup into the app's data folder on the Umbrel with the image's own restore CLI, in
// a one-off container (`--network none`, uid 1000) while the app is stopped.
//
// Nothing is ever read from the app container alone: Umbrel's Stop and Restart REMOVE it. The data
// path comes from the remote home and the app id; the image and TZ from the app-data compose file
// (read with `yq`, since umbreld rewrites that file with js-yaml); the image is resolved to its
// local image ID, so nothing is pulled.
//
// `--from-file` uploads a backup kept on this PC (the restore-after-a-reinstall path, D113).
// `--container`, `--data-dir` and `--image` exist for the live smoke run, whose container is not
// an installed app.
//
// Exit codes: the restore CLI's own (0 restored · 1 failed · 2 usage · 3 confirmation · 5 invalid
// backup · 6 the app looks running), plus 2 for this script's usage and host checks, 3 when the app
// is running and --stop was not given, and 1 when the app did not come back healthy.
import {
  DEFAULT_TZ,
  DeployError,
  checkSqliteFile,
  commonDryRunReply,
  containerState,
  createContext,
  isEntry,
  parseFlags,
  preflight,
  remote,
  remoteHome,
  remoteOk,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
  utcStamp,
  validate,
  validateBackupName,
  waitHealthy,
} from './lib.mjs';

const USAGE = `Usage: node tools/deploy/restore-remote.mjs (<backup-name> | --from-file <local path>)
         [--stop] [--no-start] [--container <name>] [--data-dir <path>] [--image <ref>] [--dry-run]
  <backup-name>       a file in the app's data/backups/ (a downloaded "joinr-finance-" name works too)
  --from-file <path>  upload a backup kept on this PC and restore it (after a reinstall)
  --stop              stop the app container first when it is running (and start it again after)
  --no-start          do not start the container again after --stop
  --container <name>  the container to check (default: <app id>_app_1)
  --data-dir <path>   the data folder on the host (absolute, or relative to the remote home)
  --image <ref>       the image to run the CLI from (default: read from the app-data compose)`;

/** The data folder on the host: `--data-dir` (validated) or `<home>/umbrel/app-data/<app id>/data`. */
export function resolveDataDir(home, appId, dataDir) {
  if (dataDir === undefined) return remotePath(home, 'umbrel', 'app-data', appId, 'data');
  if (/^[A-Za-z]:[\\/]/.test(dataDir)) {
    // Git Bash's MSYS path conversion turned an absolute remote path into a Windows one.
    throw new DeployError(
      `Invalid --data-dir: ${JSON.stringify(dataDir)} looks like a Windows path. Under Git Bash, pass the folder relative to the remote home, or prefix the command with MSYS_NO_PATHCONV=1.`,
      2,
    );
  }
  if (dataDir.startsWith('/')) return validate('home', dataDir.replace(/\/+$/, ''), '--data-dir');
  return remotePath(
    home,
    ...validate('relPath', dataDir.replace(/\/+$/, ''), '--data-dir').split('/'),
  );
}

/** A `yq` scalar: mikefarah's yq prints it raw, the Python wrapper as JSON; `null` = absent. */
export function parseYqScalar(text) {
  let v = text.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  return v === '' || v === 'null' ? undefined : v;
}

async function readImageAndTz(ctx, home, flags) {
  if (flags.image !== undefined) {
    return { image: validate('imageRef', flags.image, '--image'), tz: DEFAULT_TZ };
  }
  const compose = remotePath(home, 'umbrel', 'app-data', ctx.config.appId, 'docker-compose.yml');
  const img = await remoteOk(
    ctx,
    'yq-image',
    `yq '.services.app.image' ${shq(compose)}`,
    "Could not read the app's image from its compose file on the host (is the app installed?)",
    { exitCode: 2 },
  );
  const image = parseYqScalar(img.stdout);
  if (!image) throw new DeployError("The app's compose file names no image", 2);
  const tzR = await remote(ctx, 'yq-tz', `yq '.services.app.environment.TZ' ${shq(compose)}`);
  const tz = (tzR.code === 0 && parseYqScalar(tzR.stdout)) || DEFAULT_TZ;
  return {
    image: validate('imageRef', image, 'compose image'),
    tz: validate('tz', tz, 'compose TZ'),
  };
}

/**
 * The name the upload is stored under: the local file's backup name (a downloaded
 * `joinr-finance-` prefix stripped) when it is one, else a fixed generic name.
 */
export function uploadFileName(localPath) {
  const base = String(localPath).split(/[\\/]/).pop() ?? '';
  try {
    return validateBackupName(base);
  } catch {
    return 'restore-upload.db';
  }
}

/** After a failure past `docker stop`: start the container again (or say how), best effort. */
async function restartAfterFailure(ctx, container, noStart) {
  const how = `start it with \`docker start ${container}\` on the host`;
  if (noStart) {
    ctx.err(`${container} was stopped and is left stopped (--no-start): ${how}.`);
    return;
  }
  ctx.err(`The restore did not run; starting ${container} again…`);
  let started = false;
  try {
    started = (await remote(ctx, 'docker-start', `docker start ${shq(container)}`)).code === 0;
  } catch {
    // Reported below.
  }
  if (!started) ctx.err(`Could not start ${container}: ${how}.`);
}

function dryRunReply(spec) {
  switch (spec.purpose) {
    case 'yq-image':
      return { stdout: `127.0.0.1:4930/joinr-finance:1.0.0@sha256:${'d'.repeat(64)}\n` };
    case 'yq-tz':
      return { stdout: `${DEFAULT_TZ}\n` };
    case 'image-id':
      return { stdout: `sha256:${'e'.repeat(64)}\n` };
    case 'container-state':
      return { stdout: 'exited' };
    default:
      return commonDryRunReply(spec);
  }
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, {
    'from-file': 'string',
    stop: 'boolean',
    'no-start': 'boolean',
    container: 'string',
    'data-dir': 'string',
    image: 'string',
    'dry-run': 'boolean',
    help: 'boolean',
  });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  const fromFile = flags['from-file'];
  if ((fromFile === undefined) === (positional.length !== 1) || positional.length > 1) {
    throw new DeployError(USAGE, 2);
  }
  // Validate every argument before anything runs.
  const name = fromFile === undefined ? validateBackupName(positional[0]) : undefined;
  const upload = fromFile !== undefined ? (deps.checkFile ?? checkSqliteFile)(fromFile) : undefined;
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  const container = validate(
    'container',
    flags.container ?? `${ctx.config.appId}_app_1`,
    '--container',
  );
  if (flags['data-dir'] !== undefined)
    resolveDataDir('/validate', ctx.config.appId, flags['data-dir']);
  if (flags.image !== undefined) validate('imageRef', flags.image, '--image');

  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  const dataDir = resolveDataDir(home, ctx.config.appId, flags['data-dir']);
  const dataCheck = await remote(ctx, 'data-dir', `test -d ${shq(dataDir)}`);
  if (dataCheck.code !== 0) throw new DeployError('The data folder does not exist on the host', 2);

  const { image, tz } = await readImageAndTz(ctx, home, flags);
  const idR = await remote(ctx, 'image-id', `docker image inspect -f '{{.Id}}' ${shq(image)}`);
  if (idR.code !== 0)
    throw new DeployError("The app's image is not on the host (nothing is pulled)", 2);
  const imageId = validate('imageId', idR.stdout.trim(), 'image ID');
  ctx.out(`Image: ${image} (${imageId.slice(0, 19)}…), TZ ${tz}`);

  // --from-file: upload first, while the app still runs (a failed upload leaves it as it was),
  // into a hidden per-run folder, under the file's own backup name when it has one: the CLI then
  // records that name in `restore.last` (the About block) and reads the backup's time from it.
  let uploadDir;
  const removeUpload = async () => {
    if (uploadDir === undefined) return;
    const dir = uploadDir;
    uploadDir = undefined;
    await remote(ctx, 'upload-cleanup', `rm -rf -- ${shq(dir)}`);
  };

  let cliArg = name;
  let stoppedByUs = false;
  let code;
  try {
    if (upload) {
      const folder = `.restore-upload-${utcStamp(ctx.now())}`;
      const fileName = uploadFileName(upload.path);
      uploadDir = `${dataDir}/${folder}`;
      await remoteOk(
        ctx,
        'upload-dir',
        `mkdir -p -- ${shq(uploadDir)}`,
        'Could not create the upload folder',
      );
      ctx.out(`Uploading ${upload.path} (${upload.size} bytes)…`);
      await remoteOk(
        ctx,
        'upload',
        `cat > ${shq(`${uploadDir}/${fileName}`)}`,
        'The upload failed',
        {
          inputFile: upload.path,
        },
      );
      cliArg = `/data/${folder}/${fileName}`;
    }

    // The container's state: missing / exited / created = stopped; running / restarting = running.
    const state = await containerState(ctx, container);
    if (state === 'running' || state === 'restarting') {
      if (!flags.stop) {
        throw new DeployError(
          "Stop the app first (Umbrel → the app's menu → Stop), or pass --stop",
          3,
        );
      }
      ctx.out(`Stopping ${container} (it was ${state})…`);
      await remoteOk(
        ctx,
        'docker-stop',
        `docker stop -t 30 ${shq(container)}`,
        'Could not stop the container',
      );
      stoppedByUs = true;
    } else {
      ctx.out(`${container}: ${state === 'missing' ? 'no container (stopped in Umbrel)' : state}.`);
    }

    try {
      const r = await remote(
        ctx,
        'restore-run',
        [
          'docker run --rm --network none --user 1000:1000',
          `-e TZ=${shq(tz)}`,
          `-v ${shq(`${dataDir}:/data`)}`,
          imageId,
          'node dist/cli/restore.js',
          shq(cliArg),
          '--yes --force',
        ].join(' '),
        { stream: true },
      );
      code = r.code;
    } catch (err) {
      // The one-off run could not be started (the ssh link dropped): never leave the app stopped
      // by this script without starting it again, or saying how.
      await removeUpload();
      if (stoppedByUs) await restartAfterFailure(ctx, container, flags['no-start'] === true);
      throw err;
    }
  } finally {
    await removeUpload();
  }
  ctx.out(code === 0 ? 'The restore CLI finished (exit 0).' : `The restore CLI exited ${code}.`);

  if (stoppedByUs && !flags['no-start']) {
    ctx.out(`Starting ${container}…`);
    await remoteOk(
      ctx,
      'docker-start',
      `docker start ${shq(container)}`,
      'Could not start the container',
    );
    const healthy = await waitHealthy(ctx, container);
    if (!healthy) {
      ctx.err(
        `${container} did not report healthy within 120 s: check \`docker logs ${container}\`.`,
      );
      return code === 0 ? 1 : code;
    }
    ctx.out(`${container} is healthy.`);
  } else {
    ctx.out('Start the app in Umbrel.');
  }
  return code;
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
