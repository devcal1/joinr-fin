// The `intraday` job's slots and scopes (stage-9.md §5.6; FROZEN rules; D144, D153). Pure: the
// clock and the server's IANA zone are passed in, and every local time is read through Intl
// (`wallTimeInZone`), never the process TZ.
//
// Slots are the epoch's 5-minute marks plus INTRADAY_SLOT_OFFSET_MS: Melbourne's offsets are whole
// hours, so these are local 5-minute marks in AEST and AEDT alike (the repeated hour 02:00–02:59
// on the April change day simply has its slots twice). A slot's scopes are decided by the mark the
// timer targeted, never by the wall clock when it fires.
import {
  INTRADAY_ASX_WINDOW,
  INTRADAY_BULLION_WINDOW,
  INTRADAY_CRYPTO_EVERY_MIN,
  INTRADAY_SLOT_OFFSET_MS,
  INTRADAY_STEP_MIN,
  INTRADAY_WAKE_MAX_MS,
  wallTimeInZone,
  type ZonedWallTime,
} from '@joinr/schema';

export const INTRADAY_STEP_MS = INTRADAY_STEP_MIN * 60_000;

export interface IntradayScopes {
  asx: boolean;
  crypto: boolean;
  bullion: boolean;
}

export const NO_SCOPES: IntradayScopes = { asx: false, crypto: false, bullion: false };

/** The next slot strictly after `nowMs`: its 5-minute mark and the instant it fires (mark + offset). */
export function nextSlot(nowMs: number): { slotMs: number; fireAtMs: number } {
  const slotMs =
    Math.floor((nowMs - INTRADAY_SLOT_OFFSET_MS) / INTRADAY_STEP_MS) * INTRADAY_STEP_MS +
    INTRADAY_STEP_MS;
  return { slotMs, fireAtMs: slotMs + INTRADAY_SLOT_OFFSET_MS };
}

/** How long the timer sleeps towards `fireAtMs` (never negative, never more than the wake cap). */
export function wakeDelay(nowMs: number, fireAtMs: number): number {
  return Math.min(Math.max(0, fireAtMs - nowMs), INTRADAY_WAKE_MAX_MS);
}

/** A slot whose timer fired more than one step after its fire time is dropped (§5.6). */
export function isSlotLate(slotMs: number, firedAtMs: number): boolean {
  return firedAtMs - (slotMs + INTRADAY_SLOT_OFFSET_MS) > INTRADAY_STEP_MS;
}

const minutesOf = (h: { hour: number; minute: number }): number => h.hour * 60 + h.minute;

/** Monday–Friday and 10:00 ≤ hh:mm ≤ 16:25 (public holidays are not known). */
export function inAsxWindow(w: ZonedWallTime): boolean {
  const m = minutesOf(w);
  return (
    w.weekday >= 1 &&
    w.weekday <= 5 &&
    m >= minutesOf(INTRADAY_ASX_WINDOW.from) &&
    m <= minutesOf(INTRADAY_ASX_WINDOW.to)
  );
}

/** Minutes since Monday 00:00 (Sunday is the end of the week). */
function minuteOfWeek(weekday: number, hour: number, minute: number): number {
  return ((weekday + 6) % 7) * 1440 + hour * 60 + minute;
}

/** D153: from Monday 06:00 to Saturday 10:00, both ends included. */
export function inBullionWindow(w: ZonedWallTime): boolean {
  const { from, to } = INTRADAY_BULLION_WINDOW;
  const m = minuteOfWeek(w.weekday, w.hour, w.minute);
  return (
    m >= minuteOfWeek(from.weekday, from.hour, from.minute) &&
    m <= minuteOfWeek(to.weekday, to.hour, to.minute)
  );
}

/**
 * The scopes of the slot at `slotMs` (§5.6): ASX in its window; crypto on minutes that are a
 * multiple of 15 (any day); bullion on those minutes inside its window while a bullion row is held.
 */
export function scopesForSlot(
  slotMs: number,
  timeZone: string,
  bullionHeld: boolean,
): IntradayScopes {
  const w = wallTimeInZone(slotMs, timeZone);
  if (w === null) return NO_SCOPES;
  const quarter = w.minute % INTRADAY_CRYPTO_EVERY_MIN === 0;
  return {
    asx: inAsxWindow(w),
    crypto: quarter,
    bullion: quarter && bullionHeld && inBullionWindow(w),
  };
}

/**
 * The start-up run's scopes (§5.6): crypto, plus ASX when the current 5-minute mark is in its
 * window.
 */
export function startupScopes(nowMs: number, timeZone: string): IntradayScopes {
  const mark = Math.floor(nowMs / INTRADAY_STEP_MS) * INTRADAY_STEP_MS;
  const w = wallTimeInZone(mark, timeZone);
  return { asx: w !== null && inAsxWindow(w), crypto: true, bullion: false };
}

/**
 * A manual run's scopes (`scheduler.run('intraday')` with no slot): everything that applies now:
 * crypto, ASX in its window, bullion in its window while held.
 */
export function manualScopes(
  nowMs: number,
  timeZone: string,
  bullionHeld: boolean,
): IntradayScopes {
  const mark = Math.floor(nowMs / INTRADAY_STEP_MS) * INTRADAY_STEP_MS;
  const w = wallTimeInZone(mark, timeZone);
  if (w === null) return { asx: false, crypto: true, bullion: false };
  return { asx: inAsxWindow(w), crypto: true, bullion: bullionHeld && inBullionWindow(w) };
}
