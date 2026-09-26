// The Other Assets KPI tiles (stage-4.md §6.3 item 2): six at span 4. Current value is the page's
// only teal figure; a loss (a negative gain or realised gain) uses the stop tint with its sign.
import type { OtherAssetsPageResponse } from '@joinr/schema';
import { Grid, GridItem, StatTile, StatusBadge, formatDate, formatMoney } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { plural } from '../../formatting';
import { itemsText, percentText } from '../assets/display';
import { ozHeldText, spotAsOf, spotLine, staleDaysOf, staleSpotTexts } from './otherAssetsText';

const DASH = '—';

function Money({ cents, loss = false }: { cents: number; loss?: boolean }): JSX.Element {
  return (
    <span className={loss && cents < 0 ? 'jf-app-negative' : undefined}>
      {formatMoney(cents, { wholeDollars: true })}
    </span>
  );
}

export function OtherAssetsTiles({ page }: { page: OtherAssetsPageResponse }): JSX.Element {
  const { totals } = page;
  const staleDays = staleDaysOf(page);
  const line = spotLine(page);
  const stale = staleSpotTexts(page);
  const asOf = spotAsOf(page);
  const spotValue: ReactNode =
    line === null ? (
      <span className="jf-app-tile-text">Spot unavailable: last known prices</span>
    ) : (
      <span className="jf-app-kv-stack">
        <span className="jf-app-tile-text">{line}</span>
        <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
          {asOf ? (
            <span className="jf-app-small jf-app-muted">As of {formatDate(asOf)}</span>
          ) : null}
          {stale.length > 0 ? <StatusBadge status="stale" /> : null}
        </span>
        {stale.map((text) => (
          <span key={text} className="jf-app-small jf-app-muted">
            {text}
          </span>
        ))}
      </span>
    );

  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint?: string;
    keyFigure?: boolean;
  }[] = [
    {
      key: 'value',
      label: 'Current value',
      value: formatMoney(totals.valueCents, { wholeDollars: true }),
      keyFigure: true,
      hint:
        totals.unpricedCount > 0
          ? `${itemsText(page.assets.length)} · ${totals.unpricedCount} without a price`
          : itemsText(page.assets.length),
    },
    {
      key: 'gain',
      label: 'Gain',
      value: <Money cents={totals.gainCents} loss />,
      hint:
        totals.gainRatio === null
          ? 'No item has both a value and a cost'
          : `${percentText(totals.gainRatio)} on cost`,
    },
    {
      key: 'cost',
      label: 'Cost',
      value: <Money cents={totals.costCents} />,
      hint:
        totals.assumedDateCount > 0 && page.assumedDate
          ? `Undated items count from ${formatDate(page.assumedDate)} (assumed)`
          : 'Of the items with a value',
    },
    {
      key: 'realised',
      label: 'Realised on sales',
      value: page.sales.length === 0 ? DASH : <Money cents={totals.realisedCents} loss />,
      hint:
        page.sales.length === 0
          ? 'No sales yet'
          : `${plural(page.sales.length, 'sale')} · proceeds ${formatMoney(totals.proceedsCents, { wholeDollars: true })}`,
    },
    {
      key: 'spot',
      label: 'Bullion spot',
      value: spotValue,
      hint: ozHeldText(page.assets),
    },
    {
      key: 'prices',
      label: 'Prices to update',
      value:
        totals.staleCount === 0 ? (
          <span className="jf-app-tile-text">All prices current</span>
        ) : (
          <span className="jf-app-tile-text">
            {totals.staleCount} older than {plural(staleDays, 'day')}
          </span>
        ),
      hint:
        totals.unpricedCount > 0
          ? `${plural(totals.unpricedCount, 'item')} without a price`
          : `Hand prices go stale after ${plural(staleDays, 'day')}`,
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
