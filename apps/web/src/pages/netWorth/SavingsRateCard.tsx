// "Savings rate FY2026–27" (stage-5.md §5, §6.3 item 4, D83): the gauge (0–100 %, the true figure
// even outside the range) with the planned rate as its target tick ("Budget plan N%", one decimal), "Income-weighted over N
// recorded months", and the average savings a month and a year (§11 fix 7).
import type { NetWorthPageResponse } from '@joinr/schema';
import { ChartCard, GaugeChart, KeyValueTable } from '@joinr/ui';
import type { JSX } from 'react';
import { plural } from '../../formatting';
import { DashWithReason, MoneyCell, RatioCell } from '../investments/cells';
import { yearLabel } from '../cashflow/display';

export const NO_RATE_YET = 'No recorded month this FY yet';

export function SavingsRateCard({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const { savingsRate, averageSavings } = page;
  const ratio = savingsRate.ratio === null ? null : Number(savingsRate.ratio);
  const target = savingsRate.targetRatio === null ? undefined : Number(savingsRate.targetRatio);
  const noRate = savingsRate.year.basis === 'fy' ? NO_RATE_YET : 'No recorded month this year yet';
  const averageNote =
    averageSavings.periods > 0 ? `over the last ${plural(averageSavings.periods, 'month')}` : null;
  const averages = (
    <KeyValueTable
      caption="Average savings"
      items={[
        {
          label: 'Average savings a month',
          value:
            averageSavings.monthCents === null ? (
              <DashWithReason reason="No average yet" />
            ) : (
              <span className="jf-app-kv-stack jf-app-align-end">
                <MoneyCell cents={averageSavings.monthCents} />
                {averageNote ? (
                  <span className="jf-app-meta jf-app-meta--prose" data-testid="average-note">
                    {averageNote}
                  </span>
                ) : null}
              </span>
            ),
          numeric: true,
        },
        {
          label: 'Average savings a year',
          value:
            averageSavings.yearCents === null ? (
              <DashWithReason reason="No average yet" />
            ) : (
              <MoneyCell cents={averageSavings.yearCents} />
            ),
          numeric: true,
        },
      ]}
    />
  );
  return (
    <ChartCard
      title={`Savings rate ${yearLabel(savingsRate.year)}`}
      subtitle={
        savingsRate.periods > 0
          ? `Income-weighted over ${plural(savingsRate.periods, 'recorded month')}`
          : undefined
      }
      chart={
        <div className="jf-app-block">
          <GaugeChart
            ariaLabel={`Savings rate ${yearLabel(savingsRate.year)}`}
            value={ratio ?? Number.NaN}
            target={target}
            targetLabel="Budget plan"
            label="Savings rate"
            emptyMessage={
              <span className="jf-app-gauge-empty">
                <span className="jf-app-gauge-empty__figure">—</span>
                <span>{noRate}</span>
              </span>
            }
            height={200}
          />
          {averages}
        </div>
      }
      table={
        <div className="jf-app-block">
          <KeyValueTable
            caption={`Savings rate ${yearLabel(savingsRate.year)}`}
            items={[
              {
                label: 'Savings rate',
                value:
                  savingsRate.ratio === null ? (
                    <DashWithReason reason={noRate} />
                  ) : (
                    <RatioCell ratio={savingsRate.ratio} loss />
                  ),
                numeric: true,
              },
              {
                label: 'Budget plan',
                value: <RatioCell ratio={savingsRate.targetRatio} />,
                numeric: true,
              },
              {
                label: 'Recorded months',
                value: String(savingsRate.periods),
                numeric: true,
              },
            ]}
          />
          {averages}
        </div>
      }
    />
  );
}
