// Cell renderers shared by the cash-flow tables (stage-3.md §6.1, §6.3–6.6): the source word, a
// period with its Provisional / Baseline badge, the savings rate with its "Check" badge, and the
// money cells with the D33 colour rule (red only for a negative savings figure or rate and for a
// negative balance; flows stay in body text).
import type { DecimalString, IsoMonth, Origin, SavingsPeriodStatus } from '@joinr/schema';
import { StatusBadge } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { Missing } from '../../components/QueryStates';
import { MoneyCell, RatioCell } from '../investments/cells';
import { periodLabel, periodStatusBadge, rateNeedsCheck, sourceLabel } from './display';

export { MoneyCell, RatioCell };

/** "Workbook" or "App", muted. */
export function SourceCell({ origin }: { origin: Origin | null }): JSX.Element {
  return <span className="jf-app-muted">{sourceLabel(origin)}</span>;
}

/** A period label with its status badge in the same cell (the badge stays there on a phone). */
export function PeriodCell({
  periodMonth,
  status,
  label,
}: {
  periodMonth: IsoMonth;
  status: SavingsPeriodStatus | 'closed';
  /** Overrides the month label (e.g. "Baseline" text is a badge, the month stays). */
  label?: ReactNode;
}): JSX.Element {
  const badge = periodStatusBadge(status);
  return (
    <span className="jf-app-period-cell">
      <span className="jf-app-nowrap">{label ?? periodLabel(periodMonth)}</span>
      {badge ? <StatusBadge status={badge.status} label={badge.label} /> : null}
    </span>
  );
}

/**
 * A savings rate: negative rates in the stop tint (a real shortfall, D33); a rate above 100 % or
 * below 0 % carries a "Check" badge described by the visible foot note `checkNoteId`.
 */
export function SavingsRateCell({
  ratio,
  checkNoteId,
}: {
  ratio: DecimalString | null;
  checkNoteId: string;
}): JSX.Element {
  if (ratio === null) return <Missing />;
  return (
    <span className="jf-app-rate-cell">
      <RatioCell ratio={ratio} loss />
      {rateNeedsCheck(ratio) ? (
        <span className="jf-app-rate-check" aria-describedby={checkNoteId}>
          <StatusBadge status="check" label="Check" />
        </span>
      ) : null}
    </span>
  );
}

/** A savings figure: negative savings are a real shortfall (stop tint). */
export function SavingsCell({ cents }: { cents: number | null }): JSX.Element {
  return <MoneyCell cents={cents} loss />;
}

/** A flow (cash gain, added, adjustment, income, spend, deposit, dividend): body text always. */
export function FlowCell({ cents }: { cents: number | null }): JSX.Element {
  return <MoneyCell cents={cents} loss={false} />;
}

/** A balance of any account kind: a negative balance is money owed (stop tint). */
export function BalanceCell({ cents }: { cents: number | null }): JSX.Element {
  return <MoneyCell cents={cents} loss />;
}
