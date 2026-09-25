// A holding's parcels, disposals and dividends (stage-2.md §6.5, §6.7).
import type { DisposalRowDto, HoldingDividendDto, InstrumentKind, LotRowDto } from '@joinr/schema';
import {
  ColumnTable,
  MEDIA,
  Pill,
  formatDate,
  formatFinancialYear,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { formatCount } from '../../formatting';
import { MoneyCell, RatioCell } from './cells';
import { formatHoldingPrice, formatUnits, termLabel } from './display';
import { KIND_META } from './kinds';

const LOT_ORDER = [
  'bought',
  'units',
  'left',
  'price',
  'fee',
  'costLeft',
  'unrealised',
  'returnRatio',
  'held',
  'term',
  'status',
] as const;

/** Phone (D31): what is left and what it would mean to sell it today come first. */
const PHONE_LOT_ORDER = [
  'bought',
  'left',
  'unrealised',
  'term',
  'units',
  'price',
  'fee',
  'costLeft',
  'returnRatio',
  'held',
  'status',
] as const;

export function LotsTable({
  kind,
  lots,
}: {
  kind: InstrumentKind;
  lots: readonly LotRowDto[];
}): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const all: Record<string, ColumnTableColumn<LotRowDto>> = {
    bought: {
      id: 'bought',
      header: 'Bought',
      value: (lot) => lot.tradeDate,
      cell: (lot) => formatDate(lot.tradeDate),
      numeric: true,
      minWidth: 104,
    },
    units: {
      id: 'units',
      header: 'Units',
      value: (lot) => Number(lot.units),
      cell: (lot) => formatUnits(lot.units, kind),
      numeric: true,
    },
    left: {
      id: 'left',
      header: 'Left',
      value: (lot) => Number(lot.remainingUnits),
      cell: (lot) => formatUnits(lot.remainingUnits, kind),
      numeric: true,
    },
    price: {
      id: 'price',
      header: 'Price',
      value: (lot) => Number(lot.price),
      cell: (lot) => formatHoldingPrice(lot.price, kind),
      numeric: true,
    },
    fee: {
      id: 'fee',
      header: 'Fee',
      value: (lot) => lot.feeCents,
      cell: (lot) => <MoneyCell cents={lot.feeCents} loss={false} />,
      numeric: true,
    },
    costLeft: {
      id: 'costLeft',
      header: 'Cost left',
      value: (lot) => lot.remainingCostCents,
      cell: (lot) => <MoneyCell cents={lot.remainingCostCents} loss={false} />,
      numeric: true,
    },
    unrealised: {
      id: 'unrealised',
      header: 'Unrealised',
      value: (lot) => lot.unrealisedCents,
      cell: (lot) => <MoneyCell cents={lot.unrealisedCents} />,
      numeric: true,
    },
    returnRatio: {
      id: 'returnRatio',
      header: 'Return %',
      value: (lot) => (lot.unrealisedRatio === null ? null : Number(lot.unrealisedRatio)),
      cell: (lot) => <RatioCell ratio={lot.unrealisedRatio} loss />,
      numeric: true,
    },
    held: {
      id: 'held',
      header: 'Held (days)',
      value: (lot) => lot.heldDays,
      cell: (lot) => formatCount(lot.heldDays),
      numeric: true,
    },
    term: {
      id: 'term',
      header: 'If sold today',
      value: (lot) => lot.termIfSoldToday,
      cell: (lot) =>
        lot.status === 'open' ? <Pill>{termLabel(lot.termIfSoldToday)}</Pill> : <Missing />,
    },
    status: {
      id: 'status',
      header: 'Status',
      value: (lot) => lot.status,
      cell: (lot) => (lot.status === 'open' ? 'Open' : 'Closed'),
    },
  };
  const columns = (phone ? PHONE_LOT_ORDER : LOT_ORDER).flatMap((id) => {
    const column = all[id];
    return column ? [column] : [];
  });
  return (
    <ColumnTable
      columns={columns}
      rows={lots}
      getRowId={(lot) => String(lot.tradeId)}
      caption="Parcels"
      emptyMessage="No parcels yet."
    />
  );
}

