import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** primary = teal fill (one per view); secondary (default); ghost; danger (destructive). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconPosition?: 'start' | 'end';
  /** Omit for an icon-only button, which then requires `aria-label` (it also becomes the tooltip). */
  children?: ReactNode;
}

/** Uppercase, letter-spaced, no shadow. Defaults to `type="button"`. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconPosition = 'start',
  children,
  className,
  type = 'button',
  title,
  ...rest
}: ButtonProps): JSX.Element {
  const iconOnly =
    Boolean(icon) && (children === undefined || children === null || children === '');
  const glyph = icon ? <Icon icon={icon} size={16} /> : null;
  return (
    <button
      type={type}
      className={cx(
        'jf-button',
        `jf-button--${variant}`,
        `jf-button--${size}`,
        iconOnly && 'jf-button--icon',
        className,
      )}
      title={title ?? (iconOnly ? rest['aria-label'] : undefined)}
      {...rest}
    >
      {iconPosition === 'start' ? glyph : null}
      {iconOnly ? null : <span className="jf-button__label">{children}</span>}
      {iconPosition === 'end' ? glyph : null}
    </button>
  );
}
