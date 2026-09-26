// The Net Worth hero (stage-5.md §6.3 item 2, STYLE_GUIDE §7.2): the compact brand band with four
// KPI tiles on surface cards. Net worth is the page's one teal figure; each tile has at most one
// line under its figure (the delta when there is a change, else the hint), and StatTile draws the
// arrow, so no text carries a literal arrow.
import type { NetWorthPageResponse } from '@joinr/schema';
import { Grid, GridItem, HeroBand, StatTile, formatDate, formatMoney } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { changeDelta, monthWords, signedDollars } from '../history/display';

/** A change figure: signed whole dollars, the stop tint for a fall (D33); "—" without one. */
function changeFigure(cents: number | null): ReactNode {
  if (cents === null) return '—';
  const text = signedDollars(cents);
  return cents < 0 ? <span className="jf-app-negative">{text}</span> : text;
}

export function NetWorthTiles({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const { live, sinceLastRecord, thisYear } = page;
  const since = sinceLastRecord.base;
  const sinceDelta = changeDelta(sinceLastRecord);
  const yearDelta = changeDelta(thisYear);
  const fy = thisYear.year.basis === 'fy';
  return (
    <HeroBand height="compact" ariaLabel="Net worth summary">
      <Grid>
        <GridItem span={3} spanTablet={3}>
          <StatTile
            label="Net worth"
            value={formatMoney(live.netWorth.netWorthCents, { wholeDollars: true })}
            keyFigure
            hint={page.recordedToday ? 'Recorded today' : `Live · ${formatDate(page.asOf)}`}
          />
        </GridItem>
        <GridItem span={3} spanTablet={3}>
          <StatTile
            label={since ? `Since ${monthWords(since.periodMonth)}` : 'Since last record'}
            value={changeFigure(sinceLastRecord.cents)}
            delta={sinceDelta}
            hint={sinceDelta ? undefined : 'No recorded month yet'}
          />
        </GridItem>
        <GridItem span={3} spanTablet={3}>
          <StatTile
            label={fy ? 'This FY' : 'This year'}
            value={changeFigure(thisYear.cents)}
            delta={yearDelta}
            hint={
              yearDelta
                ? undefined
                : fy
                  ? 'No month recorded before 1 July'
                  : 'No month recorded before 1 January'
            }
          />
        </GridItem>
        <GridItem span={3} spanTablet={3}>
          <StatTile
            label="Liquid assets"
            value={formatMoney(live.netWorth.liquidCents, { wholeDollars: true })}
            hint="Excludes super and property"
          />
        </GridItem>
      </Grid>
    </HeroBand>
  );
}
