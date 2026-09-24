import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

/** Spacing steps (STYLE_GUIDE §3): 4 · 8 · 12 · 16 · 24 · 36 px. */
export type Gap = 1 | 2 | 3 | 4 | 6 | 9;

export interface StackProps {
  /** Default 4 (16px). */
  gap?: Gap;
  children: ReactNode;
  className?: string;
}

export interface ClusterProps {
  /** Default 2 (8px). */
  gap?: Gap;
  /** Cross-axis alignment. Default 'center'. */
  align?: 'start' | 'center' | 'baseline' | 'end';
  children: ReactNode;
  className?: string;
}

/** Children in a column with one spacing step between them. */
export function Stack({ gap = 4, children, className }: StackProps): JSX.Element {
  return <div className={cx('jf-stack', `jf-stack--gap-${gap}`, className)}>{children}</div>;
}

/** Children in a wrapping row (badges, pills, buttons) with one spacing step between them. */
export function Cluster({
  gap = 2,
  align = 'center',
  children,
  className,
}: ClusterProps): JSX.Element {
  return (
    <div className={cx('jf-cluster', `jf-cluster--gap-${gap}`, `jf-cluster--${align}`, className)}>
      {children}
    </div>
  );
}
