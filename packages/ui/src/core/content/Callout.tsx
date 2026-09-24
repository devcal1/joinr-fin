import { Ban, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';

/** note = teal (context) · important = orange (money or a deadline at stake) · do-not = red (destructive). */
export type CalloutKind = 'note' | 'important' | 'do-not';

export interface CalloutProps {
  kind: CalloutKind;
  /** Default: NOTE / IMPORTANT / DO NOT. */
  title?: string;
  children: ReactNode;
}

const CALLOUTS: Record<CalloutKind, { title: string; icon: LucideIcon }> = {
  note: { title: 'Note', icon: Info },
  important: { title: 'Important', icon: TriangleAlert },
  'do-not': { title: 'Do not', icon: Ban },
};

/** A `--surface` note with a 4px accent border; the heading word carries the meaning, not the colour. */
export function Callout({ kind, title, children }: CalloutProps): JSX.Element {
  const titleId = useId();
  const { title: defaultTitle, icon } = CALLOUTS[kind];
  return (
    <div className={cx('jf-callout', `jf-callout--${kind}`)} role="note" aria-labelledby={titleId}>
      <p id={titleId} className="jf-callout__title">
        <Icon icon={icon} />
        <span>{title ?? defaultTitle}</span>
      </p>
      <div className="jf-callout__body jf-prose">{children}</div>
    </div>
  );
}
