import type { JSX, ReactNode } from 'react';

export type PillTone = 'teal' | 'violet' | 'fuchsia' | 'na';

export interface PillProps {
  children: ReactNode;
  /** Teal by default; violet/fuchsia only for real categories; 'na' = not applicable. */
  tone?: PillTone;
}

/** A tag: fully round, 1px border, no fill, 11px. */
export function Pill({ children, tone = 'teal' }: PillProps): JSX.Element {
  return <span className={`jf-pill jf-pill--${tone}`}>{children}</span>;
}
