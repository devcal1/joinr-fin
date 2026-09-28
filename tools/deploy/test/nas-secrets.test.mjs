// The NAS helper (stage-8.md §6.2, §6.4; D132: no heartbeat): the fake runner and an injected
// prompt; no TTY, no ssh. Every planted value is obviously fake; test addresses are built with
// `ip(a, b, c, d)` (the privacy guard flags dotted IPv4 literals outside loopback and RFC 5737).
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { describe, expect, it, vi } from 'vitest';
import {
  NAS_SECRETS_DIR as SCHEMA_DIR,
  NAS_SECRET_FILES as SCHEMA_FILES,
  checkNasUrl as schemaCheckNasUrl,
} from '../../../packages/schema/src/nasCopy.ts';
import {
  NAS_SECRETS_DIR,
  NAS_SECRET_FILES,
  NOT_A_TERMINAL_MESSAGE,
  checkNasUrl,
  createRealRunner,
  ipv6Groups,
  isTailscaleAddress,
  nasUrlHost,
  readHidden,
  readVisible,
  renderSpec,
} from '../lib.mjs';
import {
  NOT_TAILSCALE_WARNING,
  PASSWORD_MAX,
  describeNasFiles,
  main,
  parseStat,
  passwordProblem,
  statCommand,
} from '../nas-secrets.mjs';
import { HOME, fakeHost, remoteCommand, remoteCommands } from './helpers.mjs';

/** An IPv4 address from its octets (never a dotted literal in this file). */
const ip = (a, b, c, d) => [a, b, c, d].join('.');

const PLANTED_PASSWORD = 'planted-password-not-real';
const TS_HOST = ip(100, 64, 0, 1);
const PLANTED_URL = `rsync://planted-user@${TS_HOST}/planted-module`;
const CANONICAL_URL = `${PLANTED_URL}/`;
const SECRETS = `${HOME}/umbrel/app-data/tenon-joinr-finance/data/secrets`;

// ─── The prompt and the host ───────────────────────────────────────────────────────────────────

/** A scripted prompt: answers are consumed in order; questions are recorded. */
function scriptedPrompt(answers, { terminal = true } = {}) {
  const queue = [...answers];
  const asked = [];
  const take = (kind) => async (question) => {
    asked.push({ kind, question });
    if (queue.length === 0) throw new Error(`no scripted answer for ${question}`);
    return queue.shift();
  };
  return {
    asked,
    remaining: () => queue.length,
    isTerminal: () => terminal,
    visible: take('visible'),
    hidden: take('hidden'),
  };
}

/** A prompt that must never be used. */
const noPrompt = (terminal = false) => ({
  isTerminal: () => terminal,
  visible: () => {
    throw new Error('visible prompt used');
  },
  hidden: () => {
    throw new Error('hidden prompt used');
  },
});

/** The stat lines a healthy host answers for `labels`. */
function statReply(spec, overrides = {}) {
  const cmd = remoteCommand(spec);
  const labels = [...cmd.matchAll(/; c '([^']+)' '/g)].map((m) => m[1]);
  return {
    stdout: labels
      .map(
        (l) =>
          overrides[l] ??
          `${l} ${l === NAS_SECRETS_DIR ? '700' : '600'} 1000 nonempty ${l === NAS_SECRETS_DIR ? 'dir' : 'file'}`,
      )
      .join('\n'),
  };
}

function host(overrides = {}) {
  return fakeHost({
    'nas-precheck': (s) => statReply(s),
    'nas-verify': (s) => statReply(s),
    'nas-check': (s) => statReply(s),
    ...overrides,
  });
}

/** Everything a planted value must never appear in: every argument, env and printed line. */
function exposure(h) {
  return JSON.stringify({
    args: h.calls.map((c) => [c.cmd, c.args, c.env ?? null, c.purpose]),
    out: h.out,
    err: h.err,
  });
}

const PLACE_ANSWERS = [PLANTED_URL, PLANTED_PASSWORD, PLANTED_PASSWORD];

// ─── Placing ───────────────────────────────────────────────────────────────────────────────────

