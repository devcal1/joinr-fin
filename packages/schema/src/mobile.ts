// Stage 9 phone app (stage-9.md §3.4, §4.4, §4.5, FROZEN): the constants, the holding keys, the
// pairing URL and its rules, the server-address kind and the fixed error sentences, plus the
// explicit-zone date helpers the day-change engine and the server share (the engine may not call
// Intl itself). Plain constants and pure functions; no imports but the enums, so the web bundle,
// the engine and the server can all use them. Every rule function NEVER THROWS.
import type { Metal } from './enums';

export const MOBILE_API_VERSION = 1;
export const MOBILE_KEY_PREFIX = 'jfk_';
/** 32 random bytes, base64url, no padding. */
export const MOBILE_KEY_RE = /^jfk_[A-Za-z0-9_-]{43}$/;
export const DEVICE_ID_RE = /^d_[0-9a-f]{16}$/;
/** Crockford base32 (50 bits for 10 characters). */
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 10;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** Wrong codes per open code; then it is cancelled. */
export const PAIRING_MAX_FAILURES = 5;
/** Pair attempts while a code is open… */
export const PAIRING_RATE_MAX = 20;
/** …per 10 minutes → 429. */
export const PAIRING_RATE_WINDOW_MS = 10 * 60_000;
/** bodyLimit of POST /api/mobile/pair. */
export const PAIR_BODY_LIMIT_BYTES = 1024;
/** Unknown or malformed keys per window → 429. */
export const BAD_KEY_RATE_MAX = 60;
export const BAD_KEY_RATE_WINDOW_MS = 10 * 60_000;
/** Active devices. */
export const MOBILE_MAX_DEVICES = 10;
/** Removed entries kept for the list. */
export const MOBILE_KEEP_REMOVED = 20;
export const DEVICE_LABEL_MAX = 40;
export const DEVICE_LAST_USED_FLUSH_MS = 10 * 60_000;
export const LAST_PAIRED_SHOWN_MS = 10 * 60_000;
export const PAIR_URL_SCHEME = 'joinrfinance';
/** Server-local (Melbourne = Sydney rules). */
export const ASX_OPEN = { hour: 10, minute: 0 } as const;
/** After the closing auction. */
export const ASX_CLOSE = { hour: 16, minute: 12 } as const;
export const ASX_PRE_OPEN = { hour: 7, minute: 0 } as const;
export const ASX_HOLIDAY_GRACE = { hour: 10, minute: 30 } as const;
export const INTRADAY_ASX_WINDOW = {
  from: { hour: 10, minute: 0 },
  to: { hour: 16, minute: 25 },
} as const;
export const INTRADAY_STEP_MIN = 5;
/** Also the bullion scope's step (D153). */
export const INTRADAY_CRYPTO_EVERY_MIN = 15;
/**
 * D153: the bullion scope runs on 15-minute slots from Monday 06:00 to Saturday 10:00
 * (server-local; covers the CME week under both DST calendars). `weekday` is Date#getDay().
 */
export const INTRADAY_BULLION_WINDOW = {
  from: { weekday: 1, hour: 6, minute: 0 },
  to: { weekday: 6, hour: 10, minute: 0 },
} as const;
/** A slot is a 5-minute mark + 20 s (Yahoo closes the bar). */
export const INTRADAY_SLOT_OFFSET_MS = 20_000;
export const INTRADAY_STARTUP_DELAY_MS = 30_000;
export const INTRADAY_RUN_DEADLINE_MS = 4 * 60_000;
export const INTRADAY_WAKE_MAX_MS = 60 * 60_000;
export const COIN_CHART_SPACING_MS = 2_000;
export const DAY_POINTS_MAX = 400;
export const LINE_MAX_POINTS = 120;
export const PORTFOLIO_LINE_STEP_MIN = 5;

/** D148: the bullion holdings (silver, then gold). Keys and codes are generic; the series ids are pricing.ts's. */
export const BULLION_HOLDINGS = {
  silver: {
    key: 'bullion-silver',
    code: 'SILVER',
    name: 'Silver bullion',
    symbol: 'SI=F',
    futuresSeries: 'SI_USD_OZ',
    spotSeries: 'XAG_AUD_OZ',
  },
  gold: {
    key: 'bullion-gold',
    code: 'GOLD',
    name: 'Gold bullion',
    symbol: 'GC=F',
    futuresSeries: 'GC_USD_OZ',
    spotSeries: 'XAU_AUD_OZ',
  },
} as const satisfies Record<
  Metal,
  {
    key: string;
    code: string;
    name: string;
    symbol: string;
    futuresSeries: string;
    spotSeries: string;
  }
