// The per-browser conveniences (stage-2.md §6.3 item 4, §6.6; D47): the entry mode is one key per
// holding, the pre-D47 browser-wide key is ignored and removable, and blocked storage never throws.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_ENTRY_MODE_KEY,
  entryModeKey,
  forgetLegacyEntryMode,
  readEntryMode,
  readMoreColumns,
  writeEntryMode,
  writeMoreColumns,
} from './storage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the entry mode per holding (D47)', () => {
  it('stores one choice per instrument id', () => {
    expect(entryModeKey(4)).toBe('joinr.investments.entryMode.4');
    writeEntryMode(4, 'units');
    writeEntryMode(12, 'amount');
    expect(readEntryMode(4)).toBe('units');
    expect(readEntryMode(12)).toBe('amount');
    expect(readEntryMode(7)).toBeNull();
    writeEntryMode(4, 'amount');
    expect(readEntryMode(4)).toBe('amount');
  });

  it('reads an unknown stored value as no choice', () => {
    window.localStorage.setItem(entryModeKey(4), 'shares');
    expect(readEntryMode(4)).toBeNull();
  });

  it('never reads the old browser-wide key, and removes it', () => {
    window.localStorage.setItem(LEGACY_ENTRY_MODE_KEY, 'units');
    expect(readEntryMode(4)).toBeNull();
    forgetLegacyEntryMode();
    expect(window.localStorage.getItem(LEGACY_ENTRY_MODE_KEY)).toBeNull();
    // Removing it again (already gone) is harmless.
    expect(() => forgetLegacyEntryMode()).not.toThrow();
  });
});

describe('blocked storage', () => {
  it('falls back to no choice and never throws when the storage accessor throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(readEntryMode(4)).toBeNull();
    expect(() => writeEntryMode(4, 'units')).not.toThrow();
    expect(() => forgetLegacyEntryMode()).not.toThrow();
    expect(readMoreColumns()).toBe(false);
    expect(() => writeMoreColumns(true)).not.toThrow();
  });

  it('never throws when each storage call throws', () => {
    const blocked = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    expect(readEntryMode(4)).toBeNull();
    expect(() => writeEntryMode(4, 'amount')).not.toThrow();
    expect(() => forgetLegacyEntryMode()).not.toThrow();
  });
});
