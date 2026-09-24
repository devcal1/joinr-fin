import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

/** Fixed colour coding (never alternated for effect): primary orange · supporting teal · reference violet. */
export type SectionRole = 'primary' | 'supporting' | 'reference';

export interface SectionBarProps {
  title: string;
  /** Default 'primary'. */
  role?: SectionRole;
  actions?: ReactNode;
  /** Id of the heading, for `aria-labelledby` and in-page links. */
  id?: string;
  /** Default 2. */
  level?: 2 | 3;
}

/** Opens a major block: `--raised` bar, 4px role-coloured left border, white uppercase H2. */
export function SectionBar({
  title,
  role = 'primary',
  actions,
  id,
  level = 2,
}: SectionBarProps): JSX.Element {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className={cx('jf-section-bar', `jf-section-bar--${role}`)}>
      <Heading id={id} className="jf-section-bar__title">
        {title}
      </Heading>
      {actions ? <div className="jf-section-bar__actions">{actions}</div> : null}
    </div>
  );
}
