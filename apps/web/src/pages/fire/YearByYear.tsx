// "Year by year" (stage-6.md §6.3 item 7, §6.6): every projection row, balances at each anniversary
// of today and the year's flows at its end. Outflows carry U+2212; the milestone years carry their
// pills and the FIRE and access rows are marked (the sheet's highlight). On a phone the columns
// run status first. Newest last.
import { FIRE_PHASE_WORDS, type FireProjectionDto, type FireRowDto } from '@joinr/schema';
import { ColumnTable, MEDIA, Pill, useMediaQuery, type ColumnTableColumn } from '@joinr/ui';
import { useMemo, type JSX } from 'react';
import { highlightedRow, rowMilestones } from './fireChart';
import { money } from './fireText';

type Column = ColumnTableColumn<FireRowDto>;

/** An outflow (a positive amount paid out) with its U+2212; zero stays plain. */
function outflow(cents: number): string {
  return money(cents === 0 ? 0 : -cents);
}

function balance(cents: number): JSX.Element {
  return <span className={cents < 0 ? 'jf-app-negative' : undefined}>{money(cents)}</span>;
}

function columnsFor(projection: FireProjectionDto): Record<string, Column> {
  const milestones = rowMilestones(projection);
  return {
    year: {
      id: 'year',
      header: 'Year',
      value: (r) => r.year,
      cell: (r) => {
        const words = milestones.get(r.t);
        return (
          <span
            className="jf-app-fire-year"
            data-highlight={highlightedRow(projection, r) ? 'true' : undefined}
          >
            <span>{r.year}</span>
            {words?.map((word) => (
              <Pill key={word} tone="violet">
                {word}
              </Pill>
            ))}
          </span>
        );
      },
    },
    age: { id: 'age', header: 'Age', value: (r) => r.age, numeric: true },
    phase: {
      id: 'phase',
      header: 'Phase',
      value: (r) => FIRE_PHASE_WORDS[r.phase],
      minWidth: 220,
    },
    preStart: {
      id: 'preStart',
      header: 'Pre-super (start)',
      value: (r) => r.preSuper.startCents,
      cell: (r) => balance(r.preSuper.startCents),
      numeric: true,
    },
    saved: {
      id: 'saved',
      header: 'Saved',
      value: (r) => r.preSuper.savedCents,
      cell: (r) => money(r.preSuper.savedCents),
      numeric: true,
    },
    spent: {
      id: 'spent',
      header: 'Spent',
      value: (r) => r.preSuper.spentCents,
      cell: (r) => outflow(r.preSuper.spentCents),
      numeric: true,
    },
    topUp: {
      id: 'topUp',
      header: 'Top-up',
      value: (r) => r.preSuper.topUpCents,
      cell: (r) => outflow(r.preSuper.topUpCents),
      numeric: true,
    },
    preGrowth: {
      id: 'preGrowth',
      header: 'Pre-super growth',
      value: (r) => r.preSuper.growthCents,
      cell: (r) => money(r.preSuper.growthCents),
      numeric: true,
    },
    preEnd: {
      id: 'preEnd',
      header: 'Pre-super (end)',
      value: (r) => r.preSuper.endCents,
      cell: (r) => balance(r.preSuper.endCents),
      numeric: true,
    },
    superStart: {
      id: 'superStart',
      header: 'Super (start)',
      value: (r) => r.super.startCents,
      cell: (r) => money(r.super.startCents),
      numeric: true,
    },
    contributions: {
      id: 'contributions',
      header: 'Contributions + top-ups',
      value: (r) => r.super.contributedCents + r.super.topUpCents,
      cell: (r) => money(r.super.contributedCents + r.super.topUpCents),
      numeric: true,
    },
    superGrowth: {
      id: 'superGrowth',
      header: 'Super growth',
      value: (r) => r.super.growthCents,
      cell: (r) => money(r.super.growthCents),
      numeric: true,
    },
    withdrawn: {
      id: 'withdrawn',
      header: 'Withdrawn',
      value: (r) => r.super.withdrawnCents,
      cell: (r) => outflow(r.super.withdrawnCents),
      numeric: true,
    },
    superEnd: {
      id: 'superEnd',
      header: 'Super (end)',
      value: (r) => r.super.endCents,
      cell: (r) => money(r.super.endCents),
      numeric: true,
    },
  };
}

/** The columns in reading order (desktop and tablet). */
const YEAR_COLUMNS = [
  'year',
  'age',
  'phase',
  'preStart',
  'saved',
  'spent',
  'topUp',
  'preGrowth',
  'preEnd',
  'superStart',
  'contributions',
  'superGrowth',
  'withdrawn',
  'superEnd',
] as const;

/** Status first on a phone (§6.6). */
const YEAR_COLUMNS_PHONE = [
  'year',
  'phase',
  'preEnd',
  'superEnd',
  'age',
  'preStart',
  'saved',
  'spent',
  'topUp',
  'preGrowth',
  'superStart',
  'contributions',
  'superGrowth',
  'withdrawn',
] as const;

export function YearByYear({ projection }: { projection: FireProjectionDto }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const columns = useMemo(() => {
    const all = columnsFor(projection);
    return (phone ? YEAR_COLUMNS_PHONE : YEAR_COLUMNS).map((id) => all[id] as Column);
  }, [projection, phone]);
  return (
    <div className="jf-app-fire-years">
      <ColumnTable
        caption="Year by year, in today’s dollars. Growth includes your debts’ fall in today’s dollars; outflows are shown with −."
        showCaption
        columns={columns}
        rows={projection.rows}
        getRowId={(r) => String(r.t)}
        emptyMessage="No years to show until the inputs are set."
      />
    </div>
  );
}
