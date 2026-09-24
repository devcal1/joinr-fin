// Phone emulation for page tests: `useMediaQuery(MEDIA.phone)` matches until the spy is restored
// (vi.restoreAllMocks, or the returned spy's mockRestore).
import { MEDIA } from '@joinr/ui';
import { vi } from 'vitest';

export function emulatePhone() {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === MEDIA.phone || query === MEDIA.drawer,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}
