// "Rolling net worth" (stage-5.md §6.3 item 6, §6.8): newest first by default: the projection in a
// closed disclosure above the table (muted, Month and projected liquid assets only, "Projected"),
// then the live row ("Live (provisional)"), then the recorded months ("Recorded late" on late
// rows; imported rows carry no badge). "Oldest first (as the sheet)" reverses it and is
// remembered per browser. Liabilities are positive owed figures; Offsets shows only when a row has
// offsets; the notes are the Cash spend notes.
import type { NetWorthPageResponse, RollingNetWorthRowDto } from '@joinr/schema';
import { ColumnTable, SectionBar, Switch, type ColumnTableColumn } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { useTableLayout } from '../assets/layout';
import { Marker } from '../assets/markers';
import type { MarkerId } from '../assets/display';
import { LIVE_FIRST_LABEL } from '../assets/display';
import { SavingsRateCell } from '../cashflow/cells';
import { RATE_CHECK_NOTE, rateNeedsCheck } from '../cashflow/display';
import { orderColumns } from '../cashflow/formState';
import { MoneyCell } from '../investments/cells';
import { readStored, writeStored } from '../investments/storage';
import { monthWords, owedCents } from '../history/display';
import { projectionSummary } from './netWorthText';

/** Remembers the rolling table's order per browser (the Stage 2 storage helper). */
export const ROLLING_ORDER_KEY = 'joinr.netWorth.rollingOldestFirst';

function rowMarkers(row: RollingNetWorthRowDto): MarkerId[] {
  if (row.status === 'live') return ['live'];
  if (row.status === 'projected') return ['projected'];
  return row.source === 'late' || row.source === 'lookback' ? ['recordedLate'] : [];
}

function markerLabel(id: MarkerId): string | undefined {
  return id === 'live' ? LIVE_FIRST_LABEL : undefined;
}

function buildColumns(
  notes: ReadonlyMap<string, string>,
  checkNoteId: string,
): Record<string, ColumnTableColumn<RollingNetWorthRowDto>> {
  const breakdown = <T,>(
    row: RollingNetWorthRowDto,
    pick: (b: NonNullable<RollingNetWorthRowDto['netWorth']>) => T,
  ): T | null => (row.netWorth ? pick(row.netWorth) : null);
  return {
    month: {
      id: 'month',
      header: 'Month',
      value: (row) => row.periodMonth,
      cell: (row) => (
        <span className="jf-app-first-cell">
          <span className="jf-app-first-cell__main">
            <span className="jf-app-nowrap">{monthWords(row.periodMonth)}</span>
            {rowMarkers(row).map((id) => (
              <Marker key={id} id={id} label={markerLabel(id)} />
            ))}
          </span>
        </span>
      ),
      minWidth: 150,
    },
    liquid: {
      id: 'liquid',
      header: 'Liquid assets',
      value: (row) => breakdown(row, (b) => b.liquidCents),
      cell: (row) => <MoneyCell cents={breakdown(row, (b) => b.liquidCents)} />,
      numeric: true,
    },
    super: {
      id: 'super',
      header: 'Super',
      value: (row) => breakdown(row, (b) => b.superCents),
      cell: (row) => <MoneyCell cents={breakdown(row, (b) => b.superCents)} />,
      numeric: true,
    },
    property: {
      id: 'property',
      header: 'Property',
      value: (row) => breakdown(row, (b) => b.propertyCents),
      cell: (row) => <MoneyCell cents={breakdown(row, (b) => b.propertyCents)} />,
      numeric: true,
    },
    liabilities: {
      id: 'liabilities',
      header: 'Liabilities',
      value: (row) => owedCents(breakdown(row, (b) => b.liabilitiesCents)),
      // Owed figures are positive and never tinted (§6.1).
      cell: (row) => (
        <MoneyCell cents={owedCents(breakdown(row, (b) => b.liabilitiesCents))} loss={false} />
      ),
      numeric: true,
    },
    offsets: {
      id: 'offsets',
      header: 'Offsets',
      value: (row) => breakdown(row, (b) => b.offsetsCents),
      cell: (row) => <MoneyCell cents={breakdown(row, (b) => b.offsetsCents)} />,
      numeric: true,
    },
    netWorth: {
      id: 'netWorth',
      header: 'Net worth',
      value: (row) => breakdown(row, (b) => b.netWorthCents),
      cell: (row) => <MoneyCell cents={breakdown(row, (b) => b.netWorthCents)} loss={false} />,
      numeric: true,
    },
    change: {
      id: 'change',
      header: 'Change',
      value: (row) => row.growthCents,
      cell: (row) => <MoneyCell cents={row.growthCents} />,
      numeric: true,
    },
    liquidChange: {
      id: 'liquidChange',
      header: 'Liquid change',
      value: (row) => row.liquidGrowthCents,
      cell: (row) => <MoneyCell cents={row.liquidGrowthCents} />,
      numeric: true,
    },
    rate: {
      id: 'rate',
      header: 'Savings rate',
      value: (row) => (row.savingsRatio === null ? null : Number(row.savingsRatio)),
      cell: (row) => <SavingsRateCell ratio={row.savingsRatio} checkNoteId={checkNoteId} />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (row) => notes.get(row.periodMonth) ?? null,
      cell: (row) => {
        const note = notes.get(row.periodMonth);
        return note ? <span className="jf-app-note-cell">{note}</span> : <Missing />;
      },
      minWidth: 140,
    },
  };
}

