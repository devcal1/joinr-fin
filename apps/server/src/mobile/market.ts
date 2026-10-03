// The ASX market state (stage-9.md §6.6; pure: the zone and the clock are inputs, dates through
// Intl in that zone, never the process zone). On a weekday: 07:00 ≤ t < 10:00 → `pre_open`;
// 10:00 ≤ t < 16:12 → `open`, except after 10:30 when held ASX instruments have day rows and none
// has today's session date → `closed` (a public holiday), unless a Yahoo cool-down is in force
// (missing bars are then no evidence); otherwise `closed`. Weekends → `closed`.
import {
  ASX_CLOSE,
  ASX_HOLIDAY_GRACE,
  ASX_OPEN,
  ASX_PRE_OPEN,
  wallTimeInZone,
  type IsoDate,
  type MarketState,
} from '@joinr/schema';

export interface MarketStateInput {
  nowMs: number;
  /** The server's IANA zone. */
  timeZone: string;
  /** The session dates of the held ASX instruments' day rows (watched-only listings never count). */
  heldAsxSessionDates: readonly IsoDate[];
  /** True while a Yahoo cool-down is in force. */
  yahooCooling: boolean;
}

const minutesOf = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

export function asxMarketState(input: MarketStateInput): MarketState {
  const wall = wallTimeInZone(input.nowMs, input.timeZone);
  if (wall === null) return 'closed';
  if (wall.weekday === 0 || wall.weekday === 6) return 'closed';
  const t = wall.hour * 60 + wall.minute;
  if (t >= minutesOf(ASX_PRE_OPEN) && t < minutesOf(ASX_OPEN)) return 'pre_open';
  if (t >= minutesOf(ASX_OPEN) && t < minutesOf(ASX_CLOSE)) {
    if (
      t >= minutesOf(ASX_HOLIDAY_GRACE) &&
      !input.yahooCooling &&
      input.heldAsxSessionDates.length > 0 &&
      !input.heldAsxSessionDates.includes(wall.date)
    ) {
      return 'closed';
    }
    return 'open';
  }
  return 'closed';
}

/** The newest session date among the held ASX instruments' day rows, or null. */
export function newestSessionDate(dates: readonly IsoDate[]): IsoDate | null {
  let newest: IsoDate | null = null;
  for (const d of dates) if (newest === null || d > newest) newest = d;
  return newest;
}
