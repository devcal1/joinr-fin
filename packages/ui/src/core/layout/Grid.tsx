import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

/** Desktop column spans (of 12). Never off-grid widths. */
export type Span = 12 | 6 | 4 | 3 | 2;
/** Tablet column spans (of 6). */
export type TabletSpan = 6 | 3 | 2;

export interface GridProps {
  children: ReactNode;
  className?: string;
}

export interface GridItemProps {
  /** Columns of 12 on desktop (≥ 1200px). Default 12. */
  span?: Span;
  /** Columns of 6 on tablet (768–1199px). Default: full → 6, half → 3, third → 2, quarter → 3, sixth → 2. */
  spanTablet?: TabletSpan;
  children: ReactNode;
}

const DEFAULT_TABLET_SPAN: Record<Span, TabletSpan> = { 12: 6, 6: 3, 4: 2, 3: 3, 2: 2 };

/** 12 columns on desktop, 6 on tablet, 1 on phone; 12px gutters. */
export function Grid({ children, className }: GridProps): JSX.Element {
  return <div className={cx('jf-grid', className)}>{children}</div>;
}

export function GridItem({ span = 12, spanTablet, children }: GridItemProps): JSX.Element {
  const tablet = spanTablet ?? DEFAULT_TABLET_SPAN[span];
  return (
    <div className={cx('jf-grid__item', `jf-grid__item--${span}`, `jf-grid__item--t${tablet}`)}>
      {children}
    </div>
  );
}
