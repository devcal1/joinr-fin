// Meter (stage-3.md §6.1): a horizontal progress bar toward a money target. The fill is clamped at
// 100 % while the text keeps the true figure (STYLE_GUIDE §6.2, the gauge rule), and a status word
// says where the value stands, so the state is never colour-only.
//
// Stage 4 (stage-4.md §6.1, UX-1), additive: `kind: 'cap'` words a limit instead of a target
// ("$X left under the cap", "At the cap", "Over the cap by $X"); `markerCents` draws a white tick
// across the track (a projection) whose figure is also in the text line, never tick-only; `tone`
// colours the fill (go / check / stop) and, for a cap, adds the status word Under / Near / Over.
// A cap under its limit so far but projected over (or to) it says so ("Projected over the cap by
// $X", "Projected to reach the cap"), so the text agrees with a badge that follows the projection,
// and the cap's aria-valuetext starts with the status word (Fixer round 1).
import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { formatMoney } from '../format';
import { StatusBadge, type StatusTone } from './StatusBadge';

export type MeterStatus = 'reached' | 'over' | 'short';

/** A target to reach (Stage 3) or a cap to stay under (Stage 4). */
export type MeterKind = 'target' | 'cap';

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
  /** Stage 4: 'cap' words the status against a limit. Default 'target' (the Stage 3 texts). */
  kind?: MeterKind;
  /** Stage 4: a white tick across the track at this figure (e.g. a projection). */
  markerCents?: number;
  /** Stage 4: names the tick's figure in the text line, e.g. "Projected by 30 June". */
  markerLabel?: string;
  /** Stage 4: the fill's colour (go / check / stop); a cap also shows Under / Near / Over. */
  tone?: StatusTone;
  /** Stage 4: words after the value in the figures line, e.g. "so far". */
  valueLabel?: string;
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

/** The status word of a cap meter's tone. */
export const METER_TONE_WORDS: Readonly<Record<StatusTone, string>> = {
  go: 'Under',
  check: 'Near',
  stop: 'Over',
};

const TONE_BADGE: Readonly<Record<StatusTone, 'go' | 'check' | 'stop'>> = {
  go: 'go',
  check: 'check',
  stop: 'stop',
};

/**
 * The status line: a target's "Short by $X" / "Reached" / "Over by $X", or a cap's words. For a
 * cap still under its limit, an optional `markerCents` (the projection) above or at the cap words
 * the projection instead ("Projected over the cap by $X", "Projected to reach the cap").
 */
export function meterStatusText(
  kind: MeterKind,
  valueCents: number,
  targetCents: number,
  money: (cents: number) => string,
  markerCents?: number,
): string {
  const status = meterStatus(valueCents, targetCents);
  if (kind === 'cap') {
    if (status === 'short' && markerCents !== undefined && Number.isFinite(markerCents)) {
      if (markerCents > targetCents) {
        return `Projected over the cap by ${money(markerCents - targetCents)}`;
      }
      if (markerCents === targetCents) return 'Projected to reach the cap';
    }
    if (status === 'reached') return 'At the cap';
    if (status === 'over') return `Over the cap by ${money(valueCents - targetCents)}`;
    return `${money(targetCents - valueCents)} left under the cap`;
  }
  if (status === 'reached') return 'Reached';
  if (status === 'over') return `Over by ${money(valueCents - targetCents)}`;
  return `Short by ${money(targetCents - valueCents)}`;
}

export function Meter({
  label,
  valueCents,
  targetCents,
  wholeDollars = false,
  hint,
  className,
  kind = 'target',
  markerCents,
  markerLabel,
  tone,
  valueLabel,
}: MeterProps): JSX.Element {
  const labelId = useId();
  const money = (cents: number): string => formatMoney(cents, { wholeDollars });
  const status = meterStatus(valueCents, targetCents);
  const target = Math.max(0, targetCents);
  const clamped = Math.min(target, Math.max(0, valueCents));
  const figures = `${money(valueCents)} of ${money(targetCents)}`;
  const hasMarker = typeof markerCents === 'number' && Number.isFinite(markerCents);
  const statusText = meterStatusText(
    kind,
    valueCents,
    targetCents,
    money,
    hasMarker ? markerCents : undefined,
  );
  const markerText =
    hasMarker && markerCents !== undefined
      ? `${markerLabel ?? 'Marker'} ${money(markerCents)}`
      : null;
  // The Stage 3 target texts are unchanged; a cap always says where it stands.
  const parts =
    kind === 'cap' ? [figures, statusText] : status === 'over' ? [figures, statusText] : [figures];
  if (markerText) parts.push(markerText);
  const toneWord = kind === 'cap' && tone ? METER_TONE_WORDS[tone] : null;
  // A cap's status word leads the accessible value, as the badge leads the status line.
  const valueText = (toneWord ? [toneWord, ...parts] : parts).join('. ');
  return (
    <div
      className={cx('jf-meter', className)}
      data-status={status}
      data-kind={kind}
      data-tone={tone}
    >
      <div className="jf-meter__head">
        <p id={labelId} className="jf-meter__label">
          {label}
        </p>
        <p className="jf-meter__status">
          {toneWord && tone ? <StatusBadge status={TONE_BADGE[tone]} label={toneWord} /> : null}
          <span className="jf-meter__status-text">{statusText}</span>
        </p>
      </div>
      <div className="jf-meter__bar">
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
        {hasMarker && markerCents !== undefined ? (
          <span
            className="jf-meter__marker"
            data-testid="meter-marker"
            aria-hidden="true"
            style={{ left: `${(meterFill(markerCents, targetCents) * 100).toFixed(2)}%` }}
          />
        ) : null}
      </div>
      <p className="jf-meter__figures">
        <span className="jf-meter__value">{money(valueCents)}</span>
        {valueLabel ? <span className="jf-meter__of"> {valueLabel}</span> : null}
        <span className="jf-meter__of"> of </span>
        <span className="jf-meter__target">{money(targetCents)}</span>
        {markerText && markerCents !== undefined ? (
          <span className="jf-meter__marker-text">
            <span className="jf-meter__of"> · {markerLabel ?? 'Marker'} </span>
            <span>{money(markerCents)}</span>
          </span>
        ) : null}
      </p>
      {hint ? <div className="jf-meter__hint">{hint}</div> : null}
    </div>
  );
}