const DISPOSAL_COLUMNS = (kind: InstrumentKind): ColumnTableColumn<DisposalRowDto>[] => [
  {
    id: 'sold',
    header: 'Sold',
    value: (d) => d.sellDate,
    cell: (d) => formatDate(d.sellDate),
    numeric: true,
    minWidth: 104,
  },
  {
    id: 'bought',
    header: 'Bought',
    value: (d) => d.acquiredDate,
    cell: (d) => formatDate(d.acquiredDate),
    numeric: true,
  },
  {
    id: 'units',
    header: 'Units',
    value: (d) => Number(d.units),
    cell: (d) => formatUnits(d.units, kind),
    numeric: true,
  },
  {
    id: 'proceeds',
    header: 'Proceeds',
    value: (d) => d.proceedsCents,
    cell: (d) => <MoneyCell cents={d.proceedsCents} loss={false} />,
    numeric: true,
  },
  {
    id: 'cost',
    header: 'Cost',
    value: (d) => d.costCents,
    cell: (d) => <MoneyCell cents={d.costCents} loss={false} />,
    numeric: true,
  },
  {
    id: 'gain',
    header: 'Gain',
    value: (d) => d.gainCents,
    // Red only when negative (a loss).
    cell: (d) => <MoneyCell cents={d.gainCents} />,
    numeric: true,
  },
  { id: 'term', header: 'Term', value: (d) => termLabel(d.term) },
  {
    id: 'fy',
    header: 'FY',
    value: (d) => d.financialYear,
    cell: (d) => <span className="jf-app-nowrap">{formatFinancialYear(d.financialYear)}</span>,
  },
];

export function DisposalsTable({
  kind,
  disposals,
}: {
  kind: InstrumentKind;
  disposals: readonly DisposalRowDto[];
}): JSX.Element {
  return (
    <ColumnTable
      columns={DISPOSAL_COLUMNS(kind)}
      rows={disposals}
      getRowId={(d) => `${d.sellTradeId}-${d.lotTradeId}`}
      caption="Disposals"
      emptyMessage="Nothing sold yet."
    />
  );
}

export function DividendsTable({
  kind,
  dividends,
}: {
  kind: InstrumentKind;
  dividends: readonly HoldingDividendDto[];
}): JSX.Element {
  const meta = KIND_META[kind];
  const columns: ColumnTableColumn<HoldingDividendDto>[] = [
    {
      id: 'paid',
      header: 'Paid',
      value: (d) => d.paymentDate,
      cell: (d) => formatDate(d.paymentDate),
      numeric: true,
      minWidth: 104,
    },
    {
      id: 'exDate',
      header: 'Ex-date',
      value: (d) => d.exDate,
      cell: (d) => (d.exDate ? formatDate(d.exDate) : <Missing />),
      numeric: true,
    },
    {
      id: 'net',
      header: 'Net',
      value: (d) => d.netAmountCents,
      cell: (d) => <MoneyCell cents={d.netAmountCents} />,
      numeric: true,
    },
    {
      id: 'reinvested',
      header: 'Reinvested',
      value: (d) => (d.reinvested === null ? null : d.reinvested ? 'Yes' : 'No'),
      cell: (d) => (d.reinvested === null ? <Missing /> : d.reinvested ? 'Yes' : 'No'),
    },
    {
      id: 'priceAtEx',
      header: 'Price at ex-date',
      value: (d) => (d.priceAtEx === null ? null : Number(d.priceAtEx)),
      cell: (d) => (d.priceAtEx === null ? <Missing /> : formatHoldingPrice(d.priceAtEx, kind)),
      numeric: true,
    },
    {
      id: 'unitsAtEx',
      header: 'Units at ex-date',
      value: (d) => (d.unitsAtEx === null ? null : Number(d.unitsAtEx)),
      cell: (d) => (d.unitsAtEx === null ? <Missing /> : formatUnits(d.unitsAtEx, kind)),
      numeric: true,
    },
    {
      id: 'yield',
      header: 'Yield',
      value: (d) => (d.yieldRatio === null ? null : Number(d.yieldRatio)),
      cell: (d) => <RatioCell ratio={d.yieldRatio} />,
      numeric: true,
    },
  ];
  return (
    <ColumnTable
      columns={columns}
      rows={dividends}
      getRowId={(d) => String(d.id)}
      caption={meta.dividendsLabel}
      emptyMessage={`No ${meta.dividendsLabel.toLowerCase()} yet.`}
    />
  );
}
