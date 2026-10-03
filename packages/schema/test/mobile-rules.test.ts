// The Stage 9 phone-app contract (stage-9.md §3.4, §3.5, §4.4, §4.5): the constants, the holding
// keys, the pairing URL and its rules over the shared case table (the Kotlin parser iterates the
// same table), the server-address kinds, the fixed sentences byte-exact, the appended enums and
// codes, and the explicit-zone date helpers across both DST changes; Stage 10's period and closes
// constants and enums (stage-10.md §3.5). Test hosts only: `umbrel`,
// `127.0.0.1`, `example.test`, `umbrel.example-tailnet.ts.net` and RFC 5737 addresses; the CGNAT
// and RFC 1918 addresses are built from octet arrays (the privacy guard flags such literals).
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  BULLION_HOLDINGS,
  CLOSE_SOURCES,
  DAY_STATUSES,
  DEVICE_ID_RE,
  INSTRUMENT_KINDS,
  INTRADAY_BULLION_WINDOW,
  JOB_NAMES,
  LINE_MAX_POINTS,
  MARKET_SERIES,
  MARKET_STATES,
  MOBILE_ERROR_MESSAGES,
  MOBILE_HOLDING_KINDS,
  MOBILE_KEY_RE,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PERIOD_STATUSES,
  SERVER_PERIODS,
  SOLD_HOLDINGS_KEY,
  dateInZone,
  holdingKey,
  normalisePairingCode,
  normaliseServerUrl,
  pairingUrl,
  parsePairingUrl,
  serverAddressKind,
  startOfDayInZone,
  wallTimeInZone,
  type MobilePeriod,
  type PeriodStatus,
  type ServerAddressKind,
  type ServerPeriod,
} from '../src/index';
import * as mobile from '../src/mobile';
import { FIXTURE_DEVICE_KEY, pairingUrlCases } from '../src/fixtures/index';

const NEW_CODES = [
  'DEVICE_KEY_MISSING',
  'DEVICE_KEY_INVALID',
  'DEVICE_KEY_REVOKED',
  'MOBILE_RATE_LIMITED',
  'MOBILE_READ_ONLY',
  'PAIRING_CODE_INVALID',
  'PAIRING_RATE_LIMITED',
  'PHONE_LIMIT_REACHED',
  'PHONE_STORE_FAILED',
] as const;

