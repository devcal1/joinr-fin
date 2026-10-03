// `smoke mobile` (stage-9.md §7.3) on the fake host: no ssh, no docker, no curl. The host script
// is judged by its printed status lines; the pairing code and the device key never exist on the PC.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  instrumentCreateSchema,
  makeTradeInputSchema,
} from '../../../packages/schema/src/dto/investments.ts';
import {
  CLOSES_BASE_JS,
  CLOSES_COIN_NOTE,
  CORPUS_METHODS,
  EXPECTED_MIGRATIONS,
  MOBILE_CLOSES_WAIT_MS,
  MOBILE_LEAK_NEEDLES,
  SEED_INSTRUMENT,
  SEED_LISTED_INSTRUMENT,
  closesCountsJs,
  corpusScript,
  mobileScript,
  parseClosesBase,
  parseScriptLines,
  redactScript,
  seedListedTrade,
  seedTrade,
  main as smoke,
  traversalCorpus,
  zoneDate,
} from '../smoke.mjs';
import { HOME, fakeHost, remoteCommand, remoteCommands } from './helpers.mjs';

const DATA = `${HOME}/joinr-build/smoke/data`;
const BACKUP = 'manual-20300315-143200+1100.db';
const json = (body, code) => ({ stdout: `${JSON.stringify(body)}\n${code}` });

const GOOD_SCRIPT = [
  'open 201 code=ok',
  'pair 201 key=ok device=ok',
  'today 200 apiVersion=1 holdings=1 sessions=1 shape=ok',
  'periods 200 apiVersion=1 periods=7 holdings=2 shape=ok',
  'post 405 MOBILE_READ_ONLY',
  'post-periods 405 MOBILE_READ_ONLY',
  'revoke 200',
  'revoked-today 401 DEVICE_KEY_REVOKED',
  'revoked-periods 401 DEVICE_KEY_REVOKED',
  '',
].join('\n');

const CLOSES_DONE = {
  closesRuns: 1,
  status: 'succeeded',
  listedRows: 12,
  coinRows: 17,
  coinLimited: false,
};

/** The corpus answers: every request a JSON 404, except `status` overrides by index. */
function corpusAnswers(over = {}) {
  const n = traversalCorpus(BACKUP).length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    for (const m of CORPUS_METHODS)
      lines.push(`${m} ${i} ${over[`${m} ${i}`] ?? '404 application/json; charset=utf-8'}`);
  }
  return `${lines.join('\n')}\n`;
}

/** A fake Umbrel where the rc container behaves; `over` replaces replies by purpose. */
function mobileHost(over = {}) {
  let dbPolls = 0;
  let closesPolls = 0;
  return fakeHost({
    'container-state': { stdout: 'running\n' },
    'smoke-mobile-health': json({ status: 'ok', db: { migrations: EXPECTED_MIGRATIONS } }, 200),
    'smoke-mobile-nokey': json({ error: { code: 'DEVICE_KEY_MISSING', message: 'x' } }, 401),
    'smoke-mobile-seed': json({ id: 7 }, 201),
    'smoke-mobile-seed-trade': json({ trade: {} }, 201),
    'smoke-mobile-seed-listed': json({ id: 8 }, 201),
    'smoke-mobile-seed-listed-trade': json({ trade: {} }, 201),
    'smoke-mobile-closes': () => {
      closesPolls += 1;
      return {
        stdout: JSON.stringify(
          closesPolls < 4
            ? { closesRuns: 0, status: null, listedRows: 0, coinRows: 0, coinLimited: false }
            : CLOSES_DONE,
        ),
      };
    },
    'smoke-mobile-refresh': json({ summary: {} }, 200),
    'smoke-mobile-db': () => {
      dbPolls += 1;
      return {
        stdout: JSON.stringify(
          dbPolls < 3 ? { intraday: 0, dayRows: 0 } : { intraday: 1, dayRows: 1 },
        ),
      };
    },
    'smoke-mobile-script': { stdout: GOOD_SCRIPT },
    'smoke-mobile-backups': json({ backups: [{ name: BACKUP }] }, 200),
    'smoke-mobile-corpus': { stdout: corpusAnswers() },
    'smoke-mobile-modes': { stdout: '700 1000\n600 1000\n' },
    'smoke-mobile-leak': { stdout: '0\n' },
    ...over,
  });
}