describe('nas-secrets: placing', () => {
  it('runs the exact all-or-none sequence, values on stdin only', async () => {
    const h = host();
    const prompt = scriptedPrompt(PLACE_ANSWERS);
    expect(await main([], h.deps({ prompt }))).toBe(0);
    expect(h.purposes()).toEqual([
      'preflight',
      'remote-home',
      'nas-data-dir',
      'nas-mkdir',
      'nas-stage',
      'nas-stage',
      'nas-precheck',
      'nas-commit',
      'nas-verify',
    ]);
    expect(remoteCommand(h.callsFor('nas-data-dir')[0])).toBe(
      `test -d '${HOME}/umbrel/app-data/tenon-joinr-finance/data'`,
    );
    expect(remoteCommand(h.callsFor('nas-mkdir')[0])).toBe(
      `umask 077 && mkdir -p '${SECRETS}' && chmod 700 '${SECRETS}'`,
    );
    const stages = h.callsFor('nas-stage');
    expect(stages.map(remoteCommand)).toEqual(
      ['nas-url', 'nas-password'].map(
        (n) =>
          `umask 077 && rm -f -- '${SECRETS}/.${n}.new' && cat > '${SECRETS}/.${n}.new' && chmod 600 -- '${SECRETS}/.${n}.new'`,
      ),
    );
    expect(stages.map((s) => s.input)).toEqual([`${CANONICAL_URL}\n`, `${PLANTED_PASSWORD}\n`]);
    // The commit: the password first.
    expect(remoteCommand(h.callsFor('nas-commit')[0])).toBe(
      `cd '${SECRETS}' && mv -f .nas-password.new nas-password && mv -f .nas-url.new nas-url`,
    );
    expect(h.out.at(-1)).toBe(
      'Placed: nas-url, nas-password. Settings → Backups now shows the copy as ready. Click Copy to NAS now to copy straight away (otherwise within the hour, then every Sunday at 03:00).',
    );
    expect(h.out).toContain('address accepted');
    expect(h.out).toContain('password accepted');
    // The values: only in `input` of the two staging calls; never in an argument, env or line.
    const exposed = exposure(h);
    expect(exposed).not.toContain(PLANTED_PASSWORD);
    expect(exposed).not.toContain('planted-user');
    expect(exposed).not.toContain(TS_HOST);
    expect(h.calls.filter((c) => c.input !== undefined)).toHaveLength(2);
    // No remote command ever asks for a size, and none reads a file back.
    for (const c of remoteCommands(h.calls)) {
      expect(c).not.toContain('%s');
      expect(c).not.toMatch(/\bcat\s+'/);
    }
    // The prompts: the address visible, the password hidden, twice.
    expect(prompt.asked.map((a) => a.kind)).toEqual(['visible', 'hidden', 'hidden']);
  });

  it('checks the pre-commit files for mode 600, uid 1000, regular and non-empty', async () => {
    const pre = remoteCommand(
      await (async () => {
        const h = host();
        await main([], h.deps({ prompt: scriptedPrompt(PLACE_ANSWERS) }));
        return h.callsFor('nas-precheck')[0];
      })(),
    );
    expect(pre).toContain(`c '.nas-password.new' '${SECRETS}/.nas-password.new'`);
    expect(pre).toContain(`c '.nas-url.new' '${SECRETS}/.nas-url.new'`);
    expect(pre).toContain(`stat -c '%a %u' -- "$2"`);
    expect(pre).toContain('test -s "$2"');
  });

  it.each([
    [
      '644',
      '.nas-password.new 644 1000 nonempty file',
      /\.nas-password\.new is mode 644, expected 600/,
    ],
    ['uid 0', '.nas-url.new 600 0 nonempty file', /\.nas-url\.new is owner uid 0, expected 1000/],
    ['empty', '.nas-password.new 600 1000 empty file', /\.nas-password\.new is empty/],
    ['a link', '.nas-url.new link', /\.nas-url\.new is a symbolic link/],
  ])('a pre-commit %s: the temporaries removed, no mv, exit 1', async (_label, line, message) => {
    const label = line.split(' ')[0];
    const h = host({ 'nas-precheck': (s) => statReply(s, { [label]: line }) });
    const err = await main([], h.deps({ prompt: scriptedPrompt(PLACE_ANSWERS) })).catch((e) => e);
    expect(err).toMatchObject({ exitCode: 1 });
    expect(err.message).toMatch(message);
    expect(err.message).toContain('Nothing was changed');
    expect(h.callsFor('nas-commit')).toHaveLength(0);
    expect(remoteCommand(h.callsFor('nas-cleanup')[0])).toBe(`rm -f -- '${SECRETS}'/.nas-*.new`);
  });

  it('a staging failure: the temporaries removed, no mv, exit 1', async () => {
    let n = 0;
    const h = host({
      'nas-stage': () => (++n === 2 ? { code: 1, stderr: 'No space left' } : undefined),
    });
    await expect(main([], h.deps({ prompt: scriptedPrompt(PLACE_ANSWERS) }))).rejects.toMatchObject(
      {
        exitCode: 1,
        message: 'Could not write nas-password on the Umbrel. Nothing was changed.',
      },
    );
    expect(h.purposes().slice(-2)).toEqual(['nas-stage', 'nas-cleanup']);
    expect(h.callsFor('nas-commit')).toHaveLength(0);
  });

  it.each([
    [
      'the folder at 755',
      'secrets 755 1000 nonempty dir',
      /The secrets folder is mode 755, expected 700/,
    ],
    ['nas-url at 644', 'nas-url 644 1000 nonempty file', /nas-url is mode 644, expected 600/],
    ['nas-password missing', 'nas-password missing', /nas-password is missing/],
  ])(
    'the post-commit verification refuses %s (exit 1, names the file)',
    async (_l, line, message) => {
      const label = line.split(' ')[0];
      const h = host({ 'nas-verify': (s) => statReply(s, { [label]: line }) });
      await expect(
        main([], h.deps({ prompt: scriptedPrompt(PLACE_ANSWERS) })),
      ).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringMatching(message),
      });
    },
  );

  it('a planted size in a stat reply never reaches the output', async () => {
    // A reply with an extra number (a size) does not parse: the item is "could not be checked".
    const h = host({
      'nas-check': () => ({
        stdout:
          'secrets 700 1000 4242 nonempty dir\nnas-url 600 1000 31337 nonempty file\nnas-password 600 1000 27 nonempty file',
      }),
    });
    expect(await main(['--check'], h.deps({ prompt: noPrompt() }))).toBe(0);
    const text = h.out.join('\n');
    for (const planted of ['4242', '31337', ' 27']) expect(text).not.toContain(planted);
    expect(text).toContain('nas-password: could not be checked');
  });

  it('refuses to place without a terminal (the mintty sentence), before any command', async () => {
    const h = host();
    await expect(main([], h.deps({ prompt: noPrompt(false) }))).rejects.toMatchObject({
      exitCode: 2,
      message: NOT_A_TERMINAL_MESSAGE,
    });
    expect(NOT_A_TERMINAL_MESSAGE).toContain(
      "Git Bash's mintty window is not a terminal Node can hide input in: use PowerShell or Windows Terminal, or `winpty node tools/deploy/nas-secrets.mjs`.",
    );
    expect(h.calls).toHaveLength(0);
  });

  it('exits 2 when the app is not installed (no data folder), before any prompt', async () => {
    const h = host({ 'nas-data-dir': { code: 1 } });
    await expect(main([], h.deps({ prompt: noPrompt(true) }))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/^Install Joinr Finance first/),
    });
    expect(h.callsFor('nas-mkdir')).toHaveLength(0);
  });

  it('exits 2 when SSH is unreachable', async () => {
    const h = host({ preflight: { code: 255 } });
    await expect(main([], h.deps({ prompt: noPrompt(true) }))).rejects.toMatchObject({
      exitCode: 2,
    });
  });

  it('re-prompts a refused address, and never prints it back', async () => {
    const h = host();
    const prompt = scriptedPrompt([
      '',
      'rsync://planted-user:pw@planted-host/m',
      `https://${TS_HOST}/m`,
      PLANTED_URL,
      PLANTED_PASSWORD,
      PLANTED_PASSWORD,
    ]);
    expect(await main([], h.deps({ prompt }))).toBe(0);
    expect(h.out.filter((l) => /Try again\.$/.test(l))).toHaveLength(3);
    expect(h.out.join('\n')).not.toContain('planted-user');
    expect(h.out.join('\n')).not.toContain(TS_HOST);
  });

  it.each([
    ['empty', '', 'The password is empty.'],
    ['257 characters', 'x'.repeat(PASSWORD_MAX + 1), 'The password is longer than 256 characters.'],
    ['a tab', 'pass\tword', 'The password contains a control character.'],
    ['a NUL', 'pass\0word', 'The password contains a control character.'],
    ['a leading space', ' password', 'The password starts or ends with a space.'],
    ['a trailing space', 'password ', 'The password starts or ends with a space.'],
  ])('refuses a password with %s and asks again', async (_l, bad, message) => {
    expect(passwordProblem(bad)).toBe(message);
    const h = host();
    const prompt = scriptedPrompt([PLANTED_URL, bad, PLANTED_PASSWORD, PLANTED_PASSWORD]);
    expect(await main([], h.deps({ prompt }))).toBe(0);
    expect(h.out).toContain(`${message} Try again.`);
    expect(h.callsFor('nas-stage')[1].input).toBe(`${PLANTED_PASSWORD}\n`);
  });

  it('accepts 256 characters and unicode', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MAX))).toBeNull();
    expect(passwordProblem('pässwörd-€')).toBeNull();
  });

  it('a mismatch on the second entry asks for both again', async () => {
    const h = host();
    const prompt = scriptedPrompt([
      PLANTED_URL,
      PLANTED_PASSWORD,
      'something-else',
      PLANTED_PASSWORD,
      PLANTED_PASSWORD,
    ]);
    expect(await main([], h.deps({ prompt }))).toBe(0);
    expect(h.out).toContain('The two entries differ. Try again.');
    expect(prompt.asked.map((a) => a.kind)).toEqual([
      'visible',
      'hidden',
      'hidden',
      'hidden',
      'hidden',
    ]);
  });

  it('places exactly two files: no heartbeat file, prompt or flag (D132)', async () => {
    const h = host();
    await main([], h.deps({ prompt: scriptedPrompt(PLACE_ANSWERS) }));
    expect(remoteCommands(h.calls).join('\n')).not.toMatch(/heartbeat/i);
    expect(h.out.join('\n')).not.toMatch(/heartbeat/i);
    await expect(main(['--heartbeat-only'], host().deps())).rejects.toMatchObject({ exitCode: 2 });
    await expect(main(['--remove-heartbeat'], host().deps())).rejects.toMatchObject({
      exitCode: 2,
    });
  });
});

