// Realised gains by financial year (stage-2.md §2.10, §6.3 item 7, D42): short and long term,
// no tax. The total row is the all-time total; no teal cell.
import type { RealisedFyRowDto } from '@joinr/schema';
import {
  Amount,
  Callout,
  ColumnTable,
  MEDIA,
  formatFinancialYear,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import type { JSX } from 'react';
import { formatCount } from '../../formatting';
import { MoneyCell } from './cells';
import { sumCents } from './display';

export const NO_REALISED = 'No realised gains yet.';
export const NO_TAX_NOTE =
  'No tax is calculated. Long term = held 12 months or more; those gains may be eligible for the CGT discount.';

// Short headers, so a phone shows figures beside the year; the callout under the table defines the
// 12-month rule (Scaffold note 2026-09-25 — Fixer, amending §6.3 item 7 and §6.7).
const COLUMNS: ColumnTableColumn<RealisedFyRowDto>[] = [
  {
    id: 'financialYear',
    header: 'Financial year',
    value: (row) => row.financialYear,
    cell: (row) => <span className="jf-app-nowrap">{formatFinancialYear(row.financialYear)}</span>,
    minWidth: 130,
  },
  {
    id: 'short',
    header: 'Short term',
    value: (row) => row.shortTermCents,
    cell: (row) => <MoneyCell cents={row.shortTermCents} />,
    numeric: true,
  },
  {
    id: 'long',
    header: 'Long term',
    value: (row) => row.longTermCents,
    cell: (row) => <MoneyCell cents={row.longTermCents} />,
    numeric: true,
  },
  {
    id: 'total',
    header: 'Total',
    value: (row) => row.totalCents,
    cell: (row) => <MoneyCell cents={row.totalCents} />,
    numeric: true,
  },
  {
    id: 'disposals',
    header: 'Disposals',
    value: (row) => row.disposals,
    cell: (row) => formatCount(row.disposals),
    numeric: true,
  },
];

/** Phone (D31): the total right after the year, so the figure that matters is in view first. */
const PHONE_ORDER = ['financialYear', 'total', 'short', 'long', 'disposals'];

export function RealisedFyTable({ rows }: { rows: readonly RealisedFyRowDto[] }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const empty = rows.every((row) => row.disposals === 0);
  const columns = phone
    ? PHONE_ORDER.flatMap((id) => COLUMNS.filter((column) => column.id === id))
    : COLUMNS;
  return (
    <>
      {empty ? (
        <p className="jf-app-meta">{NO_REALISED}</p>
      ) : (
        <ColumnTable
          columns={columns}
          rows={rows}
          getRowId={(row) => String(row.financialYear)}
          caption="Realised gains by financial year"
          total={{
            label: 'All time',
            cells: {
              short: <Amount cents={sumCents(rows.map((row) => row.shortTermCents))} />,
              long: <Amount cents={sumCents(rows.map((row) => row.longTermCents))} />,
              total: <Amount cents={sumCents(rows.map((row) => row.totalCents))} />,
              disposals: formatCount(rows.reduce((n, row) => n + row.disposals, 0)),
            },
          }}
        />
      )}
      <Callout kind="note">
        <p>{NO_TAX_NOTE}</p>
      </Callout>
    </>
  );
}