>;

/** An instrument holding's key: `i<instrumentId>` (e.g. 'i12'); bullion: BULLION_HOLDINGS[metal].key. */
export function holdingKey(instrumentId: number): string {
  return `i${instrumentId}`;
}

// ─── Stage 10: the period selector and the daily closes (stage-10.md §3.5, FROZEN) ─────────────

/** D158: the phone's periods; '1D' is Stage 9's day figure (`/api/mobile/today`). */
export const MOBILE_PERIODS = ['1D', '1W', '2W', '1M', '3M', '6M', '12M', 'ALL'] as const;
/** What `GET /api/mobile/periods` answers, in this order. */
export const SERVER_PERIODS = ['1W', '2W', '1M', '3M', '6M', '12M', 'ALL'] as const;
/** The calendar span of each dated period (months are EDATE: the day is clamped). */
export const PERIOD_SPANS = {
  '1W': { days: 7 },
  '2W': { days: 14 },
  '1M': { months: 1 },
  '3M': { months: 3 },
  '6M': { months: 6 },
  '12M': { months: 12 },
} as const;
/** The start close, and its FX close, at most this many days earlier. */
export const PERIOD_START_MAX_GAP_DAYS = 10;
/** A holding's period line (cards, detail). */
export const PERIOD_HOLDING_POINTS = 40;
/** The "Sold holdings" figure's key: never collides with 'i<id>' or 'bullion-<metal>'. */
export const SOLD_HOLDINGS_KEY = 'sold';
/** Server-local, daily; off the 15-minute intraday grid (§5.7). */
export const CLOSES_RUN_AT = { hour: 16, minute: 52 } as const;
/** Follow-ups snap to xx:07, xx:22, xx:37, xx:52 (minute % 15 === 7). */
export const CLOSES_SLOT_MINUTE_OFFSET = 7;
/** No CoinGecko history call this close before an intraday crypto slot fires. */
export const CLOSES_COIN_SLOT_GUARD_MS = 45_000;
export const CLOSES_STARTUP_DELAY_MS = 120_000;
export const CLOSES_RUN_DEADLINE_MS = 10 * 60_000;
/** A run that left work (deadline, cool-down) schedules one more. */
export const CLOSES_FOLLOW_UP_MS = 30 * 60_000;
/** Per server-local day. */
export const CLOSES_FOLLOW_UPS_MAX = 6;
/** History starts this many days before the earliest trade. */
export const CLOSES_LEAD_DAYS = 10;
/** A top-up re-reads (and rewrites) this many days. */
export const CLOSES_TOPUP_OVERLAP_DAYS = 10;
export const CLOSES_YAHOO_SPACING_MS = 1_500;
export const CLOSES_COIN_SPACING_MS = 15_000;
export const CLOSES_REQUEST_TIMEOUT_MS = 30_000;
/** The keyless API's reach (older → 401, error_code 10012). */
export const COINGECKO_HISTORY_DAYS = 364;
/** Up to this, market_chart answers hourly points. */
export const COINGECKO_HOURLY_DAYS = 90;
/** Hourly points: the last point at most this old. */
export const CLOSES_COIN_POINT_MAX_AGE_MS = 36 * 60 * 60_000;
/** Daily points: the nearest point within ± this (§5.3). */
export const CLOSES_COIN_DAILY_WINDOW_MS = 14 * 60 * 60_000;
/** History depth for a held bullion row without a purchase date. */
export const CLOSES_BULLION_UNDATED_DAYS = 380;
/** The app's "Price history to dd/mm" note when closesThrough is more than this before localDate. */
export const CLOSES_STALE_NOTE_DAYS = 6;
/** The §6.6 size test (30 synthetic holdings). */
export const PERIODS_ANSWER_BUDGET_BYTES = 350_000;

// ─── The fixed sentences (§4.5; never a value) ──────────────────────────────────────────────────

