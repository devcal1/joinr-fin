// `pnpm umbrel:nas-secrets` (stage-8.md §6; D126, D132): places, checks or removes the two NAS
// copy files in the app's data folder on the Umbrel, over SSH.
//
//   node tools/deploy/nas-secrets.mjs                   place nas-url + nas-password (both or neither)
//   node tools/deploy/nas-secrets.mjs --check           which files are there (mode, owner); never contents
//   node tools/deploy/nas-secrets.mjs --remove [--yes]  delete both (the copy is off again)
//   node tools/deploy/nas-secrets.mjs --dry-run [mode]  print every ssh command; no prompts, nothing sent
//   node tools/deploy/nas-secrets.mjs --prompt-test     read ONE hidden entry, print only its length
//
// The owner runs it in his own terminal (PowerShell or Windows Terminal): the password is typed
// into a hidden prompt here and never passes through a chat, a tool call or a file on the PC.
// Values travel only on ssh's standard input; no value is ever in an argument, an environment
// variable, a file on the PC or a printed line (the dry-run printer shows `<stdin: secret>`).
// No remote command asks for a file's size (`stat %s` of nas-password would be the password's
// length plus one). Every remote path is built from validated constants.
//
// Exit codes: 0 done · 1 failed (nothing changed, or the verification named the problem) ·
// 2 usage, not a terminal, the app not installed, SSH unreachable · 130 aborted.
import {
  DeployError,
  NAS_SECRETS_DIR,
  NAS_SECRET_FILES,
  NOT_A_TERMINAL_MESSAGE,
  checkNasUrl,
  commonDryRunReply,
  createContext,
  createTerminalPrompt,
  isEntry,
  isTailscaleAddress,
  nasUrlHost,
  parseFlags,
  preflight,
  remote,
  remoteHome,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
} from './lib.mjs';

const USAGE = [
  'Usage: node tools/deploy/nas-secrets.mjs [--check | --remove [--yes] | --prompt-test] [--dry-run]',
  '  (no mode)      place nas-url and nas-password (prompts; PowerShell or Windows Terminal)',
  '  --check        which NAS files are on the Umbrel (mode and owner only, never contents)',
  '  --remove       delete both files: the copy to the NAS is off again (--yes: no question)',
  '  --prompt-test  rehearse the hidden prompt: read one entry, print only how many characters',
  '  --dry-run      print every ssh command it would run; no prompts, nothing is sent',
].join('\n');

/** The longest password the helper accepts. */
export const PASSWORD_MAX = 256;
/** The owner and modes every placed file and the folder must have (uid 1000: the app's user). */
export const EXPECTED_UID = '1000';
export const FILE_MODE = '600';
export const DIR_MODE = '700';

/** The files in commit order: the password first (§6.2 step 5). */
export const COMMIT_ORDER = [NAS_SECRET_FILES.password, NAS_SECRET_FILES.url];

const ADDRESS_HELP = [
  'The NAS address has the form  rsync://<account>@<NAS Tailscale IP>/<module>  (optionally',
  "/<module>/<subfolder>). Use the NAS's Tailscale IP: names do not resolve inside the app's",
  'container, and the rsync protocol is not encrypted (Tailscale encrypts it). The address is not',
  'a secret, so it is shown as you type. The password goes in the next prompt, never here.',
].join('\n');

export const NOT_TAILSCALE_WARNING =
  'This is not a Tailscale address: the rsync protocol is not encrypted, so the files would cross the network readable.';

/** The remote paths, all built from validated constants. */
export function nasPaths(ctx, home) {
  const data = remotePath(home, 'umbrel', 'app-data', ctx.config.appId, 'data');
  const secrets = `${data}/${NAS_SECRETS_DIR}`;
  const file = (name) => `${secrets}/${name}`;
  const staged = (name) => `${secrets}/.${name}.new`;
  return { data, secrets, file, staged };
}

/**
 * One remote line per item: `<label> missing`, `<label> link`, or
 * `<label> <mode> <uid> <nonempty|empty> <file|dir|other>`. Mode and owner only: never a size,
 * never contents (`test -s` answers "empty or not" and nothing more). Labels are constants.
 */
export function statCommand(items) {
  const fn =
    'c() { if [ -L "$2" ]; then echo "$1 link"; elif [ -e "$2" ]; then ' +
    `echo "$1 $(stat -c '%a %u' -- "$2") $(test -s "$2" && echo nonempty || echo empty) ` +
    '$(if [ -f "$2" ]; then echo file; elif [ -d "$2" ]; then echo dir; else echo other; fi)"; ' +
    'else echo "$1 missing"; fi; }';
  return [fn, ...items.map(({ label, path }) => `c ${shq(label)} ${shq(path)}`)].join('; ');
}

