// The Super KPI tiles (stage-4.md §6.4 item 2): six at span 4. Total super is the page's only teal
// figure; a negative gain is a loss (stop tint with its sign). The cap tile's badge follows the
// projection, so the badge and the figures agree (UX-1).
import type { SuperPageResponse } from '@joinr/schema';
import {
  Grid,
  GridItem,
  StatTile,
  StatusBadge,
  formatDate,
  formatMoney,
  type StatDelta,
} from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import {
  CAP_STATUS_BADGES,
  NEEDS_90_DAYS,
  SG_SOURCE_WORDS,
  annualisedHidden,
  monthLabel,
  monthOfDate,
  percentText,
} from '../assets/display';
import { Marker } from '../assets/markers';
import {
  fundsText,
  gainMeasuredTo,
  isTransitionYear,
  latestBalanceDate,
  latestGainPeriod,
  provisionalPeriod,
} from './superText';

const DASH = '—';

function Money({ cents, loss = false }: { cents: number; loss?: boolean }): JSX.Element {
  return (
    <span className={loss && cents < 0 ? 'jf-app-negative' : undefined}>
      {formatMoney(cents, { wholeDollars: true })}
    </span>
  );
}

function returnDelta(ratio: string | null): StatDelta | undefined {
  if (ratio === null) return undefined;
  const value = Number(ratio);
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return {
    value: percentText(ratio) ?? ratio,
    direction,
    text: direction === 'down' ? 'return (a loss)' : 'return',
  };
}

export function SuperTiles({ page }: { page: SuperPageResponse }): JSX.Element {
  const held = page.funds.filter((f) => !f.archived);
  const latest = latestBalanceDate(page.funds);
  const gain = latestGainPeriod(page);
  const provisional = provisionalPeriod(page);
  const staleMonth = provisional?.notUpdated ?? false;
  const { annualised } = page;
  const year = page.capYears[0];
  const annualHidden = annualised.returnRatio === null || annualisedHidden(annualised.days);

  // D79: the provisional gain is measured only up to the latest balances, so it says to when.
  const measuredTo = gain?.status === 'provisional' ? gainMeasuredTo(page.funds) : null;
  const gainHint = gain
    ? staleMonth
      ? `${monthLabel(gain.periodMonth)} · Update your balances to see this month’s gain`
      : measuredTo
        ? `${monthLabel(gain.periodMonth)} · to ${formatDate(measuredTo)}`
        : monthLabel(gain.periodMonth)
    : 'Needs a second recorded balance';

  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint?: string;
    keyFigure?: boolean;
    delta?: StatDelta;
  }[] = [
    {
      key: 'total',
      label: 'Total super',
      value: formatMoney(page.totalCents, { wholeDollars: true }),
      keyFigure: true,
      hint: latest ? `${fundsText(held.length)} · ${formatDate(latest)}` : fundsText(held.length),
    },
    {
      key: 'gain',
      label: 'Latest gain',
      value: gain && gain.gainCents !== null ? <Money cents={gain.gainCents} loss /> : DASH,
      delta: gain ? returnDelta(gain.returnRatio) : undefined,
      hint: gainHint,
    },
    {
      key: 'annual',
      label: 'Return per year',
      value: annualHidden ? (
        DASH
      ) : (
        // A negative return is a loss (the stop tint), as the Stage 2 XIRR tile.
        <span className={Number(annualised.returnRatio) < 0 ? 'jf-app-negative' : undefined}>
          {percentText(annualised.returnRatio) ?? DASH}
        </span>
      ),
      hint:
        annualHidden || annualised.from === null
          ? NEEDS_90_DAYS
          : `since ${monthOfDate(annualised.from)} · ${annualised.days ?? 0} days`,
    },
  ];

  if (year) {
    const transition = isTransitionYear(year, page.statutory.paydaySuperStart);
    const badge = CAP_STATUS_BADGES[year.status];
    tiles.push(
      {
        key: 'contributed',
        label: 'Contributed this FY',
        value: (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            <Money cents={year.memberCents} />
            {year.estimateCount > 0 ? <Marker id="estimate" /> : null}
          </span>
        ),
        hint: `Fund receives ${formatMoney(year.memberFundCents, { wholeDollars: true })} · take-home cost ${formatMoney(year.memberNetPayCents, { wholeDollars: true })}`,
      },
      {
        key: 'sg',
        label: 'Employer SG this FY',
        value: <Money cents={year.sgGrossCents} />,
        hint:
          year.sgSource === 'none'
            ? 'No SG this financial year'
            : `To the fund ${formatMoney(year.sgFundCents, { wholeDollars: true })} · ${SG_SOURCE_WORDS[year.sgSource]}${transition ? ' · includes Apr–Jun 2026, paid in July' : ''}`,
      },
      {
        key: 'cap',
        label: 'Concessional cap',
        value: (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            <span>{percentText(year.ratio) ?? DASH} used</span>
            <StatusBadge status={badge.status} label={badge.label} />
          </span>
        ),
        hint: `projected ${percentText(year.projectedRatio) ?? DASH} by 30 June`,
      },
    );
  }

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
