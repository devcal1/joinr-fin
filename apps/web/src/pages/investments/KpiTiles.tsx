// The KPI tiles (stage-2.md §6.3 item 3, §6.8): rows are always full — six tiles at span 4 on
// stocks, managed funds and crypto; eight at span 3 on ETFs. Portfolio value is the page's only
// teal figure.
import type { InvestmentPageResponse, IsoDate } from '@joinr/schema';
import {
  Amount,
  Grid,
  GridItem,
  StatTile,
  StatusBadge,
  formatMoney,
  type Span,
  type StatDelta,
} from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import {
  HELD_UNDER_90_DAYS,
  etfCounts,
  formatRatio,
  hasNoTrades,
  percentWords,
  returnDelta,
  valueTileHint,
  xirrHiddenForKind,
} from './display';
import { KIND_META } from './kinds';

interface Tile {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  keyFigure?: boolean;
  delta?: StatDelta;
}

export interface KpiTilesProps {
  page: InvestmentPageResponse;
  /** First trade dates by instrument (the XIRR display rule); null while the ledger loads. */
  firstTrades: ReadonlyMap<number, IsoDate> | null;
}

export function KpiTiles({ page, firstTrades }: KpiTilesProps): JSX.Element {
  const { kind, summary, settings } = page;
  const meta = KIND_META[kind];
  const noTrades = hasNoTrades(page.holdings);
  const xirrHidden = xirrHiddenForKind(page.holdings, firstTrades, page.asOf);

  let xirrValue: ReactNode = '—';
  let xirrHint = 'Portfolio XIRR: trades, dividends and today’s value';
  if (noTrades) {
    xirrHint = 'No trades yet';
  } else if (xirrHidden) {
    xirrHint = HELD_UNDER_90_DAYS;
  } else if (summary.xirr === null) {
    xirrHint = 'Needs a priced holding and two dates';
  } else {
    xirrValue = (
      <span className={Number(summary.xirr) < 0 ? 'jf-app-negative' : undefined}>
        {formatRatio(summary.xirr)}
      </span>
    );
  }

  let dividendsHint = `All time ${formatMoney(summary.dividendsAllTimeCents)}`;
  if (kind === 'crypto' && settings.cryptoFeeRate !== null) {
    dividendsHint += ` · fee rate ${percentWords(settings.cryptoFeeRate)}`;
  }

  const tiles: Tile[] = [
    {
      key: 'value',
      label: 'Portfolio value',
      value: formatMoney(summary.valueCents, { wholeDollars: true }),
      keyFigure: true,
      hint: valueTileHint(summary, kind, noTrades),
    },
    {
      key: 'totalReturn',
      label: 'Total return',
      value: <Amount cents={summary.totalReturnCents} />,
      delta: returnDelta(summary.totalReturnRatio),
      hint: noTrades ? 'No trades yet' : 'Unrealised + dividends, priced holdings',
    },
    {
      key: 'realised',
      label: 'Realised gains',
      value: <Amount cents={summary.realisedCents} />,
      hint: noTrades ? 'No trades yet' : `This FY ${formatMoney(summary.realisedThisFyCents)}`,
    },
    { key: 'xirr', label: 'Est. return / yr', value: xirrValue, hint: xirrHint },
    {
      key: 'rate',
      label: 'Invested / month',
      value:
        summary.investmentRatePerMonthCents === null
          ? '—'
          : `${formatMoney(summary.investmentRatePerMonthCents, { wholeDollars: true })}/month`,
      hint:
        summary.investmentRatePerMonthCents === null
          ? noTrades
            ? 'No trades yet'
            : 'No trades in the last 12 months'
          : 'Buys over the last 12 months',
    },
    {
      key: 'dividends',
      label: `${meta.dividendsLabel} this FY`,
      value: <Amount cents={summary.dividendsThisFyCents} />,
      hint: dividendsHint,
    },
  ];

  if (kind === 'etf') {
    const counts = etfCounts(summary, settings.etfLimit);
    tiles.push(
      {
        key: 'counts',
        label: 'Holdings',
        value: (
          <span className="jf-app-tile-flag jf-app-tile-flag--wrap">
            {/* A no-break space keeps each count with its word ("limit 6"), so a narrow tile
                wraps at a separator and never leaves a number on its own line. */}
            <span>{counts.text.replace(/ (?=\d)/g, ' ')}</span>
            {counts.overLimit ? <StatusBadge status="check" label="Over limit" /> : null}
          </span>
        ),
        hint: 'Held · with a target · the ETF limit',
      },
      {
        key: 'fees',
        label: 'Est. fees / yr',
        value: summary.estMgmtFeeCents === null ? '—' : <Amount cents={summary.estMgmtFeeCents} />,
        hint: 'Management fees on today’s value',
      },
    );
  }

  const span: Span = kind === 'etf' ? 3 : 4;
  return (
    <Grid className="jf-app-kpis">
      {tiles.map((tile) => (
        <GridItem key={tile.key} span={span}>
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
