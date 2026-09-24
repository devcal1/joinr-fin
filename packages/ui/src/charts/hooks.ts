import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function motionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION)
    : null;
}

function subscribe(notify: () => void): () => void {
  const query = motionQuery();
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}

/** True when the viewer asked for reduced motion; charts then render without animation. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => motionQuery()?.matches ?? false,
    () => false,
  );
}
