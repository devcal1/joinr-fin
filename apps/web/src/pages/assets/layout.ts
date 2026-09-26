// Table layout for the assets pages (stage-4.md §6.8, UX-20): on a phone the status-first column
// orders apply; from 768 to 1199 px (a tablet, or the Browser pane beside the sidebar) the first
// column keeps at least 200 px, so names and dates keep whole words while the other columns scroll
// beside it; at 1200 px and wider each table uses its own desktop widths. No components.
import { MEDIA, useMediaQuery } from '@joinr/ui';

/** The first column's minimum width from 768 to 1199 px (§6.8). */
export const TABLET_FIRST_COLUMN_MIN = 200;

export interface TableLayout {
  phone: boolean;
  /** 768–1199 px. */
  tablet: boolean;
  /** The first column's minimum width: the desktop figure, the phone figure, or 200 on a tablet. */
  firstMin: (desktop: number, phone?: number) => number;
}

export function useTableLayout(): TableLayout {
  const phone = useMediaQuery(MEDIA.phone);
  const desktop = useMediaQuery(MEDIA.desktop);
  const tablet = !phone && !desktop;
  return {
    phone,
    tablet,
    firstMin: (desktopMin, phoneMin = desktopMin) =>
      phone ? phoneMin : tablet ? Math.max(TABLET_FIRST_COLUMN_MIN, desktopMin) : desktopMin,
  };
}
