import { CircleAlert, CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';
import type { JSX } from 'react';
import { Icon } from '../layout/Icon';

/** Only for real states: go / check / stop, fresh / stale / failed, recorded / pending. */
export type StatusKind =
  'go' | 'check' | 'stop' | 'fresh' | 'stale' | 'failed' | 'recorded' | 'pending';
export type StatusTone = 'go' | 'check' | 'stop';

export interface StatusBadgeProps {
  status: StatusKind;
  /** Default: the status word (shown uppercase). */
  label?: string;
}

const STATUSES: Record<StatusKind, { tone: StatusTone; label: string; icon: LucideIcon }> = {
  go: { tone: 'go', label: 'Go', icon: CircleCheck },
  fresh: { tone: 'go', label: 'Fresh', icon: CircleCheck },
  recorded: { tone: 'go', label: 'Recorded', icon: CircleCheck },
  check: { tone: 'check', label: 'Check', icon: CircleAlert },
  stale: { tone: 'check', label: 'Stale', icon: Clock },
  pending: { tone: 'check', label: 'Pending', icon: Clock },
  stop: { tone: 'stop', label: 'Stop', icon: CircleX },
  failed: { tone: 'stop', label: 'Failed', icon: CircleX },
};

/** The tone (green / orange / red) a status maps to. */
export function statusTone(status: StatusKind): StatusTone {
  return STATUSES[status].tone;
}

/** 16% fill, full-strength border, light-tint text; always an icon and a word (never colour alone). */
export function StatusBadge({ status, label }: StatusBadgeProps): JSX.Element {
  const { tone, label: defaultLabel, icon } = STATUSES[status];
  return (
    <span className={`jf-badge jf-badge--${tone}`} data-status={status}>
      <Icon icon={icon} className="jf-badge__icon" />
      <span className="jf-badge__label">{label ?? defaultLabel}</span>
    </span>
  );
}