describe('constants (§3.4)', () => {
  it('has the frozen values', () => {
    expect(mobile.MOBILE_API_VERSION).toBe(1);
    expect(mobile.MOBILE_KEY_PREFIX).toBe('jfk_');
    expect(PAIRING_CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_LENGTH).toBe(10);
    expect(PAIRING_CODE_TTL_MS).toBe(300_000);
    expect([mobile.PAIRING_MAX_FAILURES, mobile.PAIRING_RATE_MAX]).toEqual([5, 20]);
    expect([mobile.PAIRING_RATE_WINDOW_MS, mobile.BAD_KEY_RATE_WINDOW_MS]).toEqual([
      600_000, 600_000,
    ]);
    expect([mobile.PAIR_BODY_LIMIT_BYTES, mobile.BAD_KEY_RATE_MAX]).toEqual([1024, 60]);
    expect([
      mobile.MOBILE_MAX_DEVICES,
      mobile.MOBILE_KEEP_REMOVED,
      mobile.DEVICE_LABEL_MAX,
    ]).toEqual([10, 20, 40]);
    expect([mobile.DEVICE_LAST_USED_FLUSH_MS, mobile.LAST_PAIRED_SHOWN_MS]).toEqual([
      600_000, 600_000,
    ]);
    expect(mobile.PAIR_URL_SCHEME).toBe('joinrfinance');
    expect(mobile.ASX_OPEN).toEqual({ hour: 10, minute: 0 });
    expect(mobile.ASX_CLOSE).toEqual({ hour: 16, minute: 12 });
    expect(mobile.ASX_PRE_OPEN).toEqual({ hour: 7, minute: 0 });
    expect(mobile.ASX_HOLIDAY_GRACE).toEqual({ hour: 10, minute: 30 });
    expect(mobile.INTRADAY_ASX_WINDOW).toEqual({
      from: { hour: 10, minute: 0 },
      to: { hour: 16, minute: 25 },
    });
    expect([mobile.INTRADAY_STEP_MIN, mobile.INTRADAY_CRYPTO_EVERY_MIN]).toEqual([5, 15]);
    expect(INTRADAY_BULLION_WINDOW).toEqual({
      from: { weekday: 1, hour: 6, minute: 0 },
      to: { weekday: 6, hour: 10, minute: 0 },
    });
    expect(mobile.INTRADAY_SLOT_OFFSET_MS).toBe(20_000);
    expect(mobile.INTRADAY_STARTUP_DELAY_MS).toBe(30_000);
    expect(mobile.INTRADAY_RUN_DEADLINE_MS).toBe(240_000);
    expect(mobile.INTRADAY_WAKE_MAX_MS).toBe(3_600_000);
    expect(mobile.COIN_CHART_SPACING_MS).toBe(2_000);
    expect([mobile.DAY_POINTS_MAX, LINE_MAX_POINTS, mobile.PORTFOLIO_LINE_STEP_MIN]).toEqual([
      400, 120, 5,
    ]);
  });

  it('has the bullion holdings with the pricing series ids (D148)', () => {
    expect(Object.keys(BULLION_HOLDINGS)).toEqual(['silver', 'gold']);
    expect(BULLION_HOLDINGS.gold).toEqual({
      key: 'bullion-gold',
      code: 'GOLD',
      name: 'Gold bullion',
      symbol: 'GC=F',
      futuresSeries: 'GC_USD_OZ',
      spotSeries: 'XAU_AUD_OZ',
    });
    expect(BULLION_HOLDINGS.silver.key).toBe('bullion-silver');
    for (const def of Object.values(BULLION_HOLDINGS)) {
      expect(MARKET_SERIES[def.futuresSeries].yahoo).toBe(def.symbol);
      expect(MARKET_SERIES[def.spotSeries].derivedFrom).toEqual([def.futuresSeries, 'AUDUSD']);
    }
  });

  it('keys an instrument holding i<id>', () => {
    expect(holdingKey(12)).toBe('i12');
    expect(holdingKey(1)).not.toBe(BULLION_HOLDINGS.gold.key);
  });

  it('matches the fake key and device ids only', () => {
    expect(MOBILE_KEY_RE.test(FIXTURE_DEVICE_KEY)).toBe(true);
    expect(MOBILE_KEY_RE.test(`jfk_${'A'.repeat(42)}`)).toBe(false);
    expect(MOBILE_KEY_RE.test(`jfk_${'A'.repeat(44)}`)).toBe(false);
    expect(MOBILE_KEY_RE.test(`jfk_${'A'.repeat(42)}=`)).toBe(false);
    expect(MOBILE_KEY_RE.test(`JFK_${'A'.repeat(43)}`)).toBe(false);
    expect(DEVICE_ID_RE.test('d_0000000000000001')).toBe(true);
    expect(DEVICE_ID_RE.test('d_000000000000000A')).toBe(false);
    expect(DEVICE_ID_RE.test('d_00000000000000001')).toBe(false);
  });
});