/** Parses `statCommand` output into `{ [label]: { state, mode?, uid?, nonempty?, type? } }`. */
export function parseStat(text, labels) {
  const found = {};
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    let m = /^(\S+) (missing|link)$/.exec(t);
    if (m) {
      found[m[1]] = { state: m[2] };
      continue;
    }
    m = /^(\S+) (\d{3,4}) (\d+) (nonempty|empty) (file|dir|other)$/.exec(t);
    if (m) {
      found[m[1]] = {
        state: 'present',
        mode: m[2],
        uid: m[3],
        nonempty: m[4] === 'nonempty',
        type: m[5],
      };
    }
  }
  for (const l of labels) if (!found[l]) found[l] = { state: 'unknown' };
  return found;
}

/** What is wrong with a placed item, or null (`dir`: the folder; otherwise a file). */
export function problemOf(entry, kind = 'file') {
  if (entry.state === 'missing') return 'missing';
  if (entry.state === 'link') return 'a symbolic link';
  if (entry.state !== 'present') return 'could not be checked';
  const wantType = kind === 'dir' ? 'dir' : 'file';
  const wantMode = kind === 'dir' ? DIR_MODE : FILE_MODE;
  if (entry.type !== wantType) return `not a ${kind === 'dir' ? 'folder' : 'regular file'}`;
  if (entry.mode !== wantMode) return `mode ${entry.mode}, expected ${wantMode}`;
  if (entry.uid !== EXPECTED_UID) return `owner uid ${entry.uid}, expected ${EXPECTED_UID}`;
  if (kind !== 'dir' && !entry.nonempty) return 'empty';
  return null;
}