export const MOBILE_ERROR_MESSAGES = {
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
  PHONE_STORE_FAILED: 'The list of phones could not be saved on the server. Nothing was changed.',
} as const;
export type MobileErrorCode = keyof typeof MOBILE_ERROR_MESSAGES;

// ─── The pairing URL (§4.4) and its rules ───────────────────────────────────────────────────────

/** The longest pairing URL `parsePairingUrl` reads. */
export const PAIRING_URL_MAX_LENGTH = 512;

/** joinrfinance://pair?v=1&u=<encoded origin>&c=<code> */
export function pairingUrl(serverUrl: string, code: string): string {
  return `${PAIR_URL_SCHEME}://pair?v=1&u=${encodeURIComponent(serverUrl)}&c=${encodeURIComponent(code)}`;
}

/** decodeURIComponent that answers null instead of throwing. */
function decodeComponent(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

const PAIRING_URL_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)\?([^#]*)$/;

/**
 * null for anything else (wrong scheme or host, v ≠ 1, a bad origin or code, > 512 chars). The
 * scheme is case-insensitive; the host is exactly `pair` with no path or fragment; `v`, `u` and
 * `c` each appear once; other parameters are ignored. NEVER THROWS.
 */
export function parsePairingUrl(text: string): { serverUrl: string; code: string } | null {
  try {
    if (typeof text !== 'string' || text.length > PAIRING_URL_MAX_LENGTH) return null;
    const m = PAIRING_URL_RE.exec(text.trim());
    if (m === null) return null;
    const [, scheme = '', host = '', query = ''] = m;
    if (scheme.toLowerCase() !== PAIR_URL_SCHEME || host !== 'pair') return null;
    const params = new Map<string, string>();
    for (const part of query.split('&')) {
      if (part === '') continue;
      const eq = part.indexOf('=');
      const name = decodeComponent(eq < 0 ? part : part.slice(0, eq));
      const value = decodeComponent(eq < 0 ? '' : part.slice(eq + 1));
      if (name === null || value === null) return null;
      if (name !== 'v' && name !== 'u' && name !== 'c') continue;
      if (params.has(name)) return null;
      params.set(name, value);
    }
    if (params.get('v') !== '1') return null;
    const server = normaliseServerUrl(params.get('u') ?? '');
    const code = normalisePairingCode(params.get('c') ?? '');
    if (!server.ok || code === null) return null;
    return { serverUrl: server.url, code };
  } catch {
    return null;
  }
}

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const SERVER_URL_RE = new RegExp(
  `^(https?)://(\\[[0-9A-Fa-f:.]+\\]|${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}))?/?$`,
  'i',
);
/** The longest origin accepted (a DNS name is ≤ 253 characters). */
const SERVER_URL_MAX_LENGTH = 300;

/**
 * http(s)://host[:port] only (a trailing '/' dropped): no userinfo, path, query or fragment. The
 * scheme and host are lower-cased; surrounding whitespace is ignored. NEVER THROWS.
 */
export function normaliseServerUrl(raw: string): { ok: true; url: string } | { ok: false } {
  try {
    if (typeof raw !== 'string') return { ok: false };
    const text = raw.trim();
    if (text.length === 0 || text.length > SERVER_URL_MAX_LENGTH) return { ok: false };
    const m = SERVER_URL_RE.exec(text);
    if (m === null) return { ok: false };
    const [, scheme = '', host = '', portText] = m;
    let port = '';
    if (portText !== undefined) {
      const value = Number(portText);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) return { ok: false };
      port = `:${value}`;
    }
    return { ok: true, url: `${scheme.toLowerCase()}://${host.toLowerCase()}${port}` };
  } catch {
    return { ok: false };
  }
}

/** Upper-case, drop '-' and spaces, O→0, I/L→1; then the alphabet and length, or null. NEVER THROWS. */
export function normalisePairingCode(raw: string): string | null {
  try {
    if (typeof raw !== 'string') return null;
    const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (code.length !== PAIRING_CODE_LENGTH) return null;
    for (const ch of code) if (!PAIRING_CODE_ALPHABET.includes(ch)) return null;
    return code;
  } catch {
    return null;
  }
}

export type ServerAddressKind = 'tailscale' | 'short_name' | 'lan' | 'loopback' | 'other';

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/**
 * For the web's warning (§8.3): `*.ts.net` or Tailscale's CGNAT range (100.64/10) → `tailscale`;
 * `localhost`, 127/8 or `[::1]` → `loopback`; a single-label name (a MagicDNS short name) →
 * `short_name`; `*.local`, `*.lan`, `*.home.arpa` or RFC 1918 → `lan`; else `other` (an address
 * that is not a valid origin included). Only `tailscale` keeps the key inside Tailscale. NEVER THROWS.
 */
export function serverAddressKind(url: string): ServerAddressKind {
  try {
    const n = normaliseServerUrl(url);
    if (!n.ok) return 'other';
    const host = /^https?:\/\/(\[[^\]]*\]|[^:/]+)/.exec(n.url)?.[1] ?? '';
    const ip = ipv4Octets(host);
    if (ip !== null) {
      const [a = 0, b = 0] = ip;
      if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
      if (a === 127) return 'loopback';
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'lan';
      return 'other';
    }
    if (host === '[::1]') return 'loopback';
    if (host.startsWith('[')) return 'other';
    if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';
    if (host.endsWith('.ts.net')) return 'tailscale';
    if (!host.includes('.')) return 'short_name';
    if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa'))
      return 'lan';
    return 'other';
  } catch {
    return 'other';
  }
}