describe('enums and error codes (§3.5)', () => {
  it("appends 'intraday', the day statuses, the market states and the holding kinds", () => {
    // Stage 10 appends 'closes' after it (the Stage 10 block below).
    expect(JOB_NAMES.at(-2)).toBe('intraday');
    expect(DAY_STATUSES).toEqual(['ok', 'no_base', 'manual', 'stale', 'unpriced']);
    expect(MARKET_STATES).toEqual(['open', 'pre_open', 'closed']);
    expect(MOBILE_HOLDING_KINDS).toEqual([...INSTRUMENT_KINDS, 'bullion']);
    expect(INSTRUMENT_KINDS).not.toContain('bullion');
  });

  it('appends the nine Stage 9 codes, each with its fixed sentence (§4.5)', () => {
    expect(API_ERROR_CODES.slice(-9)).toEqual([...NEW_CODES]);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect(Object.keys(MOBILE_ERROR_MESSAGES)).toEqual([...NEW_CODES]);
    expect(MOBILE_ERROR_MESSAGES).toEqual({
      DEVICE_KEY_MISSING: "This request needs the phone's key. Pair the phone in Settings → Phone.",
      DEVICE_KEY_INVALID:
        "This server does not know this phone's key. Pair the phone again in Settings → Phone.",
      DEVICE_KEY_REVOKED: 'This phone was removed in Settings → Phone. Pair it again to use it.',
      MOBILE_RATE_LIMITED: 'Too many requests with an unknown key. Try again in 10 minutes.',
      MOBILE_READ_ONLY: 'The phone app can only read. Nothing was changed.',
      PAIRING_CODE_INVALID:
        'The pairing code is wrong or has expired. Show a new code in Settings → Phone.',
      PAIRING_RATE_LIMITED: 'Too many pairing attempts. Wait 10 minutes, then show a new code.',
      PHONE_LIMIT_REACHED: 'Ten phones are paired already. Remove one in Settings → Phone first.',
      PHONE_STORE_FAILED:
        'The list of phones could not be saved on the server. Nothing was changed.',
    });
    for (const message of Object.values(MOBILE_ERROR_MESSAGES))
      expect(message).not.toMatch(/\d{3}/);
  });
});

describe('the pairing URL (§4.4)', () => {
  it('builds the frozen example', () => {
    expect(pairingUrl('http://umbrel:4932', 'ABCDE12345')).toBe(
      'joinrfinance://pair?v=1&u=http%3A%2F%2Fumbrel%3A4932&c=ABCDE12345',
    );
  });

  it('round-trips every accepted origin and code', () => {
    for (const url of [
      'http://umbrel:4932',
      'https://umbrel.example-tailnet.ts.net',
      'http://127.0.0.1:3001',
    ]) {
      expect(parsePairingUrl(pairingUrl(url, 'ABCDE12345'))).toEqual({
        serverUrl: url,
        code: 'ABCDE12345',
      });
    }
  });

  it.each(pairingUrlCases.parsePairingUrl.map((c) => [c.input.slice(0, 80), c] as const))(
    'parsePairingUrl %s',
    (_label, c) => {
      expect(parsePairingUrl(c.input)).toEqual(c.expected);
    },
  );

  it.each(pairingUrlCases.normaliseServerUrl.map((c) => [c.raw, c] as const))(
    'normaliseServerUrl %j',
    (_label, c) => {
      expect(normaliseServerUrl(c.raw)).toEqual(c.expected);
    },
  );

  it.each(pairingUrlCases.normalisePairingCode.map((c) => [c.raw, c] as const))(
    'normalisePairingCode %j',
    (_label, c) => {
      expect(normalisePairingCode(c.raw)).toEqual(c.expected);
    },
  );

  it('covers accepted and refused cases in every table', () => {
    for (const table of Object.values(pairingUrlCases)) {
      const outcomes = table.map(
        (c) =>
          c.expected === null ||
          (typeof c.expected === 'object' && 'ok' in c.expected && !c.expected.ok),
      );
      expect(outcomes).toContain(true);
      expect(outcomes).toContain(false);
    }
  });

  it('never throws, whatever it is given', () => {
    const junk: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '%',
      '%E0%A4%A',
      'joinrfinance://',
      '\u0000',
      'x'.repeat(10_000),
    ];
    for (const value of junk) {
      expect(() => parsePairingUrl(value as string)).not.toThrow();
      expect(() => normaliseServerUrl(value as string)).not.toThrow();
      expect(() => normalisePairingCode(value as string)).not.toThrow();
      expect(() => serverAddressKind(value as string)).not.toThrow();
      expect(parsePairingUrl(value as string)).toBeNull();
    }
  });
});