/** A C0 or C1 control character, or DEL (NUL included). */
function isControl(ch) {
  const code = ch.codePointAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Why a typed password is refused, or null (§6.2 prompt 2). */
export function passwordProblem(pw) {
  if (pw.length === 0) return 'The password is empty.';
  if ([...pw].length > PASSWORD_MAX)
    return `The password is longer than ${PASSWORD_MAX} characters.`;
  if ([...pw].some(isControl)) return 'The password contains a control character.';
  if (pw.trim() !== pw) return 'The password starts or ends with a space.';
  return null;
}

/** The app's data folder must exist: the app is installed. */
async function requireDataFolder(ctx, paths) {
  const r = await remote(ctx, 'nas-data-dir', `test -d ${shq(paths.data)}`);
  if (r.code !== 0) {
    throw new DeployError(
      `Install Joinr Finance first: its data folder is not on ${ctx.config.host}.`,
      2,
    );
  }
}

async function removeStaged(ctx, paths) {
  await remote(ctx, 'nas-cleanup', `rm -f -- ${shq(paths.secrets)}/.nas-*.new`);
}

// ─── Prompts ───────────────────────────────────────────────────────────────────────────────────

/** Asks for the address until the rule accepts it (and a non-Tailscale host is confirmed). */
async function askAddress(ctx, prompt) {
  ctx.out(ADDRESS_HELP);
  for (;;) {
    const typed = await prompt.visible('NAS address: ');
    const check = checkNasUrl(typed);
    if (!check.ok) {
      ctx.out(
        check.configured
          ? 'That is not an rsync://account@host/module address (no password in it, no spaces). Try again.'
          : 'The address is empty. Try again.',
      );
      continue;
    }
    if (!isTailscaleAddress(nasUrlHost(check.url))) {
      ctx.out(NOT_TAILSCALE_WARNING);
      const answer = await prompt.visible('Type yes to use it anyway, or Enter to type another: ');
      if (answer.trim() !== 'yes') continue;
    }
    ctx.out('address accepted');
    return check.url;
  }
}

/** Asks for the password twice, hidden, until it passes the rules and both entries match. */
async function askPassword(ctx, prompt) {
  for (;;) {
    const first = await prompt.hidden('NAS password (hidden): ');
    const problem = passwordProblem(first);
    if (problem) {
      ctx.out(`${problem} Try again.`);
      continue;
    }
    const second = await prompt.hidden('The same password again (hidden): ');
    if (second !== first) {
      ctx.out('The two entries differ. Try again.');
      continue;
    }
    ctx.out('password accepted');
    return first;
  }
}

// ─── Modes ─────────────────────────────────────────────────────────────────────────────────────

async function place(ctx, paths, prompt) {
  let url;
  let password;
  if (ctx.dryRun) {
    ctx.out('(dry run: no prompts; the values would travel only on ssh standard input)');
    url = '';
    password = '';
  } else {
    url = await askAddress(ctx, prompt);
    password = await askPassword(ctx, prompt);
  }
  const values = { [NAS_SECRET_FILES.url]: url, [NAS_SECRET_FILES.password]: password };

  // 1. The folder.
  const mk = await remote(
    ctx,
    'nas-mkdir',
    `umask 077 && mkdir -p ${shq(paths.secrets)} && chmod 700 ${shq(paths.secrets)}`,
  );
  if (mk.code !== 0)
    throw new DeployError('Could not create the secrets folder. Nothing was changed.', 1);

  // 2. Stage each file (the value on stdin only). `rm -f` first: umask applies only when a file is
  // created, so a stale `.new` left at 644 by an interrupted run would otherwise keep 644.
  for (const name of [NAS_SECRET_FILES.url, NAS_SECRET_FILES.password]) {
    const staged = shq(paths.staged(name));
    const r = await remote(
      ctx,
      'nas-stage',
      `umask 077 && rm -f -- ${staged} && cat > ${staged} && chmod 600 -- ${staged}`,
      { input: `${values[name]}\n` },
    );
    if (r.code !== 0) {
      // 3. All or none.
      await removeStaged(ctx, paths);
      throw new DeployError(`Could not write ${name} on the Umbrel. Nothing was changed.`, 1);
    }
  }

  // 4. Pre-commit check: nothing goes live that would fail the check afterwards.
  const stagedItems = COMMIT_ORDER.map((name) => ({
    label: `.${name}.new`,
    path: paths.staged(name),
  }));
  const pre = await remote(ctx, 'nas-precheck', statCommand(stagedItems));
  if (!ctx.dryRun) {
    const found = parseStat(
      pre.stdout,
      stagedItems.map((i) => i.label),
    );
    for (const { label } of stagedItems) {
      const problem = problemOf(found[label]);
      if (problem) {
        await removeStaged(ctx, paths);
        throw new DeployError(`${label} is ${problem}. Nothing was changed.`, 1);
      }
    }
  }

  // 5. Commit, the password first: while the copy was off the app never sees an address without
  // its password.
  const commit = await remote(
    ctx,
    'nas-commit',
    `cd ${shq(paths.secrets)} && ${COMMIT_ORDER.map((n) => `mv -f .${n}.new ${n}`).join(' && ')}`,
  );
  if (commit.code !== 0) {
    await removeStaged(ctx, paths);
    throw new DeployError(
      'Placing the files failed part way. Run --check, then this helper again.',
      1,
    );
  }

  // 6. Verify what is live.
  const placed = [
    { label: NAS_SECRETS_DIR, path: paths.secrets, kind: 'dir' },
    ...COMMIT_ORDER.map((name) => ({ label: name, path: paths.file(name), kind: 'file' })),
  ];
  const post = await remote(ctx, 'nas-verify', statCommand(placed));
  if (!ctx.dryRun) {
    const found = parseStat(
      post.stdout,
      placed.map((i) => i.label),
    );
    for (const item of placed) {
      const problem = problemOf(found[item.label], item.kind);
      if (problem) {
        throw new DeployError(
          `${item.kind === 'dir' ? 'The secrets folder' : item.label} is ${problem}. Run --check, then this helper again.`,
          1,
        );
      }
    }
  }

  // 7. Done.
  ctx.out(
    `Placed: ${NAS_SECRET_FILES.url}, ${NAS_SECRET_FILES.password}. Settings → Backups now shows the copy as ready. ` +
      'Click Copy to NAS now to copy straight away (otherwise within the hour, then every Sunday at 03:00).',
  );
  return 0;
}

/** The folder and the two files, as `--check` and `pnpm umbrel:status` report them. */
export function nasItems(paths) {
  return [
    { label: NAS_SECRETS_DIR, path: paths.secrets, kind: 'dir' },
    { label: NAS_SECRET_FILES.url, path: paths.file(NAS_SECRET_FILES.url), kind: 'file' },
    { label: NAS_SECRET_FILES.password, path: paths.file(NAS_SECRET_FILES.password), kind: 'file' },
  ];
}

/**
 * The report of `nasItems`: one line per item (mode and owner, never contents or a size) and the
 * state the app will derive (§5.2): off, partial, invalid (a file that is not a plain file) or
 * ready. Whether the address itself is usable is decided by the app, which reads it.
 */
export function describeNasFiles(found, items = undefined) {
  const list = items ?? [
    { label: NAS_SECRETS_DIR, kind: 'dir' },
    { label: NAS_SECRET_FILES.url, kind: 'file' },
    { label: NAS_SECRET_FILES.password, kind: 'file' },
  ];
  const lines = [];
  // true usable, false absent (missing or empty), null present but unusable, undefined unknown.
  const usable = {};
  for (const item of list) {
    const e = found[item.label] ?? { state: 'unknown' };
    const name = item.kind === 'dir' ? 'secrets folder' : item.label;
    if (e.state === 'missing' || e.state === 'unknown') {
      lines.push(`${name}: ${e.state === 'missing' ? 'missing' : 'could not be checked'}`);
      usable[item.label] = e.state === 'missing' ? false : undefined;
      continue;
    }
    const problem = problemOf(e, item.kind);
    lines.push(
      problem === null
        ? `${name}: present (${e.mode}, uid ${e.uid})`
        : `${name}: present, but ${problem}`,
    );
    usable[item.label] = e.state === 'present' && e.type === 'file' ? e.nonempty : null;
  }
  const u = usable[NAS_SECRET_FILES.url];
  const p = usable[NAS_SECRET_FILES.password];
  let state;
  if (u === undefined || p === undefined) state = 'unknown (a file could not be checked)';
  else if (u === false && p === false) state = 'off (the copy to the NAS is not set up)';
  else if (u === false || p === false)
    state = `partial (${u === false ? NAS_SECRET_FILES.url : NAS_SECRET_FILES.password} is missing: nothing is copied)`;
  else if (u === null || p === null)
    state = 'invalid (a file is not a plain file: nothing is copied)';
  else
    state =
      'ready (the address itself is checked by the app: Settings → Backups says if it is not usable)';
  return { lines, state };
}

async function check(ctx, paths) {
  const items = nasItems(paths);
  const r = await remote(ctx, 'nas-check', statCommand(items));
  const found = parseStat(
    r.stdout,
    items.map((i) => i.label),
  );
  const { lines, state } = describeNasFiles(found, items);
  for (const l of lines) ctx.out(l);
  ctx.out(`The app will see: ${state}`);
  return 0;
}

async function removeFiles(ctx, paths, flags, prompt) {
  if (!flags.yes && !ctx.dryRun) {
    if (!prompt.isTerminal()) {
      throw new DeployError(
        '--remove asks for confirmation: run it in a terminal, or add --yes.',
        2,
      );
    }
    const answer = await prompt.visible(
      `Remove ${NAS_SECRET_FILES.url} and ${NAS_SECRET_FILES.password} from ${ctx.config.host}? The copy to the NAS stops. [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      ctx.out('Nothing was removed.');
      return 0;
    }
  }
  const files = [NAS_SECRET_FILES.url, NAS_SECRET_FILES.password].map((n) => shq(paths.file(n)));
  const r = await remote(
    ctx,
    'nas-remove',
    `rm -f -- ${files.join(' ')} ${shq(paths.secrets)}/.nas-*.new`,
  );
  if (r.code !== 0) throw new DeployError('Could not remove the NAS files.', 1);
  ctx.out(
    `Removed ${NAS_SECRET_FILES.url} and ${NAS_SECRET_FILES.password}. The copy to the NAS is off; nothing on the NAS was touched.`,
  );
  return 0;
}

async function promptTest(ctx, prompt) {
  if (!prompt.isTerminal()) throw new DeployError(NOT_A_TERMINAL_MESSAGE, 2);
  ctx.out('Type or paste anything EXCEPT the real password, then Enter. Nothing should appear.');
  const entry = await prompt.hidden('Test entry (hidden): ');
  ctx.out(`read ${[...entry].length} characters, nothing was echoed`);
  return 0;
}

/** Dry-run stand-ins: the check reports every item missing (nothing was asked of the host). */
function dryRunReply(spec) {
  if (spec.purpose === 'nas-check') {
    return {
      stdout: [NAS_SECRETS_DIR, NAS_SECRET_FILES.url, NAS_SECRET_FILES.password]
        .map((l) => `${l} missing`)
        .join('\n'),
    };
  }
  return commonDryRunReply(spec);
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, {
    check: 'boolean',
    remove: 'boolean',
    yes: 'boolean',
    'prompt-test': 'boolean',
    'dry-run': 'boolean',
    help: 'boolean',
  });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  const modes = ['check', 'remove', 'prompt-test'].filter((m) => flags[m]);
  if (positional.length > 0 || modes.length > 1 || (flags.yes && !flags.remove)) {
    throw new DeployError(USAGE, 2);
  }
  const mode = modes[0] ?? 'place';
  const dryRun = flags['dry-run'] === true;
  const prompt = deps.prompt ?? createTerminalPrompt();

  if (mode === 'prompt-test') {
    const ctx = createContext(deps, { dryRun });
    return promptTest(ctx, prompt);
  }
  // Placing needs a terminal that can hide input: refuse before anything runs.
  if (mode === 'place' && !dryRun && !prompt.isTerminal()) {
    throw new DeployError(NOT_A_TERMINAL_MESSAGE, 2);
  }
  const ctx = createContext(deps, { dryRun, dryRunReply });
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  const paths = nasPaths(ctx, home);
  await requireDataFolder(ctx, paths);
  if (mode === 'check') return check(ctx, paths);
  if (mode === 'remove') return removeFiles(ctx, paths, flags, prompt);
  return place(ctx, paths, prompt);
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
