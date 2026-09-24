import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react';
import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';

export type DeltaDirection = 'up' | 'down' | 'flat';
export type DeltaTone = 'go' | 'stop' | 'neutral';

export interface StatDelta {
  /** The signed change, e.g. "+$1,240" or "−2.1%". */
  value: string;
  direction: DeltaDirection;
  /** The word that says what happened, e.g. "up this month". */
  text: string;
  /** Default: up → go, down → stop, flat → neutral (override when "up" is bad, e.g. costs). */
  tone?: DeltaTone;
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** The page's single key figure: the only teal figure on the page. */
  keyFigure?: boolean;
  delta?: StatDelta;
  hint?: string;
}

const ARROWS: Record<DeltaDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
};

const DEFAULT_TONE: Record<DeltaDirection, DeltaTone> = {
  up: 'go',
  down: 'stop',
  flat: 'neutral',
};

/** A KPI: uppercase label, monospaced figure; a delta shows an arrow, a sign and a word. */
export function StatTile({ label, value, keyFigure, delta, hint }: StatTileProps): JSX.Element {
  const labelId = useId();
  const tone = delta ? (delta.tone ?? DEFAULT_TONE[delta.direction]) : undefined;
  return (
    <div
      className={cx('jf-stat-tile', keyFigure && 'jf-stat-tile--key')}
      role="group"
      aria-labelledby={labelId}
    >
      <p id={labelId} className="jf-stat-tile__label">
        {label}
      </p>
      <p className="jf-stat-tile__value">{value}</p>
      {delta ? (
        <p className={cx('jf-stat-tile__delta', `jf-stat-tile__delta--${tone}`)}>
          <Icon icon={ARROWS[delta.direction]} />
          <span className="jf-stat-tile__delta-value">{delta.value}</span>
          <span className="jf-stat-tile__delta-text">{delta.text}</span>
        </p>
      ) : null}
      {hint ? <p className="jf-stat-tile__hint">{hint}</p> : null}
    </div>
  );
}