const DESKTOP = [
  'month',
  'liquid',
  'super',
  'property',
  'liabilities',
  'offsets',
  'netWorth',
  'change',
  'liquidChange',
  'rate',
  'note',
];
const PHONE = [
  'month',
  'netWorth',
  'change',
  'liquid',
  'rate',
  'super',
  'property',
  'liabilities',
  'offsets',
  'liquidChange',
  'note',
];

function readOldestFirst(): boolean {
  return readStored(ROLLING_ORDER_KEY) === 'true';
}

export function RollingSection({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const layout = useTableLayout();
  const [oldestFirst, setOldestFirst] = useState(readOldestFirst);
  const notes = new Map(page.notes.map((n) => [n.periodMonth, n.text]));
  const checkNoteId = 'rolling-rate-check';
  const all = buildColumns(notes, checkNoteId);
  const withOffsets = page.rolling.some((row) => (row.netWorth?.offsetsCents ?? 0) !== 0);
  const order = (layout.phone ? PHONE : DESKTOP).filter((id) => id !== 'offsets' || withOffsets);
  const shown = page.rolling.filter((row) => row.status !== 'projected');
  const projected = page.rolling.filter((row) => row.status === 'projected');
  const rows = oldestFirst ? shown : [...shown].reverse();
  const projectedRows = oldestFirst ? projected : [...projected].reverse();

  const toggle = (on: boolean): void => {
    setOldestFirst(on);
    writeStored(ROLLING_ORDER_KEY, on ? 'true' : 'false');
  };

  const projection =
    projected.length > 0 ? (
      <details className="jf-app-details" data-testid="rolling-projection">
        <summary className="jf-app-details__summary">
          {projectionSummary(projected.length, page.averageSavings.monthCents)}
        </summary>
        <div className="jf-app-projection">
          <ColumnTable
            columns={[
              all.month as ColumnTableColumn<RollingNetWorthRowDto>,
              {
                id: 'projectedLiquid',
                header: 'Projected liquid assets',
                value: (row) => row.projectedLiquidCents,
                // Projected figures are muted (§6.3 item 6); a negative one keeps the stop tint.
                cell: (row) => (
                  <span className="jf-app-muted" data-testid="projected-figure">
                    <MoneyCell cents={row.projectedLiquidCents} />
                  </span>
                ),
                numeric: true,
              },
              ...['super', 'property', 'liabilities', 'netWorth'].map((id) => ({
                id,
                header: all[id]?.header ?? id,
                value: () => null,
                cell: () => <Missing />,
                numeric: true,
              })),
            ]}
            rows={projectedRows}
            getRowId={(row) => row.periodMonth}
            caption="Projected liquid assets"
          />
        </div>
      </details>
    ) : null;

  return (
    <section className="jf-app-block" aria-labelledby="networth-rolling-heading">
      <SectionBar
        id="networth-rolling-heading"
        title="Rolling net worth"
        role="supporting"
        actions={
          <Switch label="Oldest first (as the sheet)" checked={oldestFirst} onChange={toggle} />
        }
      />
      {oldestFirst ? null : projection}
      <div className="jf-app-compact-table jf-app-wide-table jf-app-rolling-table">
        <ColumnTable
          columns={orderColumns(all, order)}
          rows={rows}
          getRowId={(row) => row.periodMonth}
          caption="Rolling net worth"
        />
      </div>
      {oldestFirst ? projection : null}
      {shown.some((row) => rateNeedsCheck(row.savingsRatio)) ? (
        <p id={checkNoteId} className="jf-app-meta">
          {RATE_CHECK_NOTE}
        </p>
      ) : null}
    </section>
  );
}
