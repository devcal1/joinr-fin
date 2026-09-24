// Net Worth (Stage 0): the brand hero band with sample KPI tiles. The live dashboard is Stage 5.
import {
  Callout,
  Grid,
  GridItem,
  HeroBand,
  PageHeader,
  StatTile,
  formatMoney,
  formatMonth,
  formatPercent,
} from '@joinr/ui';
import type { JSX } from 'react';

/** Sample figures only (generic, STYLE_GUIDE §8 examples); nothing here is real data. */
const SAMPLE = {
  netWorthCents: 1_248_000,
  changeCents: 124_000,
  changeRatio: 0.11,
  savingsRate: 0.074,
  lastSnapshot: '2026-08',
} as const;

export function NetWorthPage(): JSX.Element {
  return (
    <>
      <PageHeader title="Net worth" subtitle="Overview" />
      <HeroBand height="compact" ariaLabel="Net worth summary (sample figures)">
        <Grid>
          <GridItem span={3} spanTablet={3}>
            <StatTile
              label="Net worth"
              value={formatMoney(SAMPLE.netWorthCents, { wholeDollars: true })}
              keyFigure
              hint="Sample figure"
            />
          </GridItem>
          <GridItem span={3} spanTablet={3}>
            <StatTile
              label="Change"
              value={formatMoney(SAMPLE.changeCents, { wholeDollars: true, signDisplay: 'always' })}
              delta={{
                value: formatPercent(SAMPLE.changeRatio, { signDisplay: 'always' }),
                direction: 'up',
                text: 'up since last month',
              }}
            />
          </GridItem>
          <GridItem span={3} spanTablet={3}>
            <StatTile
              label="Savings rate"
              value={formatPercent(SAMPLE.savingsRate)}
              hint="This financial year"
            />
          </GridItem>
          <GridItem span={3} spanTablet={3}>
            <StatTile
              label="Last snapshot"
              value={formatMonth(SAMPLE.lastSnapshot)}
              hint="Snapshots are monthly"
            />
          </GridItem>
        </Grid>
      </HeroBand>
      <Callout kind="note">Sample figures. The live dashboard arrives in Stage 5.</Callout>
    </>
  );
}