describe('serverAddressKind (§3.4)', () => {
  // Built from octets: the privacy guard flags dotted literals outside loopback and RFC 5737.
  const ip = (a: number, b: number, c: number, d: number) => [a, b, c, d].join('.');
  const cases: [string, ServerAddressKind][] = [
    ['http://umbrel.example-tailnet.ts.net:4932', 'tailscale'],
    [`http://${ip(100, 64, 0, 1)}:4932`, 'tailscale'],
    [`http://${ip(100, 127, 255, 254)}`, 'tailscale'],
    [`http://${ip(100, 128, 0, 1)}`, 'other'],
    [`http://${ip(100, 63, 0, 1)}`, 'other'],
    ['http://umbrel:4932', 'short_name'],
    ['http://UMBREL', 'short_name'],
    ['http://umbrel.local:4932', 'lan'],
    ['http://umbrel.lan', 'lan'],
    ['http://umbrel.home.arpa', 'lan'],
    [`http://${ip(10, 1, 2, 3)}`, 'lan'],
    [`http://${ip(172, 16, 0, 1)}`, 'lan'],
    [`http://${ip(172, 31, 255, 1)}`, 'lan'],
    [`http://${ip(172, 32, 0, 1)}`, 'other'],
    [`http://${ip(192, 168, 1, 2)}:4932`, 'lan'],
    ['http://localhost:3001', 'loopback'],
    ['http://127.0.0.1:3001', 'loopback'],
    [`http://${ip(127, 1, 2, 3)}`, 'loopback'],
    ['http://[::1]:3001', 'loopback'],
    ['https://example.test', 'other'],
    ['http://192.0.2.10', 'other'],
    ['not a url', 'other'],
    ['', 'other'],
  ];
  it.each(cases)('%s → %s', (url, kind) => {
    expect(serverAddressKind(url)).toBe(kind);
  });
});

describe('explicit-zone dates (§2.1)', () => {
  const MEL = 'Australia/Melbourne';
  it('reads the zone, never the process', () => {
    // 03/10/2026 14:00Z is 00:00 AEST on Sunday 04/10 (the day DST starts at 02:00).
    expect(dateInZone(Date.UTC(2026, 9, 3, 14), MEL)).toBe('2026-10-04');
    expect(dateInZone(Date.UTC(2026, 9, 3, 13, 59), MEL)).toBe('2026-10-03');
    expect(wallTimeInZone(Date.UTC(2026, 9, 3, 16), MEL)).toEqual({
      date: '2026-10-04',
      hour: 3,
      minute: 0,
      second: 0,
      weekday: 0,
    });
    expect(wallTimeInZone(Date.UTC(2026, 9, 3, 15, 59), MEL)?.hour).toBe(1);
    expect(dateInZone(Date.UTC(2030, 8, 11, 20), 'America/New_York')).toBe('2030-09-11');
    expect(dateInZone(0, 'Not/AZone')).toBeNull();
    expect(dateInZone(Number.NaN, MEL)).toBeNull();
  });

  it('finds 00:00 on both DST change days (a 23-hour and a 25-hour day)', () => {
    expect(startOfDayInZone('2026-10-04', MEL)).toBe(Date.UTC(2026, 9, 3, 14));
    expect(startOfDayInZone('2026-10-05', MEL)).toBe(Date.UTC(2026, 9, 4, 13));
    expect(startOfDayInZone('2027-04-04', MEL)).toBe(Date.UTC(2027, 3, 3, 13));
    expect(startOfDayInZone('2027-04-05', MEL)).toBe(Date.UTC(2027, 3, 4, 14));
    expect(startOfDayInZone('2030-09-12', 'Australia/Sydney')).toBe(Date.UTC(2030, 8, 11, 14));
    expect(startOfDayInZone('2030-09-11', 'America/New_York')).toBe(Date.UTC(2030, 8, 11, 4));
    expect(startOfDayInZone('2026-13-01', MEL)).toBeNull();
    expect(startOfDayInZone('2026-10-04', 'Not/AZone')).toBeNull();
  });

  it('gives Melbourne and Sydney the same local times on every DST change 2026–2030', () => {
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2031, 0, 1); ms += 3_600_000 * 6) {
      expect(wallTimeInZone(ms, MEL)).toEqual(wallTimeInZone(ms, 'Australia/Sydney'));
    }
  });
});