// ─── The Tailscale check ───────────────────────────────────────────────────────────────────────

describe('nas-secrets: the Tailscale check', () => {
  it.each([
    [ip(100, 64, 0, 1)],
    [ip(100, 127, 255, 254)],
    [ip(100, 100, 1, 2)],
    ['[fd7a:115c:a1e0::1]'],
    ['[fd7a:115c:a1e0:ab12:4843:cd96:6258:b240]'],
  ])('accepts %s silently', async (host_) => {
    const h = host();
    const prompt = scriptedPrompt([
      `rsync://planted-user@${host_}/m`,
      PLANTED_PASSWORD,
      PLANTED_PASSWORD,
    ]);
    expect(await main([], h.deps({ prompt }))).toBe(0);
    expect(h.out).not.toContain(NOT_TAILSCALE_WARNING);
  });

  it.each([
    [ip(100, 63, 255, 255)],
    [ip(100, 128, 0, 1)],
    [ip(192, 168, 1, 10)],
    [ip(198, 51, 100, 7)],
    ['planted-host'],
    ['[fd7a:115c:a1e1::1]'],
  ])('warns about %s, continues on "yes", re-prompts on anything else', async (host_) => {
    const url = `rsync://planted-user@${host_}/m`;
    const refused = host();
    const again = scriptedPrompt([url, 'no', PLANTED_URL, PLANTED_PASSWORD, PLANTED_PASSWORD]);
    expect(await main([], refused.deps({ prompt: again }))).toBe(0);
    expect(refused.out).toContain(NOT_TAILSCALE_WARNING);
    expect(again.asked.map((a) => a.question)[2]).toBe('NAS address: ');
    expect(refused.callsFor('nas-stage')[0].input).toBe(`${CANONICAL_URL}\n`);

    const accepted = host();
    const yes = scriptedPrompt([url, 'yes', PLANTED_PASSWORD, PLANTED_PASSWORD]);
    expect(await main([], accepted.deps({ prompt: yes }))).toBe(0);
    expect(accepted.callsFor('nas-stage')[0].input).toBe(`${checkNasUrl(url).url}\n`);
  });

  it('isTailscaleAddress on the range edges, IPv6 forms and names', () => {
    expect(isTailscaleAddress(ip(100, 64, 0, 0))).toBe(true);
    expect(isTailscaleAddress(ip(100, 127, 255, 255))).toBe(true);
    expect(isTailscaleAddress(ip(100, 63, 255, 255))).toBe(false);
    expect(isTailscaleAddress(ip(100, 128, 0, 0))).toBe(false);
    expect(isTailscaleAddress(ip(101, 64, 0, 1))).toBe(false);
    expect(isTailscaleAddress(ip(100, 64, 0, 256))).toBe(false);
    // A leading zero reads as octal in the C library: never taken for a Tailscale address.
    expect(isTailscaleAddress(ip(100, '064', 0, 1))).toBe(false);
    expect(isTailscaleAddress(ip(100, '077', 0, 1))).toBe(false);
    expect(isTailscaleAddress(ip(100, 64, '00', 1))).toBe(false);
    expect(isTailscaleAddress(ip(100, 64, 0, '01'))).toBe(false);
    expect(isTailscaleAddress(`::ffff:${ip(100, '064', 0, 1)}`)).toBe(false);
    expect(isTailscaleAddress('fd7a:115c:a1e0::')).toBe(true);
    expect(isTailscaleAddress('FD7A:115C:A1E0:0:0:0:0:1')).toBe(true);
    expect(isTailscaleAddress('[fd7a:115c:a1e0::1]')).toBe(true);
    expect(isTailscaleAddress('fd7a:115c:a1e1::1')).toBe(false);
    expect(isTailscaleAddress('fd7a:115c::1')).toBe(false);
    expect(isTailscaleAddress('::1')).toBe(false);
    expect(isTailscaleAddress('planted-host')).toBe(false);
    expect(isTailscaleAddress('')).toBe(false);
    expect(isTailscaleAddress(undefined)).toBe(false);
  });

  it('ipv6Groups expands every form and refuses junk', () => {
    expect(ipv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups('fd7a:115c:a1e0::')).toEqual([0xfd7a, 0x115c, 0xa1e0, 0, 0, 0, 0, 0]);
    expect(ipv6Groups(`::ffff:${ip(100, 64, 0, 1)}`)).toEqual([0, 0, 0, 0, 0, 0xffff, 0x6440, 1]);
    for (const bad of [
      '',
      ':::',
      '1::2::3',
      'g::1',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '12345::1',
    ])
      expect(ipv6Groups(bad)).toBeNull();
  });

  it('nasUrlHost reads the host of a canonical address', () => {
    expect(nasUrlHost(CANONICAL_URL)).toBe(TS_HOST);
    expect(nasUrlHost('rsync://u@[fd7a:115c:a1e0::1]:873/m/')).toBe('fd7a:115c:a1e0::1');
    expect(nasUrlHost('rsync://u@planted-host:873/m/s/')).toBe('planted-host');
  });
});

