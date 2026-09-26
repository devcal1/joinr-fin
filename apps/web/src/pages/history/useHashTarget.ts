// Hash targets (stage-5.md §6.1): `/settings#<group>` and `/history#record` exist only after the
// page's query resolves, so the router's own scroll cannot reach them. Once the page is ready the
// target is scrolled into view once and its heading focused (tabIndex −1).
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

/** The current location's hash, without the '#'. */
export function useLocationHash(): string {
  return useRouterState({ select: (state) => state.location.hash });
}

/** The heading a target stands for: itself when it is a heading, else its first heading. */
function headingOf(target: HTMLElement): HTMLElement {
  if (/^H[1-6]$/.test(target.tagName)) return target;
  return target.querySelector<HTMLElement>('h1, h2, h3, h4') ?? target;
}

/** Scrolls to `#hash` and focuses its heading, once, after `ready` turns true. */
export function useHashTarget(ready: boolean): void {
  const hash = useLocationHash();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !hash || done.current === hash) return;
    const target = document.getElementById(hash);
    if (!target) return;
    done.current = hash;
    const heading = headingOf(target);
    heading.setAttribute('tabindex', '-1');
    // After the commit: a form the target opens focuses its first field in its own mount effect,
    // and React's StrictMode replays that effect after this one, so focusing now would lose the
    // heading's focus to the field (found by the Stage 5 e2e on /history#record).
    window.setTimeout(() => {
      if (!heading.isConnected) return;
      target.scrollIntoView?.({ block: 'start' });
      heading.focus({ preventScroll: true });
    }, 0);
  }, [ready, hash]);
}
