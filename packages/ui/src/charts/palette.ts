// Chart colours (STYLE_GUIDE §6). The categorical order was validated with the dataviz method
// against --surface and --ink: see §6 for the checks and results. Do not reorder or re-step a
// slot without re-running the validator; the order is what keeps neighbours distinguishable.
import { COLORS } from '../core';

/**
 * Categorical palette, in fixed order. Slot N always goes to the Nth entity; it is never cycled.
 * Every slot is a dark-mode step of a STYLE_GUIDE §1 family:
 * 1 teal · 2 violet · 3 orange · 4 fuchsia · 5 orange tint (amber) · 6 violet tint (purple)
 * · 7 green tint · 8 teal tint (deep teal).
 */
export const CHART_PALETTE: readonly string[] = Object.freeze([
  '#07AE8B',
  '#7744DD',
  '#EB6903',
  '#D946EF',
  '#C56703',
  '#B268FF',
  '#07B25A',
  '#007E68',
]);

/** "Other" and anything past the eighth series. Never a generated hue. */
export const CHART_OTHER: string = COLORS.textMuted;

/** Gain / loss marks (status colours; always paired with a sign and a word). */
export const CHART_GAIN: string = COLORS.go;
export const CHART_LOSS: string = COLORS.stop;

/** Most slices a donut shows; the rest fold into "Other" (dataviz: part-to-whole ≤ 6). */
export const DONUT_MAX_SEGMENTS = 6;

/** Area fills are a wash of the series hue, never a saturated block. */
export const AREA_OPACITY = 0.14;

/** The palette colour for the series at `index`, or CHART_OTHER past the end. */
export function seriesColor(index: number): string {
  return CHART_PALETTE[index] ?? CHART_OTHER;
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i;

/** True for a hex or rgb(a) colour: the only forms allowed into tooltip markup. */
export function isSafeColor(value: string): boolean {
  return SAFE_COLOR.test(value.trim());
}

/** A caller-supplied colour if it is safe, else the palette slot. */
export function resolveSeriesColor(index: number, override?: string): string {
  return override && isSafeColor(override) ? override.trim() : seriesColor(index);
}

/** `#RRGGBB` → `rgba(r, g, b, alpha)`. Other inputs are returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return hex;
  const channels = [match[1], match[2], match[3]].map((part) => parseInt(part ?? '0', 16));
  return `rgba(${channels.join(', ')}, ${alpha})`;
}