// ─── --check, --remove, --prompt-test, --dry-run ───────────────────────────────────────────────

describe('nas-secrets: the other modes', () => {
  it('--check reports mode and owner only, never runs cat, never asks for %s', async () => {
    const h = host();
    expect(await main(['--check'], h.deps({ prompt: noPrompt() }))).toBe(0);
    expect(h.out.slice(-4)).toEqual([
      'secrets folder: present (700, uid 1000)',
      'nas-url: present (600, uid 1000)',
      'nas-password: present (600, uid 1000)',
      'The app will see: ready (the address itself is checked by the app: Settings → Backups says if it is not usable)',
    ]);
    const cmds = remoteCommands(h.calls).join('\n');
    expect(cmds).not.toContain('%s');
    expect(cmds).not.toMatch(/\bcat\b|\bhead\b|\bread\b/);
    expect(h.callsFor('nas-check')).toHaveLength(1);
  });

  it.each([
    [
      'off',
      {
        secrets: 'secrets missing',
        'nas-url': 'nas-url missing',
        'nas-password': 'nas-password missing',
      },
      'off (the copy to the NAS is not set up)',
    ],
    [
      'partial',
      { 'nas-password': 'nas-password missing' },
      'partial (nas-password is missing: nothing is copied)',
    ],
    [
      'an empty file',
      { 'nas-url': 'nas-url 600 1000 empty file' },
      'partial (nas-url is missing: nothing is copied)',
    ],
    [
      'a link',
      { 'nas-url': 'nas-url link' },
      'invalid (a file is not a plain file: nothing is copied)',
    ],
  ])('--check derives %s', async (_l, lines, state) => {
    const h = host({ 'nas-check': (s) => statReply(s, lines) });
    await main(['--check'], h.deps({ prompt: noPrompt() }));
    expect(h.out.at(-1)).toBe(`The app will see: ${state}`);
  });

  it('--remove --yes: the exact command (fixed names only; the folder stays)', async () => {
    const h = host();
    expect(await main(['--remove', '--yes'], h.deps({ prompt: noPrompt() }))).toBe(0);
    expect(remoteCommand(h.callsFor('nas-remove')[0])).toBe(
      `rm -f -- '${SECRETS}/nas-url' '${SECRETS}/nas-password' '${SECRETS}'/.nas-*.new`,
    );
    expect(h.out.at(-1)).toBe(
      'Removed nas-url and nas-password. The copy to the NAS is off; nothing on the NAS was touched.',
    );
  });

  it('--remove without --yes and without a terminal: exit 2, nothing removed', async () => {
    const h = host();
    await expect(main(['--remove'], h.deps({ prompt: noPrompt(false) }))).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(h.callsFor('nas-remove')).toHaveLength(0);
  });

  it('--remove asks y/N in a terminal; anything but y removes nothing', async () => {
    const no = host();
    expect(await main(['--remove'], no.deps({ prompt: scriptedPrompt(['']) }))).toBe(0);
    expect(no.callsFor('nas-remove')).toHaveLength(0);
    expect(no.out.at(-1)).toBe('Nothing was removed.');
    const yes = host();
    expect(await main(['--remove'], yes.deps({ prompt: scriptedPrompt(['y']) }))).toBe(0);
    expect(yes.callsFor('nas-remove')).toHaveLength(1);
  });

  it('--prompt-test reads one hidden entry, prints only its length, runs nothing', async () => {
    const h = host();
    const prompt = scriptedPrompt([PLANTED_PASSWORD]);
    expect(await main(['--prompt-test'], h.deps({ prompt }))).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(prompt.asked.map((a) => a.kind)).toEqual(['hidden']);
    expect(h.out.at(-1)).toBe(`read ${PLANTED_PASSWORD.length} characters, nothing was echoed`);
    expect(h.out.join('\n')).not.toContain(PLANTED_PASSWORD);
  });

  it('--prompt-test without a terminal: exit 2 with the mintty sentence', async () => {
    const h = host();
    await expect(
      main(['--prompt-test'], h.deps({ prompt: noPrompt(false) })),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: NOT_A_TERMINAL_MESSAGE,
    });
  });

  it('--dry-run places nothing, asks nothing, prints <stdin: secret> and no %s', async () => {
    const h = host();
    expect(await main(['--dry-run'], h.deps({ prompt: noPrompt(false) }))).toBe(0);
    expect(h.calls).toHaveLength(0);
    const text = h.out.join('\n');
    expect(text.match(/< <stdin: secret>/g)).toHaveLength(2);
    expect(text).toContain('/dry-run-home/umbrel/app-data/tenon-joinr-finance/data/secrets');
    expect(text).toContain('mv -f .nas-password.new nas-password && mv -f .nas-url.new nas-url');
    expect(text).not.toContain('%s');
  });

  it('--dry-run of every mode runs nothing', async () => {
    for (const argv of [
      ['--dry-run', '--check'],
      ['--dry-run', '--remove', '--yes'],
      ['--dry-run', '--remove'],
    ]) {
      const h = host();
      expect(await main(argv, h.deps({ prompt: noPrompt(false) }))).toBe(0);
      expect(h.calls).toHaveLength(0);
      expect(h.out.join('\n')).not.toContain('%s');
    }
  });

  it('refuses unknown or combined modes (exit 2)', async () => {
    for (const argv of [['--check', '--remove'], ['--yes'], ['extra'], ['--nope']]) {
      await expect(main(argv, host().deps({ prompt: noPrompt() }))).rejects.toMatchObject({
        exitCode: 2,
      });
    }
  });
});

