// The Budget page's KPI tiles (stage-3.md §6.5 item 2, §6.10): Left over each month is the teal
// figure; a negative actual spend carries a check badge and says why.
import type { BudgetPageResponse } from '@joinr/schema';
import { Grid, GridItem, StatTile, StatusBadge, formatMoney } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { PAY_FREQUENCY_WORDS, rateText } from '../cashflow/display';

const DASH = '—';

export const NEGATIVE_ACTUAL_HINT =
  'Savings exceeded income in some months; add one-off adjustments on the Cash page';

function money(cents: number | null): string {
  return cents === null ? DASH : formatMoney(cents, { wholeDollars: true });
}

export function BudgetTiles({ page }: { page: BudgetPageResponse }): JSX.Element {
  const { summary, actual } = page;
  const override = page.settings.values['budget.emergencyFundOverrideCents'];
  const months = page.settings.values['budget.emergencyFundMonths'];
  const incomeHint =
    summary.payFrequency === null
      ? 'Set the pay settings in Income and settings below'
      : `Net pay × ${PAY_FREQUENCY_WORDS[summary.payFrequency]} factor${summary.sideIncomeIncluded ? ' + side income' : ''}`;
  const fundHint =
    summary.emergencyFundCents === null
      ? 'Set pay and budget settings in Income and settings below'
      : typeof override === 'number'
        ? 'Set by you'
        : `${typeof months === 'number' ? months : 'N'} months of spending, rounded up to $1,000`;
  const negativeActual = actual.actualCents !== null && actual.actualCents < 0;

  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint: string;
    keyFigure?: boolean;
  }[] = [
    {
      key: 'income',
      label: 'Monthly income',
      value: money(summary.monthlyIncomeCents),
      hint: incomeHint,
    },
    {
      key: 'spend',
      label: 'Planned spend',
      value: money(summary.plannedSpendCents),
      hint: 'Budget items and the yearly-expenses fund',
    },
    {
      key: 'leftover',
      label: 'Left over each month',
      value: money(summary.leftoverCents),
      keyFigure: true,
      hint:
        summary.leftoverCents === null
          ? 'Set the pay settings in Income and settings below'
          : 'Split between investments and cash',
    },
    {
      key: 'fund',
      label: 'Emergency fund',
      value: money(summary.emergencyFundCents),
      hint: fundHint,
    },
    {
      key: 'rate',
      label: 'Planned savings rate',
      value: rateText(summary.plannedSavingsRatio) ?? DASH,
      hint: 'The automatic investment and cash rows ÷ income',
    },
    {
      key: 'actual',
      label: 'Actual spend',
      value:
        actual.actualCents === null ? (
          DASH
        ) : negativeActual ? (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            <span>{money(actual.actualCents)}</span>
            <StatusBadge status="check" label="Check" />
          </span>
        ) : (
          money(actual.actualCents)
        ),
      hint:
        actual.actualCents === null
          ? 'Needs recorded months'
          : negativeActual
            ? NEGATIVE_ACTUAL_HINT
            : `6-month average (adjusted) of ${actual.periods} recorded months`,
    },
  ];
  return (
    <Grid className="jf-app-kpis">
      {tiles.map((tile) => (
        <GridItem key={tile.key} span={4}>
          <StatTile
            label={tile.label}
            value={tile.value}
            keyFigure={tile.keyFigure}
            hint={tile.hint}
          />
        </GridItem>
      ))}
    </Grid>
  );
}
