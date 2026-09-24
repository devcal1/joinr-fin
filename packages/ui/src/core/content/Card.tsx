import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';

export interface CardProps {
  /** Card heading (H3, teal uppercase). */
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Default 'div'. A titled 'section' is labelled by its heading. */
  as?: 'section' | 'div' | 'article';
  /** 'none' lets a table run edge to edge; the heading keeps its padding. Default 'normal'. */
  padding?: 'none' | 'normal';
  className?: string;
}

/** A `--surface` panel with an optional H3 heading, sub-line and actions. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  as: Tag = 'div',
  padding = 'normal',
  className,
}: CardProps): JSX.Element {
  const titleId = useId();
  const hasHead = Boolean(title || subtitle || actions);
  return (
    <Tag
      className={cx('jf-card', padding === 'none' && 'jf-card--flush', className)}
      aria-labelledby={title && Tag !== 'div' ? titleId : undefined}
    >
      {hasHead ? (
        <div className="jf-card__head">
          <div className="jf-card__heading">
            {title ? (
              <h3 id={titleId} className="jf-card__title">
                {title}
              </h3>
            ) : null}
            {subtitle ? <p className="jf-card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="jf-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="jf-card__body">{children}</div>
    </Tag>
  );
}