// ─── The stat helpers ──────────────────────────────────────────────────────────────────────────

describe('stat helpers', () => {
  it('statCommand quotes labels and paths and never asks for a size', () => {
    const cmd = statCommand([{ label: 'nas-url', path: "/h/it's/nas-url" }]);
    expect(cmd).toContain(`c 'nas-url' '/h/it'\\''s/nas-url'`);
    expect(cmd).not.toContain('%s');
  });

  it('parseStat reads the four shapes and marks anything else unknown', () => {
    expect(
      parseStat('a missing\nb link\nc 600 1000 nonempty file\nd 600 1000 99 x\n', [
        'a',
        'b',
        'c',
        'd',
      ]),
    ).toEqual({
      a: { state: 'missing' },
      b: { state: 'link' },
      c: { state: 'present', mode: '600', uid: '1000', nonempty: true, type: 'file' },
      d: { state: 'unknown' },
    });
  });

  it('describeNasFiles says ready only when both files are plain and non-empty', () => {
    const ok = (l) => ({
      state: 'present',
      mode: '600',
      uid: '1000',
      nonempty: true,
      type: 'file',
      l,
    });
    expect(
      describeNasFiles({
        secrets: { state: 'present', mode: '700', uid: '1000', nonempty: true, type: 'dir' },
        'nas-url': ok(),
        'nas-password': ok(),
      }).state,
    ).toMatch(/^ready/);
  });
});

