// Per-browser conveniences for the investment pages (stage-2.md §6.3 item 4, §6.6): the "More
// columns" switch and the trade form's last explicit entry mode per holding (D47). localStorage
// can be missing or throw (private windows, blocked storage), so every access is wrapped: reads
// fall back to null and writes and removals do nothing.
import type { QuantityMode } from '@joinr/schema';

export const MORE_COLUMNS_KEY = 'joinr.investments.moreColumns';
/** One key per holding: `joinr.investments.entryMode.<instrumentId>` (D47). */
export const ENTRY_MODE_KEY_PREFIX = 'joinr.investments.entryMode.';
/**
 * The browser-wide Units / Amount key used before D47. It is never read (one choice let a single
 * Units click override every auto-invest holding) and is removed when the trade form opens.
 */
export const LEGACY_ENTRY_MODE_KEY = 'joinr.investments.entryMode';

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable: the choice lasts for this page view only.
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage is unavailable: there is nothing to remove.
  }
}

/** The "More columns" switch (off by default). */
export function readMoreColumns(): boolean {
  return readStored(MORE_COLUMNS_KEY) === 'true';
}

export function writeMoreColumns(on: boolean): void {
  writeStored(MORE_COLUMNS_KEY, on ? 'true' : 'false');
}

/** The storage key of one holding's remembered entry mode. */
export function entryModeKey(instrumentId: number): string {
  return `${ENTRY_MODE_KEY_PREFIX}${instrumentId}`;
}

/** The owner's last explicit Units / Amount choice for this holding, or null when none was made. */
export function readEntryMode(instrumentId: number): QuantityMode | null {
  const value = readStored(entryModeKey(instrumentId));
  return value === 'units' || value === 'amount' ? value : null;
}

export function writeEntryMode(instrumentId: number, mode: QuantityMode): void {
  writeStored(entryModeKey(instrumentId), mode);
}

/** Drops the pre-D47 browser-wide choice (it is ignored either way). */
export function forgetLegacyEntryMode(): void {
  removeStored(LEGACY_ENTRY_MODE_KEY);
}
