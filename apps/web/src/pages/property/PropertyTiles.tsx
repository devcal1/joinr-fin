// The Property KPI tiles (stage-4.md §6.5 item 2): six at span 4. Equity (net of offsets, D67) is
// the page's only teal figure; the mortgage is its net balance, a positive "balance" figure in body
// text (§6.1); interest and fees are an estimate (D66).
import type { PropertyPageResponse } from '@joinr/schema';
import { Grid, GridItem, StatTile, formatDate, formatMoney } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { percentText } from '../assets/display';
import { latestValuationDate, payoffTile } from './propertyText';

const DASH = '—';

function whole(cents: number): string {
  return formatMoney(cents, { wholeDollars: true });
}

export function PropertyTiles({ page }: { page: PropertyPageResponse }): JSX.Element {
  const { totals } = page;
  const hasOffsets = totals.offsetCents > 0;
  const valued = latestValuationDate(page.properties);
  const payoff = payoffTile(page);
  const hasProperty = page.properties.length > 0;
  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint?: string;
    keyFigure?: boolean;
  }[] = [
    {
      key: 'equity',
      label: 'Equity',
      value: (
        <span className={totals.equityCents < 0 ? 'jf-app-negative' : undefined}>
          {whole(totals.equityCents)}
        </span>
      ),
      keyFigure: true,
      hint: hasOffsets ? 'Value less the mortgage, net of offsets' : 'Value less the mortgage',
    },
    {
      key: 'value',
      label: 'Property value',
      value: whole(totals.valueCents),
      hint: valued ? `Valued ${formatDate(valued)}` : 'No property yet',
    },
    {
      key: 'mortgage',
      label: 'Mortgage',
      value: whole(totals.netMortgageCents),
      hint: hasOffsets
        ? `Offsets ${whole(totals.offsetCents)} · balance ${whole(totals.mortgageCents)}`
        : totals.mortgageCents > 0
          ? 'The balance owed'
          : 'No mortgage',
    },
    {
      key: 'lvr',
      label: 'Loan to value',
      value: hasProperty ? (percentText(totals.lvrRatio) ?? DASH) : DASH,
      hint: hasOffsets ? 'Net of offsets' : 'The mortgage ÷ the value',
    },
    {
      key: 'principal',
      label: 'Principal paid',
      value: whole(totals.principalPaidCents),
      hint: `Interest and fees ${whole(totals.interestFeesCents)}, estimated`,
    },
    { key: 'payoff', label: 'Paid off', value: payoff.value, hint: payoff.hint },
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
