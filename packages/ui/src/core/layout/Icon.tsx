import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';

export interface IconProps {
  icon: LucideIcon;
  /** 16 inline (default), 20 in the nav. */
  size?: 16 | 20;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** A lucide icon at the house stroke (1.75). It takes `currentColor`. */
export function Icon({ icon: Glyph, size = 16, label, className }: IconProps): JSX.Element {
  if (label) {
    return (
      <Glyph
        size={size}
        strokeWidth={1.75}
        className={cx('jf-icon', className)}
        role="img"
        aria-label={label}
        focusable="false"
      />
    );
  }
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      className={cx('jf-icon', className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}
