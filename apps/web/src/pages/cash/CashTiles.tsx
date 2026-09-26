// The Cash page's KPI tiles (stage-3.md §6.3 item 2, §6.10): six at span 4. Total cash is the
// page's only teal figure; negative savings figures use the stop tint (D33).
import type { CashPageResponse } from '@joinr/schema';
import { Grid, GridItem, StatTile, StatusBadge, formatMoney, type StatDelta } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { plural } from '../../formatting';
import {
  emergencyFundBasisText,
  emergencyFundStatus,
  isNegative,
  periodLabel,
  rateNeedsCheck,
  rateText,
  trendDelta,
  trendPointsText,
  yearLabel,
} from '../cashflow/display';
import { endedAnchorMonth } from './cashText';

interface Tile {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  keyFigure?: boolean;
  delta?: StatDelta;
}

const DASH = '—';

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** Whole-dollar money; a negative savings figure in the stop tint. */
function Money({ cents, loss = false }: { cents: number; loss?: boolean }): JSX.Element {
  return (
    <span className={loss && cents < 0 ? 'jf-app-negative' : undefined}>
      {formatMoney(cents, { wholeDollars: true })}
    </span>
  );
}

export function CashTiles({ page }: { page: CashPageResponse }): JSX.Element {
  const { totals, kpis } = page;
  const year = yearLabel(kpis.year);
  const hasOffsets = page.accounts.some((a) => a.isOffset);

  const last = kpis.lastPeriod;
  const lastRate = last ? rateText(last.savingsRatio) : null;
  const trendText = trendPointsText(kpis.trendPerMonth);
  const fund = totals.emergencyFund;
  const fundStatus = emergencyFundStatus(fund);
  // The year figures follow the last recorded month's year (§2.6); say so once that year is over.
  const anchorMonth = endedAnchorMonth(page);
  const anchorNote = anchorMonth ? ` · the year of the last recorded month (${anchorMonth})` : '';
  const yearRate = kpis.yearSavingsRatio;
  const yearRateCheck = rateNeedsCheck(yearRate);
  const yearRateFigure =
    yearRate === null ? null : (
      <span className={isNegative(yearRate) ? 'jf-app-negative' : undefined}>
        {rateText(yearRate)}
      </span>
    );

  const tiles: Tile[] = [
    {
      key: 'total',
      label: 'Total cash',
      value: formatMoney(totals.totalCashCents, { wholeDollars: true }),
      keyFigure: true,
      hint: hasOffsets
        ? `Offsets ${formatMoney(totals.offsetCents, { wholeDollars: true })} not included`
        : plural(page.accounts.length, 'account'),
    },
    {
      key: 'last',
      label: 'Last period saved',
      value: last && last.savingsCents !== null ? <Money cents={last.savingsCents} loss /> : DASH,
      hint: last
        ? `${lastRate === null ? 'No rate' : `${lastRate} of income`} · ${periodLabel(last.periodMonth)}`
        : 'Needs a recorded month after the baseline',
    },
    {
      key: 'avg',
      label: 'Saved per month',
      value: kpis.avgSavingsCents === null ? DASH : <Money cents={kpis.avgSavingsCents} loss />,
      hint:
        kpis.avgSavingsCents === null
          ? 'Needs recorded months'
          : `12-month average · ${plural(kpis.avgWindow?.periods ?? 0, 'period')}`,
    },
    {
      key: 'yearRate',
      label: `${year} savings rate`,
      // A rate above 100 % or below 0 % carries the savings table's Check badge (D51).
      value:
        yearRateFigure === null ? (
          DASH
        ) : yearRateCheck ? (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            {yearRateFigure}
            <StatusBadge status="check" label="Check" />
          </span>
        ) : (
          yearRateFigure
        ),
      hint:
        (yearRate === null
          ? `No recorded months in ${year} yet`
          : yearRateCheck
            ? `${plural(kpis.yearPeriods, 'period')} · Check: a one-off inflow or outflow usually causes this; add an adjustment`
            : plural(kpis.yearPeriods, 'period')) + anchorNote,
    },
    {
      key: 'trend',
      label: '3-month trend',
      value: trendText === null ? DASH : trendText,
      delta: trendText === null ? undefined : trendDelta(kpis.trend),
      hint:
        trendText === null ? 'Needs two recorded periods' : 'Savings rate, last 3 recorded months',
    },
    {
      key: 'fund',
      label: 'Emergency fund',
      value:
        fund.targetCents === null ? (
          DASH
        ) : (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            <span>{formatMoney(fund.targetCents, { wholeDollars: true })}</span>
            {fundStatus ? (
              <StatusBadge status={fundStatus.status} label={fundStatus.label} />
            ) : null}
          </span>
        ),
      // The figure is the target; the hint says so, then what counts toward it (D59, D56).
      hint:
        fund.targetCents === null
          ? 'Set pay and budget settings on the Budget page'
          : `Target. Counts ${lowerFirst(emergencyFundBasisText(fund))}`,
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
            delta={tile.delta}
            hint={tile.hint}
          />
        </GridItem>
      ))}
    </Grid>
  );
}