// ─── Explicit-zone dates (stage-9.md §2.1: never the process TZ) ────────────────────────────────

const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (zoneFormatters.has(timeZone)) return zoneFormatters.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    formatter = null;
  }
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

/** The wall-clock time of an instant in an IANA zone. */
export interface ZonedWallTime {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** Date#getDay() of `date` (0 = Sunday). */
  weekday: number;
}

/** The wall-clock time of `epochMs` in `timeZone` (through Intl); null for an unknown zone or instant. */
export function wallTimeInZone(epochMs: number, timeZone: string): ZonedWallTime | null {
  try {
    if (!Number.isFinite(epochMs)) return null;
    const formatter = zoneFormatter(timeZone);
    if (formatter === null) return null;
    const parts = formatter.formatToParts(new Date(epochMs));
    const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    const y = part('year');
    const mo = part('month');
    const d = part('day');
    const hour = part('hour');
    const minute = part('minute');
    const second = part('second');
    if (![y, mo, d, hour, minute, second].every(Number.isInteger) || y < 1 || y > 9999) return null;
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    return {
      date: `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`,
      hour,
      minute,
      second,
      weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
    };
  } catch {
    return null;
  }
}

/** The calendar date (`YYYY-MM-DD`) of `epochMs` in `timeZone`; null for an unknown zone or instant. */
export function dateInZone(epochMs: number, timeZone: string): string | null {
  return wallTimeInZone(epochMs, timeZone)?.date ?? null;
}

/** The zone's UTC offset at `epochMs` (ms; positive east of UTC), whole seconds. */
function offsetAt(epochMs: number, timeZone: string): number | null {
  const t = Math.floor(epochMs / 1000) * 1000;
  const w = wallTimeInZone(t, timeZone);
  if (w === null) return null;
  const [y = 0, mo = 1, d = 1] = w.date.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, w.hour, w.minute, w.second) - t;
}

/**
 * The instant (epoch ms) of 00:00 on `date` in `timeZone` (the first instant of that date when a
 * DST change skips midnight); null for an unknown zone or a malformed date.
 */
export function startOfDayInZone(date: string, timeZone: string): number | null {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (m === null) return null;
    const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let guess = utcMidnight;
    for (let i = 0; i < 3; i += 1) {
      const offset = offsetAt(guess, timeZone);
      if (offset === null) return null;
      const next = utcMidnight - offset;
      if (next === guess) break;
      guess = next;
    }
    // Walk back over a skipped midnight: the first instant whose date is `date`.
    if (dateInZone(guess, timeZone) !== date) {
      for (let h = 1; h <= 3 && dateInZone(guess, timeZone) !== date; h += 1) guess += 3_600_000;
      if (dateInZone(guess, timeZone) !== date) return null;
    }
    while (dateInZone(guess - 60_000, timeZone) === date) guess -= 60_000;
    return guess;
  } catch {
    return null;
  }
}