// ─── The shared rule and names ─────────────────────────────────────────────────────────────────

describe('the address rule is the schema rule', () => {
  const TABLE = [
    'rsync://planted-user@planted-host/planted-module',
    'rsync://planted-user@planted-host/planted-module/sub/',
    `rsync://planted-user@${TS_HOST}/planted-module`,
    `rsync://planted-user@${TS_HOST}:873/planted-module/sub`,
    '  rsync://u@h/m\r\n',
    'RSYNC://u@h/m',
    'rsync://u@h:08873/m',
    'rsync://u@[::1]:873/m/s',
    'rsync://u@[fd7a:115c:a1e0::1]/m',
    'rsync://%75@h/%6D',
    'rsync://u.name_1-x@h/m.1_x-y',
    'http://u@h/m',
    'rsync://h/m',
    'rsync://@h/m',
    'rsync://u@/m',
    'rsync://u@h',
    'rsync://u@h/',
    'rsync://u@h/a/b/c',
    'rsync://u:pw@h/m',
    'rsync://u:@h/m',
    'rsync://u@h/m?x=1',
    'rsync://u@h/m#f',
    'rsync://u@h/m odule',
    'rsync://u@h/m\todule',
    'rsync://-u@h/m',
    'rsync://u@h/-m',
    'rsync://u@h/m/..',
    'rsync://u@h/../m',
    'rsync://u@h/m%2Fs',
    'rsync://u@h/%2E%2E',
    'rsync://u%00@h/m',
    'rsync://u%zz@h/m',
    'rsync://u@h/m%E0%A4%A',
    'rsync://u@h:0/m',
    'rsync://u@h:65536/m',
    'rsync://u@[zz]/m',
    'rsync://u@hоst/m',
    '-e rsync://u@h/m',
    'rsync://u@h/m/--delete',
    'rsync://u@h/m;rm',
    '',
    '   ',
    undefined,
    null,
    42,
    ['rsync://u@h/m'],
  ];

  it.each(TABLE.map((t) => [t]))('%j: the same answer as @joinr/schema', (raw) => {
    expect(checkNasUrl(raw)).toEqual(schemaCheckNasUrl(raw));
  });

  it('the same answer on 3000 generated addresses', () => {
    const parts = [
      'rsync://',
      'RSYNC://',
      'u',
      'planted-user',
      '@',
      ':',
      'h',
      TS_HOST,
      '[::1]',
      '/',
      'm',
      'sub',
      '..',
      '.',
      '-',
      '%2F',
      '%zz',
      '%41',
      '?',
      '#',
      ' ',
      '\t',
      ':873',
      ':0',
      'pw',
    ];
    let seed = 7;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 3000; i++) {
      const len = 1 + rnd(9);
      let s = rnd(4) === 0 ? '' : 'rsync://';
      for (let k = 0; k < len; k++) s += parts[rnd(parts.length)];
      expect(checkNasUrl(s), s).toEqual(schemaCheckNasUrl(s));
    }
  });

  it('the file names and the folder equal the schema constants (two files, D132)', () => {
    expect(NAS_SECRET_FILES).toEqual(SCHEMA_FILES);
    expect(Object.keys(NAS_SECRET_FILES)).toEqual(['url', 'password']);
    expect(NAS_SECRETS_DIR).toBe(SCHEMA_DIR);
  });
});

