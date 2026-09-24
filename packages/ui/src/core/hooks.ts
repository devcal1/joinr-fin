import { useCallback, useSyncExternalStore } from 'react';

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Tracks a CSS media query, e.g. `useMediaQuery(MEDIA.phone)`. False when matchMedia is
 * unavailable. Prefer plain CSS media queries; use this only when markup or props must change.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!canMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  const getSnapshot = (): boolean => canMatchMedia() && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
