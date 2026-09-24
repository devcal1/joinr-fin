import type { JSX } from 'react';
import { cx } from '../core';
import { Wordmark } from './Wordmark';

export interface BrandBlockProps {
  /** sm = 24px wordmark, md = 32px (default), lg = 48px (brand screens). */
  size?: 'sm' | 'md' | 'lg';
  /** The teal descriptor beside the wordmark; default "FINANCE". */
  label?: string;
  className?: string;
}

const HEIGHT = { sm: 24, md: 32, lg: 48 } as const;

/**
 * The header lockup (STYLE_GUIDE §7.2, D13): the wordmark with a teal, letter-spaced label set on its
 * baseline, 0.4 × the wordmark height away (the clear space).
 */
export function BrandBlock({
  size = 'md',
  label = 'FINANCE',
  className,
}: BrandBlockProps): JSX.Element {
  return (
    <span className={cx('jf-brand-block', `jf-brand-block--${size}`, className)}>
      <Wordmark height={HEIGHT[size]} className="jf-brand-block__mark" />
      <span className="jf-brand-block__label">{label}</span>
    </span>
  );
}