// ─── The raw-mode reader ───────────────────────────────────────────────────────────────────────

/** A fake TTY stdin: `setEncoding` decodes Buffers like a real stream (split UTF-8 included). */
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.decoder = undefined;
    this.setRawMode = vi.fn();
    this.pause = vi.fn();
    this.resume = vi.fn();
  }
  setEncoding(enc) {
    this.decoder = new StringDecoder(enc);
    return this;
  }
  push(data) {
    const chunk = Buffer.isBuffer(data) && this.decoder ? this.decoder.write(data) : data;
    if (chunk !== '') this.emit('data', chunk);
  }
}

function fakeOut() {
  const written = [];
  return { written, write: (s) => written.push(s), text: () => written.join('') };
}

describe('the raw-mode reader', () => {
  it('reads a chunk with its Enter, echoing nothing but the final newline', async () => {
    const stdin = new FakeStdin();
    const out = fakeOut();
    const p = readHidden(stdin, out);
    stdin.push('abc\r');
    expect(await p).toBe('abc');
    expect(out.text()).toBe('\n');
    expect(stdin.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(stdin.pause).toHaveBeenCalledTimes(1);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('a pasted pw\\r\\n gives pw, and a \\n arriving in the next chunk is swallowed', async () => {
    const stdin = new FakeStdin();
    const out = fakeOut();
    const first = readHidden(stdin, out);
    stdin.push('pw\r');
    expect(await first).toBe('pw');
    const second = readHidden(stdin, out);
    stdin.push('\nnext\r\n');
    expect(await second).toBe('next');
    const third = readHidden(stdin, out);
    stdin.push('\n');
    expect(await third).toBe('');
  });

  it('Backspace as 0x08 (conhost) and 0x7f (Windows Terminal)', async () => {
    const stdin = new FakeStdin();
    const p = readHidden(stdin, fakeOut());
    stdin.push('abx\x08c');
    stdin.push('dy\x7fe\r');
    expect(await p).toBe('abcde');
  });

  it('ignores an ESC sequence whole (arrow keys), and other control characters', async () => {
    const stdin = new FakeStdin();
    const p = readHidden(stdin, fakeOut());
    stdin.push('a\x1b[Db\x1bOHc\x1b[1;5C\x01\x02\x04d\r');
    expect(await p).toBe('abcd');
  });

  it('decodes a multibyte character split across two chunks whole', async () => {
    const stdin = new FakeStdin();
    const p = readHidden(stdin, fakeOut());
    const bytes = Buffer.from('p€x\r', 'utf8');
    stdin.push(bytes.subarray(0, 2));
    stdin.push(bytes.subarray(2));
    expect(await p).toBe('p€x');
  });

  it('Ctrl+C restores the mode, pauses and rejects with exit 130', async () => {
    const stdin = new FakeStdin();
    const out = fakeOut();
    const p = readHidden(stdin, out);
    stdin.push('secret\x03');
    await expect(p).rejects.toMatchObject({ exitCode: 130 });
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.pause).toHaveBeenCalledTimes(1);
    expect(out.text()).toBe('\n');
  });

  it('the end of input rejects with exit 130 and restores the mode', async () => {
    const stdin = new FakeStdin();
    const p = readHidden(stdin, fakeOut());
    stdin.push('abc');
    stdin.emit('end');
    await expect(p).rejects.toMatchObject({ exitCode: 130 });
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.pause).toHaveBeenCalled();
  });

  it('restores raw mode and pauses after every prompt of a sequence', async () => {
    const stdin = new FakeStdin();
    for (const entry of ['one', 'two', 'three']) {
      const p = readHidden(stdin, fakeOut());
      stdin.push(`${entry}\r`);
      expect(await p).toBe(entry);
    }
    expect(stdin.setRawMode.mock.calls.flat()).toEqual([true, false, true, false, true, false]);
    expect(stdin.pause).toHaveBeenCalledTimes(3);
  });

  it('the visible reader echoes what is typed and erases on Backspace', async () => {
    const stdin = new FakeStdin();
    const out = fakeOut();
    const p = readVisible(stdin, out);
    stdin.push('ab\x7fc\r');
    expect(await p).toBe('ac');
    expect(out.text()).toBe('ab\b \bc\n');
  });
});

// ─── Rendering and the real runner ─────────────────────────────────────────────────────────────

describe('stdin, rendered and real', () => {
  it('renders standard input as <stdin: secret> unless it is marked public', () => {
    const spec = {
      cmd: 'ssh',
      args: ['umbrel', '--', 'cat > f'],
      remote: true,
      input: `${PLANTED_PASSWORD}\n`,
    };
    expect(renderSpec(spec)).toBe('ssh umbrel -- cat > f < <stdin: secret>');
    expect(renderSpec({ ...spec, input: 'use chroot = no\n', publicInput: true })).toBe(
      "ssh umbrel -- cat > f <<'STDIN'\nuse chroot = no\nSTDIN",
    );
  });

  it('the real runner hands a value to the child on stdin only (never argv or env)', async () => {
    const probe = [
      '-e',
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=process.argv[1];" +
        "process.stdout.write(JSON.stringify({stdin:s,argv:process.argv.slice(1).join(' ').includes(s.trim()),env:JSON.stringify(process.env).includes(s.trim()),v}))})",
      'marker',
    ];
    const r = await createRealRunner().exec({
      cmd: process.execPath,
      args: probe,
      input: `${PLANTED_PASSWORD}\n`,
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      stdin: `${PLANTED_PASSWORD}\n`,
      argv: false,
      env: false,
      v: 'marker',
    });
  });
});
