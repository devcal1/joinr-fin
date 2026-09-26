// A router link that looks like a Button (the page header's navigation actions, stage-5.md §6.3
// item 1: "Record month" goes to /history#record, it never records by itself).
import { Icon } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

export function LinkButton({
  to,
  hash,
  icon,
  variant = 'secondary',
  children,
}: {
  to: '/history' | '/settings' | '/';
  hash?: string;
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
}): JSX.Element {
  return (
    <Link
      to={to}
      hash={hash}
      className={`jf-button jf-button--${variant} jf-button--md jf-app-link-button`}
    >
      {icon ? <Icon icon={icon} size={16} /> : null}
      <span className="jf-button__label">{children}</span>
    </Link>
  );
}
