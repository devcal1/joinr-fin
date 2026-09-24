import type { JSX, ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** The teal sub-line under the title, e.g. the nav group. */
  subtitle?: string;
  actions?: ReactNode;
  /** Heading level. 1 (default) for a page; 2 for demos that sit inside another page. */
  level?: 1 | 2;
}

/** Page title (H1, 31px uppercase) with its teal sub-line and optional actions. */
export function PageHeader({ title, subtitle, actions, level = 1 }: PageHeaderProps): JSX.Element {
  const Heading = level === 2 ? 'h2' : 'h1';
  return (
    <div className="jf-page-header">
      <div className="jf-page-header__text">
        <Heading className="jf-page-header__title">{title}</Heading>
        {subtitle ? <p className="jf-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="jf-page-header__actions">{actions}</div> : null}
    </div>
  );
}