describe('smoke mobile', () => {
  it('every probe passes against a behaving rc container', async () => {
    const h = mobileHost();
    expect(await smoke(['mobile'], h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).not.toMatch(/^FAIL/m);
    expect(h.out.at(-1)).toMatch(/^All \d+ mobile probes passed\.$/);
    for (const name of [
      '/api/health migrations 8',
      'GET /api/mobile/today without a key → 401 DEVICE_KEY_MISSING',
      'a made-up crypto holding seeded',
      'a listed holding seeded',
      'POST /api/prices/refresh',
      'healthy after the restart',
      'an intraday run in job_runs (the start-up run)',
      'a day row for the seeded holding',
      'a finished closes run in job_runs (the start-up run)',
      'instrument_closes rows for the seeded listed holding',
      'instrument_closes rows for the seeded coin',
      'POST /api/phone/pairing → 201 with a code',
      'POST /api/mobile/pair (no Origin) → 201 with a key',
      'GET /api/mobile/today with the key → 200 and the shape',
      'POST /api/mobile/today → 405 MOBILE_READ_ONLY',
      'GET /api/mobile/periods with the key → 200 and the shape',
      'POST /api/mobile/periods → 405 MOBILE_READ_ONLY',
      'revoke → 200',
      'the revoked key → 401 DEVICE_KEY_REVOKED',
      'the revoked key on /periods → 401 DEVICE_KEY_REVOKED',
      'the traversal corpus (64 raw requests) → 401/404/405 only',
      'devices/ 0700 and devices.json 0600, uid 1000',
    ]) {
      expect(text).toContain(`PASS  ${name}`);
    }
    for (const needle of MOBILE_LEAK_NEEDLES) {
      expect(text).toContain(`PASS  no ${JSON.stringify(needle)} in the logs`);
    }
    expect(text).not.toMatch(/^NOTE/m);
    // The database was polled until the start-up run and the day row appeared, then until the
    // closes run and its rows appeared.
    expect(h.callsFor('smoke-mobile-db')).toHaveLength(3);
    expect(h.callsFor('smoke-mobile-closes')).toHaveLength(4);
  });

  it('seeds a listed holding too, and reads the closes counts read-only (stage-10.md §7.2)', async () => {
    const h = mobileHost();
    await smoke(['mobile'], h.deps());
    const seed = h.callsFor('smoke-mobile-seed-listed')[0];
    expect(JSON.parse(seed.input)).toEqual(SEED_LISTED_INSTRUMENT);
    expect(seed.publicInput).toBe(true);
    const trade = JSON.parse(h.callsFor('smoke-mobile-seed-listed-trade')[0].input);
    expect(trade.instrumentId).toBe(8);
    const order = h.purposes();
    expect(order.indexOf('smoke-mobile-seed-listed')).toBeLessThan(
      order.indexOf('smoke-mobile-restart'),
    );
    expect(order.lastIndexOf('smoke-mobile-db')).toBeLessThan(order.indexOf('smoke-mobile-closes'));
    expect(order.lastIndexOf('smoke-mobile-closes')).toBeLessThan(
      order.indexOf('smoke-mobile-script'),
    );
    // The newest closes run id is read (read-only) before the restart; the poll counts only later runs.
    expect(order.indexOf('smoke-mobile-closes-base')).toBeLessThan(
      order.indexOf('smoke-mobile-restart'),
    );
    const baseCmd = remoteCommand(h.callsFor('smoke-mobile-closes-base')[0]);
    expect(baseCmd).toMatch(/^docker exec joinr-smoke node -e '/);
    expect(baseCmd).toContain('{ readOnly: true }');
    expect(CLOSES_BASE_JS).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|REPLACE)\b/);
    const cmd = remoteCommand(h.callsFor('smoke-mobile-closes')[0]);
    expect(cmd).toMatch(/^docker exec joinr-smoke node -e '/);
    expect(cmd).toContain('{ readOnly: true }');
    expect(cmd).toContain('AND id > 0');
    const js = closesCountsJs(3);
    expect(js).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|REPLACE)\b/);
    expect(js).toContain("job = 'closes' AND finished_at IS NOT NULL AND id > 3");
    expect(js).toContain('FROM instrument_closes');
    // Counts and words only come back: never a close value or the detail text.
    expect(js).not.toMatch(/SELECT[^"]*\b(close|value)\b[^"]*FROM/);
    expect(js).not.toMatch(/console\.log\([^)]*\bd\b/);
    // Only an integer is ever interpolated into the query.
    for (const bad of [-1, 1.5, '1', Number.NaN, '1; DROP TABLE x'])
      expect(() => closesCountsJs(bad)).toThrow();
    expect(parseClosesBase('{"n":42}\n')).toBe(42);
    for (const bad of ['', 'x', '{"n":-1}', '{"n":1.5}', '{"n":"7"}', undefined])
      expect(parseClosesBase(bad)).toBe(0);
  });

  it('judges only the closes run started after the restart, and waits for it to finish', async () => {
    // Before the restart the newest closes run is id 5 (an earlier start-up run that already wrote
    // the listed rows). After the restart, until the new run finishes, no run above 5 has
    // finished: the listed rows are there, the coin's not yet. The poll must keep waiting.
    let polls = 0;
    const h = mobileHost({
      'smoke-mobile-closes-base': { stdout: '{"n":5}\n' },
      'smoke-mobile-closes': () => {
        polls += 1;
        return {
          stdout: JSON.stringify(
            polls < 6
              ? { closesRuns: 0, status: null, listedRows: 12, coinRows: 0, coinLimited: false }
              : CLOSES_DONE,
          ),
        };
      },
    });
    expect(await smoke(['mobile'], h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).not.toMatch(/^(FAIL|NOTE)/m);
    expect(text).toContain('PASS  instrument_closes rows for the seeded coin');
    expect(h.callsFor('smoke-mobile-closes')).toHaveLength(6);
    for (const c of h.callsFor('smoke-mobile-closes'))
      expect(remoteCommand(c)).toContain('AND id > 5');
  });

  describe('the closes counts on a database (node:sqlite, read-only)', () => {
    /** Runs the counts script against a temp database built by `fill`, returning its JSON. */
    function countsOn(afterId, fill) {
      const dir = mkdtempSync(join(tmpdir(), 'joinr-smoke-closes-'));
      const file = join(dir, 'finance.db');
      try {
        const db = new DatabaseSync(file);
        db.exec(
          [
            'CREATE TABLE job_runs (id INTEGER PRIMARY KEY, job TEXT, status TEXT, detail_json TEXT, error TEXT, finished_at TEXT);',
            'CREATE TABLE instruments (id INTEGER PRIMARY KEY, symbol TEXT);',
            'CREATE TABLE instrument_closes (instrument_id INTEGER, date TEXT);',
          ].join(' '),
        );
        db.prepare('INSERT INTO instruments (id, symbol) VALUES (1, ?), (2, ?)').run(
          SEED_LISTED_INSTRUMENT.symbol,
          SEED_INSTRUMENT.symbol,
        );
        fill(db);
        db.close();
        const js = closesCountsJs(afterId).replace('/data/finance.db', file.replace(/\\/g, '/'));
        const out = execFileSync(process.execPath, ['-e', js], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return JSON.parse(out);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const run = (db, id, detail, finished = true) =>
      db
        .prepare(
          'INSERT INTO job_runs (id, job, status, detail_json, finished_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          id,
          'closes',
          'partial',
          JSON.stringify(detail),
          finished ? '2030-03-15T03:00:00Z' : null,
        );

    it('a failed coin is never taken for a rate limit, whatever digits the counts hold', () => {
      // Made-up counts: one that contains "429" must not turn a failure into a NOTE.
      const c = countsOn(0, (db) =>
        run(db, 1, { rows: 1429, coingecko: { ok: 0, failed: 1, skipped: 0 } }),
      );
      expect(c).toMatchObject({ closesRuns: 1, coinRows: 0, coinLimited: false });
    });

    it('a skipped coin (a 429 or a cool-down) is a rate limit', () => {
      const c = countsOn(0, (db) =>
        run(db, 1, { left: 1, coingecko: { ok: 0, failed: 0, skipped: 1 } }),
      );
      expect(c.coinLimited).toBe(true);
    });

    it('counts and judges only the runs after the base id', () => {
      const c = countsOn(5, (db) => {
        run(db, 5, { coingecko: { ok: 0, failed: 0, skipped: 1 } });
        run(db, 6, { coingecko: { ok: 0, failed: 0, skipped: 0 } }, false);
        db.prepare('INSERT INTO instrument_closes (instrument_id, date) VALUES (1, ?)').run(
          '2030-03-14',
        );
      });
      expect(c).toEqual({
        closesRuns: 0,
        status: null,
        listedRows: 1,
        coinRows: 0,
        coinLimited: false,
      });
    });
  });

  it('the coin part is a non-fatal NOTE when CoinGecko throttled the closes run', async () => {
    const limited = { ...CLOSES_DONE, coinRows: 0, coinLimited: true };
    const h = mobileHost({ 'smoke-mobile-closes': { stdout: JSON.stringify(limited) } });
    expect(await smoke(['mobile'], h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain(`NOTE  ${CLOSES_COIN_NOTE}`);
    expect(text).not.toMatch(/^FAIL/m);
    expect(h.out.at(-1)).toMatch(/^All \d+ mobile probes passed \(1 NOTE: see above\)\.$/);
    // Without the throttling sign, no coin rows is a failure.
    const h2 = mobileHost({
      'smoke-mobile-closes': { stdout: JSON.stringify({ ...limited, coinLimited: false }) },
    });
    expect(await smoke(['mobile'], h2.deps())).toBe(1);
    expect(h2.out.join('\n')).toMatch(/FAIL {2}instrument_closes rows for the seeded coin/);
  });

  it('fails when no closes run finishes within the wait, or it wrote no listed rows (never a NOTE)', async () => {
    // No run after the restart finishes, even with listed rows from an earlier run: polled to the
    // deadline (≤ 240 s after the restart, 5 s apart), then a FAIL.
    const none = { closesRuns: 0, status: null, listedRows: 12, coinRows: 0, coinLimited: false };
    const h = mobileHost({ 'smoke-mobile-closes': { stdout: JSON.stringify(none) } });
    expect(await smoke(['mobile'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toMatch(/FAIL {2}a finished closes run in job_runs/);
    const polls = h.callsFor('smoke-mobile-closes').length;
    expect(polls).toBeGreaterThan(10);
    expect(polls).toBeLessThanOrEqual(MOBILE_CLOSES_WAIT_MS / 5_000 + 1);
    // The new run finished without listed rows: judged at once, a FAIL even with the coin skipped.
    const h2 = mobileHost({
      'smoke-mobile-closes': {
        stdout: JSON.stringify({ ...CLOSES_DONE, listedRows: 0, coinLimited: true }),
      },
    });
    expect(await smoke(['mobile'], h2.deps())).toBe(1);
    expect(h2.out.join('\n')).toMatch(
      /FAIL {2}instrument_closes rows for the seeded listed holding/,
    );
    expect(h2.callsFor('smoke-mobile-closes')).toHaveLength(1);
  });

  it('fails when the periods answer is short of seven periods, misshaped, or POST is not 405', async () => {
    for (const [from, to] of [
      [
        'periods 200 apiVersion=1 periods=7 holdings=2 shape=ok',
        'periods 200 apiVersion=1 periods=6 holdings=2 shape=ok',
      ],
      [
        'periods 200 apiVersion=1 periods=7 holdings=2 shape=ok',
        'periods 200 apiVersion=1 periods=7 holdings=2 shape=missing',
      ],
      ['periods 200 apiVersion=1 periods=7 holdings=2 shape=ok', 'periods 404 NOT_FOUND'],
      ['post-periods 405 MOBILE_READ_ONLY', 'post-periods 401 DEVICE_KEY_MISSING'],
      ['revoked-periods 401 DEVICE_KEY_REVOKED', 'revoked-periods 200'],
    ]) {
      const h = mobileHost({ 'smoke-mobile-script': { stdout: GOOD_SCRIPT.replace(from, to) } });
      expect(await smoke(['mobile'], h.deps())).toBe(1);
    }
  });

  it('seeds through the API (bodies on stdin), restarts, then reads the database read-only', async () => {
    const h = mobileHost();
    await smoke(['mobile'], h.deps());
    const seed = h.callsFor('smoke-mobile-seed')[0];
    expect(remoteCommand(seed)).toBe(
      "curl -s -w '\\n%{http_code}' -X POST -H 'content-type: application/json' --data-binary @- 'http://127.0.0.1:4939/api/instruments'",
    );
    expect(JSON.parse(seed.input)).toEqual(SEED_INSTRUMENT);
    expect(seed.publicInput).toBe(true);
    const trade = JSON.parse(h.callsFor('smoke-mobile-seed-trade')[0].input);
    expect(trade.instrumentId).toBe(7);
    expect(remoteCommand(h.callsFor('smoke-mobile-restart')[0])).toBe('docker restart joinr-smoke');
    const order = h.purposes();
    expect(order.indexOf('smoke-mobile-refresh')).toBeLessThan(
      order.indexOf('smoke-mobile-restart'),
    );
    expect(order.indexOf('smoke-mobile-restart')).toBeLessThan(order.indexOf('smoke-mobile-db'));
    expect(order.indexOf('smoke-mobile-db')).toBeLessThan(order.indexOf('smoke-mobile-script'));
    const db = remoteCommand(h.callsFor('smoke-mobile-db')[0]);
    expect(db).toMatch(/^docker exec joinr-smoke node -e '/);
    expect(db).toContain('{ readOnly: true }');
    expect(db).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP)\b/);
    expect(remoteCommand(h.callsFor('smoke-mobile-modes')[0])).toBe(
      `stat -c '%a %u' '${DATA}/devices' '${DATA}/devices/devices.json'`,
    );
  });

  it('a re-run finds the holding there (409) and still passes the seed step', async () => {
    const h = mobileHost({
      'smoke-mobile-seed': json({ error: { code: 'CONFLICT', message: 'x' } }, 409),
    });
    expect(await smoke(['mobile'], h.deps())).toBe(0);
    expect(h.callsFor('smoke-mobile-seed-trade')).toHaveLength(0);
    expect(h.out.join('\n')).toContain('PASS  a made-up crypto holding seeded — already there');
  });

  it('the secrets stay in the host script: never in argv, the key on curl’s stdin', async () => {
    const h = mobileHost();
    await smoke(['mobile'], h.deps());
    const call = h.callsFor('smoke-mobile-script')[0];
    expect(remoteCommand(call)).toBe('sh -s');
    // Not public: the runner prints "<stdin: secret>" for it, never its text.
    expect(call.publicInput).toBeUndefined();
    const script = call.input;
    expect(script).toBe(mobileScript());
    expect(script).toContain(
      `printf 'header = "Authorization: Bearer %s"\\n' "$key" | curl -s --config -`,
    );
    expect(script).toContain(`printf '{"code":"%s",`);
    expect(script).toContain('--data-binary @-');
    // The key and the code are never on a curl command line, and never echoed.
    for (const line of script.split('\n')) {
      if (/curl /.test(line) && !/--config -|--data-binary @-/.test(line)) {
        expect(line).not.toMatch(/\$key|\$code/);
      }
      // An echo prints status words only: a secret appears there only inside okword (ok/missing).
      if (/^\s*echo /.test(line)) {
        const shown = line.replace(/\$\(okword "\$(key|code|id)"\)/g, '');
        expect(shown).not.toMatch(/\$key|\$code|\$body|\$resp/);
      }
    }
    expect(script).toMatch(/^exec 2>\/dev\/null\n/);
    expect(script).not.toMatch(/set -x/);
    // Nothing with a key or a code went anywhere else.
    for (const c of h.calls) {
      // (The leak probe's needle is the prefix alone; a whole key would be jfk_ + 43 characters.)
      expect(JSON.stringify(c.args ?? [])).not.toMatch(/jfk_[A-Za-z0-9_-]/);
    }
  });

  it('fails (exit 1) when the revoked key still answers, and says which probe failed', async () => {
    const h = mobileHost({
      'smoke-mobile-script': {
        stdout: GOOD_SCRIPT.replace('revoked-today 401 DEVICE_KEY_REVOKED', 'revoked-today 200'),
      },
    });
    expect(await smoke(['mobile'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toMatch(/FAIL {2}the revoked key → 401 DEVICE_KEY_REVOKED/);
  });

  it('fails when the today shape is missing a field, or no holding has a session', async () => {
    for (const line of [
      'today 200 apiVersion=1 holdings=1 sessions=1 shape=missing',
      'today 200 apiVersion=1 holdings=1 sessions=0 shape=ok',
      'today 401 DEVICE_KEY_INVALID',
    ]) {
      const h = mobileHost({
        'smoke-mobile-script': {
          stdout: GOOD_SCRIPT.replace(
            'today 200 apiVersion=1 holdings=1 sessions=1 shape=ok',
            line,
          ),
        },
      });
      expect(await smoke(['mobile'], h.deps())).toBe(1);
    }
  });

  it('the corpus fails on a 200, on the SPA (text/html) or on a missing answer', async () => {
    for (const over of [{ 'GET 0': '200 application/json' }, { 'GET 6': '404 text/html' }]) {
      const h = mobileHost({ 'smoke-mobile-corpus': { stdout: corpusAnswers(over) } });
      expect(await smoke(['mobile'], h.deps())).toBe(1);
      expect(h.out.join('\n')).toMatch(/FAIL {2}the traversal corpus/);
    }
    const short = corpusAnswers().split('\n').slice(1).join('\n');
    const h = mobileHost({ 'smoke-mobile-corpus': { stdout: short } });
    expect(await smoke(['mobile'], h.deps())).toBe(1);
  });

  it('fails when the start-up run or the day row never appears (after the wait)', async () => {
    const h = mobileHost({ 'smoke-mobile-db': { stdout: '{"intraday":0,"dayRows":0}' } });
    expect(await smoke(['mobile'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toMatch(/FAIL {2}an intraday run in job_runs/);
    expect(h.callsFor('smoke-mobile-db').length).toBeGreaterThan(10);
  });

  it('fails on a leak count, a bad mode or a missing migration', async () => {
    for (const over of [
      { 'smoke-mobile-leak': { stdout: '2\n' } },
      { 'smoke-mobile-modes': { stdout: '755 1000\n644 1000\n' } },
      { 'smoke-mobile-health': json({ status: 'ok', db: { migrations: 6 } }, 200) },
    ]) {
      expect(await smoke(['mobile'], mobileHost(over).deps())).toBe(1);
    }
  });

  it('refuses when the smoke container is not running', async () => {
    const h = mobileHost({ 'container-state': { code: 1, stderr: 'Error: No such object' } });
    await expect(smoke(['mobile'], h.deps())).rejects.toThrow(/run `smoke start` first/);
  });

  it('--dry-run prints the script with every variable redacted and runs nothing', async () => {
    const h = fakeHost();
    expect(await smoke(['--dry-run', 'mobile'], h.deps())).toBe(0);
    expect(h.calls).toHaveLength(0);
    const text = h.out.join('\n');
    expect(text).toContain('the host script for open → pair → today → periods → POST → revoke');
    expect(text).toContain('<redacted>');
    expect(text).not.toMatch(/"\$(key|code|id|body|resp|st)"/);
    expect(text).toContain('sh -s < <stdin: secret>');
    expect(text).toContain('(dry run: nothing was run, so no probe was judged)');
  });
});

describe('the mobile helpers', () => {
  it('the seed bodies are valid requests', () => {
    const now = new Date(Date.UTC(2030, 2, 15, 3, 0, 0));
    expect(instrumentCreateSchema.safeParse(SEED_INSTRUMENT).success).toBe(true);
    const schema = makeTradeInputSchema(() => now);
    expect(schema.safeParse(seedTrade(7, zoneDate(now, 7))).success).toBe(true);
    expect(instrumentCreateSchema.safeParse(SEED_LISTED_INSTRUMENT).success).toBe(true);
    expect(schema.safeParse(seedListedTrade(8, zoneDate(now, 7))).success).toBe(true);
  });

  it('zoneDate is the server zone’s date', () => {
    // 15/03/2030 13:30Z is already 16/03 in Melbourne (AEDT, +11).
    expect(zoneDate(new Date(Date.UTC(2030, 2, 15, 13, 30)))).toBe('2030-03-16');
    expect(zoneDate(new Date(Date.UTC(2030, 2, 15, 13, 30)), 7)).toBe('2030-03-09');
  });

  it('the corpus is the §6.10 list with a backup name, each with four methods', () => {
    const c = traversalCorpus(BACKUP);
    expect(c).toHaveLength(16);
    expect(c).toContain('/api/mobile\\..\\backups');
    // Stage 10 (stage-10.md §6.6): the periods path.
    for (const p of [
      '/api/mobile/periods/../backups',
      '/api/mobile/periods%2f..%2fbackups',
      '/api/mobile/periods/..;/status',
    ]) {
      expect(c).toContain(p);
    }
    expect(c.at(-1)).toBe('/api/mobile/../backups/manual-20300315-143200%2B1100.db');
    const script = corpusScript(c);
    expect(script.match(/curl --path-as-is/g)).toHaveLength(64);
    expect(script).toContain(
      "printf '%s %s ' HEAD 0; curl --path-as-is -s -o /dev/null --head -w '%{http_code} %{content_type}\\n' 'http://127.0.0.1:4939/api/mobile/../backups'",
    );
    expect(script).toContain(
      "-X DELETE -w '%{http_code} %{content_type}\\n' 'http://127.0.0.1:4939/api/mobile/;/../backups'",
    );
  });

  it('redactScript hides every expansion but keeps sed’s own $d', () => {
    const r = redactScript(`x=$(printf '%s' "$resp" | sed '$d'); echo "$st" \${key} $id`);
    expect(r).toBe(`x=$(printf '%s' <redacted> | sed '$d'); echo <redacted> <redacted> <redacted>`);
  });

  it('parseScriptLines reads the status words', () => {
    expect(parseScriptLines('open 201 code=ok\npair 409\n')).toEqual({
      open: ['201', 'code=ok'],
      pair: ['409'],
    });
  });

  it('never names a host, an address or a real key', () => {
    const all = `${mobileScript()}${corpusScript(traversalCorpus(BACKUP))}`;
    expect(all).not.toMatch(/jfk_[A-Za-z0-9_-]{43}/);
    expect(remoteCommands([])).toEqual([]);
    for (const ip of all.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
      expect(ip).toBe('127.0.0.1');
    }
  });
});