describe('Stage 10: periods and closes (stage-10.md §3.5)', () => {
  it('has the frozen periods, spans and keys', () => {
    expect(mobile.MOBILE_PERIODS).toEqual(['1D', '1W', '2W', '1M', '3M', '6M', '12M', 'ALL']);
    expect(SERVER_PERIODS).toEqual(['1W', '2W', '1M', '3M', '6M', '12M', 'ALL']);
    expect(SERVER_PERIODS).toEqual(mobile.MOBILE_PERIODS.slice(1));
    expect(mobile.PERIOD_SPANS).toEqual({
      '1W': { days: 7 },
      '2W': { days: 14 },
      '1M': { months: 1 },
      '3M': { months: 3 },
      '6M': { months: 6 },
      '12M': { months: 12 },
    });
    expect(mobile.PERIOD_START_MAX_GAP_DAYS).toBe(10);
    expect(mobile.PERIOD_HOLDING_POINTS).toBe(40);
    expect(SOLD_HOLDINGS_KEY).toBe('sold');
    // Never a holding key: 'i<id>' or a bullion key.
    expect(SOLD_HOLDINGS_KEY).not.toMatch(/^i\d+$/);
    for (const def of Object.values(BULLION_HOLDINGS)) expect(def.key).not.toBe(SOLD_HOLDINGS_KEY);
    const one: MobilePeriod = '1D';
    const all: ServerPeriod = 'ALL';
    expect([one, all]).toEqual(['1D', 'ALL']);
  });

  it('has the frozen closes-job constants', () => {
    expect(mobile.CLOSES_RUN_AT).toEqual({ hour: 16, minute: 52 });
    // Off the 15-minute intraday grid; follow-ups on xx:07, xx:22, xx:37, xx:52.
    expect(mobile.CLOSES_RUN_AT.minute % 15).toBe(mobile.CLOSES_SLOT_MINUTE_OFFSET);
    expect(mobile.CLOSES_SLOT_MINUTE_OFFSET).toBe(7);
    expect(mobile.CLOSES_COIN_SLOT_GUARD_MS).toBe(45_000);
    expect(mobile.CLOSES_STARTUP_DELAY_MS).toBe(120_000);
    expect(mobile.CLOSES_RUN_DEADLINE_MS).toBe(600_000);
    expect(mobile.CLOSES_FOLLOW_UP_MS).toBe(1_800_000);
    expect(mobile.CLOSES_FOLLOW_UPS_MAX).toBe(6);
    expect([mobile.CLOSES_LEAD_DAYS, mobile.CLOSES_TOPUP_OVERLAP_DAYS]).toEqual([10, 10]);
    expect([mobile.CLOSES_YAHOO_SPACING_MS, mobile.CLOSES_COIN_SPACING_MS]).toEqual([
      1_500, 15_000,
    ]);
    expect(mobile.CLOSES_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect([mobile.COINGECKO_HISTORY_DAYS, mobile.COINGECKO_HOURLY_DAYS]).toEqual([364, 90]);
    expect(mobile.CLOSES_COIN_POINT_MAX_AGE_MS).toBe(36 * 3_600_000);
    expect(mobile.CLOSES_COIN_DAILY_WINDOW_MS).toBe(14 * 3_600_000);
    expect(mobile.CLOSES_BULLION_UNDATED_DAYS).toBe(380);
    expect(mobile.CLOSES_STALE_NOTE_DAYS).toBe(6);
    expect(mobile.PERIODS_ANSWER_BUDGET_BYTES).toBe(350_000);
  });

  it("appends 'closes' to the jobs and adds the period statuses and close sources", () => {
    expect(JOB_NAMES.slice(-2)).toEqual(['intraday', 'closes']);
    expect(JOB_NAMES.at(-1)).toBe('closes');
    expect(new Set(JOB_NAMES).size).toBe(JOB_NAMES.length);
    expect(PERIOD_STATUSES).toEqual(['ok', 'no_start', 'split', 'unpriced', 'no_cost']);
    const status: PeriodStatus = 'no_start';
    expect(PERIOD_STATUSES).toContain(status);
    expect(CLOSE_SOURCES).toEqual(['yahoo', 'coingecko', 'derived', 'midnight', 'fake']);
  });

  it('adds no error code (the Stage 9 codes stay last)', () => {
    expect(API_ERROR_CODES.slice(-9)).toEqual([...NEW_CODES]);
  });
});
