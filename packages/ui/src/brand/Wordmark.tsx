import { useId, type JSX } from 'react';
import { cx } from '../core';
import {
  WORDMARK_ASPECT,
  WORDMARK_DOT,
  WORDMARK_DOT_GRADIENT,
  WORDMARK_FILL,
  WORDMARK_GLYPHS,
  WORDMARK_VIEWBOX,
} from './wordmarkGeometry';

export interface WordmarkProps {
  /** Rendered height in px; default 32, never below 24 (STYLE_GUIDE §7.2). */
  height?: number;
  /** Accessible name; default "joinr". */
  title?: string;
  className?: string;
}

/** Smallest height the wordmark may be shown at (STYLE_GUIDE §7.2). */
export const WORDMARK_MIN_HEIGHT = 24;

/** React ids can contain characters that are awkward inside `url(#…)`; keep word characters only. */
function svgSafeId(prefix: string, reactId: string): string {
  return `${prefix}-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The "joinr." wordmark as inline SVG: white letters, gradient full stop. Dark grounds only; never
 * recoloured, stretched or given effects. Each instance gets its own gradient id.
 */
export function Wordmark({ height = 32, title = 'joinr', className }: WordmarkProps): JSX.Element {
  const reactId = useId();
  const gradientId = svgSafeId('jf-wordmark-dot', reactId);
  const titleId = svgSafeId('jf-wordmark-title', reactId);
  const h = Math.max(WORDMARK_MIN_HEIGHT, Number.isFinite(height) ? height : WORDMARK_MIN_HEIGHT);
  const g = WORDMARK_DOT_GRADIENT;
  return (
    <svg
      className={cx('jf-brand-wordmark', className)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`}
      width={round2(h * WORDMARK_ASPECT)}
      height={round2(h)}
      role="img"
      aria-labelledby={titleId}
      focusable="false"
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
          <stop offset="0" stopColor={g.from} />
          <stop offset="1" stopColor={g.to} />
        </linearGradient>
      </defs>
      <g fill={WORDMARK_FILL}>
        {WORDMARK_GLYPHS.map((glyph) => (
          <path key={glyph.id} d={glyph.d} />
        ))}
      </g>
      <circle
        cx={WORDMARK_DOT.cx}
        cy={WORDMARK_DOT.cy}
        r={WORDMARK_DOT.r}
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
