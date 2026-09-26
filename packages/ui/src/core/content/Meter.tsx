// Meter (stage-3.md §6.1): a horizontal progress bar toward a money target. The fill is clamped at
// 100 % while the text keeps the true figure (STYLE_GUIDE §6.2, the gauge rule), and a status word
// says where the value stands, so the state is never colour-only.
import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { formatMoney } from '../format';

export type MeterStatus = 'reached' | 'over' | 'short';

export interface MeterProps {
  /** Small uppercase label above the bar, e.g. "Available cash". */
  label: string;
  /** The current figure (integer cents). May be negative or above the target. */
  valueCents: number;
  /** The target (integer cents, > 0). */
  targetCents: number;
  /** Money shown in whole dollars (`$12,480`) instead of cents. Default false. */
  wholeDollars?: boolean;
  /** An extra line under the figures (e.g. an ETA). */
  hint?: ReactNode;
  className?: string;
}

/** Where a value stands against its target: over it, exactly at it, or short of it. */
export function meterStatus(valueCents: number, targetCents: number): MeterStatus {
  if (targetCents <= 0 || valueCents === targetCents) return 'reached';
  return valueCents > targetCents ? 'over' : 'short';
}

/** The fill as a fraction of the track, clamped to 0..1. */
export function meterFill(valueCents: number, targetCents: number): number {
  if (targetCents <= 0) return 1;
  return Math.min(1, Math.max(0, valueCents / targetCents));
}

export function Meter({
  label,
  valueCents,
  targetCents,
  wholeDollars = false,
  hint,
  className,
}: MeterProps): JSX.Element {
  const labelId = useId();
  const money = (cents: number): string => formatMoney(cents, { wholeDollars });
  const status = meterStatus(valueCents, targetCents);
  const target = Math.max(0, targetCents);
  const clamped = Math.min(target, Math.max(0, valueCents));
  const figures = `${money(valueCents)} of ${money(targetCents)}`;
  const statusText =
    status === 'reached'
      ? 'Reached'
      : status === 'over'
        ? `Over by ${money(valueCents - targetCents)}`
        : `Short by ${money(targetCents - valueCents)}`;
  const valueText = status === 'over' ? `${figures}. ${statusText}` : figures;
  return (
    <div className={cx('jf-meter', className)} data-status={status}>
      <div className="jf-meter__head">
        <p id={labelId} className="jf-meter__label">
          {label}
        </p>
        <p className="jf-meter__status">{statusText}</p>
      </div>
      <div
        className="jf-meter__track"
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={target / 100}
        aria-valuenow={clamped / 100}
        aria-valuetext={valueText}
      >
        <span
          className="jf-meter__fill"
          style={{ width: `${(meterFill(valueCents, targetCents) * 100).toFixed(2)}%` }}
        />
      </div>
      <p className="jf-meter__figures">
        <span className="jf-meter__value">{money(valueCents)}</span>
        <span className="jf-meter__of"> of </span>
        <span className="jf-meter__target">{money(targetCents)}</span>
      </p>
      {hint ? <div className="jf-meter__hint">{hint}</div> : null}
    </div>
  );
}
