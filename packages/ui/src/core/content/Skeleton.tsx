import type { CSSProperties, JSX } from 'react';
import { cx } from '../cx';

export type SkeletonVariant = 'text' | 'tile' | 'card' | 'table' | 'chart';

export interface SkeletonProps {
  variant: SkeletonVariant;
  /** Text lines (variant 'text', default 3) or table body rows (variant 'table', default 5). */
  lines?: number;
  /**
   * The block's height in px (variants 'card' and 'chart'; web-polish-ui, additive). Defaults:
   * card 160, chart 280 (the charts' default plot height), so a skeleton keeps the page's shape.
   */
  height?: number;
  className?: string;
}

const DEFAULT_LINES: Partial<Record<SkeletonVariant, number>> = { text: 3, table: 5 };

/** A whole number of lines, at least 1. */
function lineCount(variant: SkeletonVariant, lines: number | undefined): number {
  const wanted = lines ?? DEFAULT_LINES[variant] ?? 0;
  return Number.isFinite(wanted) ? Math.max(1, Math.floor(wanted)) : 1;
}

function Bar({ width, className }: { width?: string; className?: string }): JSX.Element {
  return (
    <span
      className={cx('jf-skeleton__bar', className)}
      style={width ? ({ '--jf-skeleton-w': width } as CSSProperties) : undefined}
    />
  );
}

/** Line widths that read as ragged text: full lines, the last one shorter. */
function textWidth(index: number, count: number): string | undefined {
  if (count > 1 && index === count - 1) return '60%';
  return index % 2 === 1 ? '92%' : undefined;
}

/**
 * A loading placeholder (stage-6.md §6.9 A; STYLE_GUIDE §6.2): `--surface` blocks (a card's inner
 * bars one step up, `--raised`) with a 1.2 s opacity pulse, none under prefers-reduced-motion.
 * Hidden from assistive technology: the page's visually hidden status label ("Loading net
 * worth…") speaks for it. Only for a first load; a refetch dims what is shown instead.
 *
 * - `text`: `lines` bars, the last one shorter (a paragraph, a page header).
 * - `tile`: a KPI tile (a label bar and a figure bar).
 * - `card`: a card with a title bar.
 * - `table`: a header bar and `lines` rows.
 * - `chart`: a card with a title bar and the plot area.
 */
export function Skeleton({ variant, lines, height, className }: SkeletonProps): JSX.Element {
  const count = lineCount(variant, lines);
  const style =
    height !== undefined && Number.isFinite(height) && height > 0
      ? ({ '--jf-skeleton-h': `${height}px` } as CSSProperties)
      : undefined;

  let body: JSX.Element | JSX.Element[];
  if (variant === 'text') {
    body = Array.from({ length: count }, (_, i) => <Bar key={i} width={textWidth(i, count)} />);
  } else if (variant === 'tile') {
    body = (
      <>
        <Bar className="jf-skeleton__label" width="45%" />
        <Bar className="jf-skeleton__figure" width="70%" />
      </>
    );
  } else if (variant === 'card') {
    body = <Bar className="jf-skeleton__title" width="35%" />;
  } else if (variant === 'table') {
    body = (
      <>
        <span className="jf-skeleton__head" />
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="jf-skeleton__row">
            <Bar width={i % 2 === 0 ? '30%' : '24%'} />
            <Bar width="18%" />
          </span>
        ))}
      </>
    );
  } else {
    body = (
      <>
        <Bar className="jf-skeleton__title" width="35%" />
        <span className="jf-skeleton__plot" />
      </>
    );
  }

  return (
    <div
      className={cx('jf-skeleton', `jf-skeleton--${variant}`, className)}
      data-variant={variant}
      style={style}
      aria-hidden="true"
    >
      {body}
    </div>
  );
}
