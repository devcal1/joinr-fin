// The holdings table (stage-2.md §6.3 item 4, §6.7): held rows, then watching rows, with a total
// row; exited holdings in their own closed <details>; a "More columns" switch remembered per
// browser; status-first column order on a phone (D31).
import type { HoldingRowDto, InvestmentPageResponse, IsoDate } from '@joinr/schema';
import {
  Amount,
  Callout,
  ColumnTable,
  MEDIA,
  Switch,
  formatDate,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { HoldingFlagBadges, HoldingName, MoneyCell, PriceCell, RatioCell, XirrCell } from './cells';
import {
  formatHoldingPrice,
  formatUnits,
  percentWords,
  sumCents,
  targetsNeedCheck,
  xirrHiddenForHolding,
} from './display';
import { KIND_META } from './kinds';
import { readMoreColumns, writeMoreColumns } from './storage';

type Column = ColumnTableColumn<HoldingRowDto>;

/** Watching (and exited) rows show dashes in the value-type cells (§6.3 item 4). */
const held = (row: HoldingRowDto): boolean => row.status === 'held';

const CORE_ORDER = [
  'holding',
  'value',
  'totalReturn',
  'returnRatio',
  'xirr',
  'units',
  'price',
  'current',
  'target',
  'difference',
  'dividends',
  'realised',
] as const;

/** Phone (D31): the status and the figures that matter first. */
const PHONE_CORE_ORDER = [
  'holding',
  'value',
  'totalReturn',
  'returnRatio',
  'price',
  'units',
  'xirr',
  'current',
  'target',
  'difference',
  'dividends',
  'realised',
] as const;

const MORE_ORDER = ['averagePrice', 'yield', 'mgmtFee', 'estFee', 'sector'] as const;

function holdingColumns(
  page: Pick<InvestmentPageResponse, 'kind' | 'asOf'>,
  firstTrades: ReadonlyMap<number, IsoDate> | null,
  options: { phone: boolean; more: boolean },
): Column[] {
  const { kind, asOf } = page;
  const meta = KIND_META[kind];
  const all: Record<string, Column> = {
    holding: {
      id: 'holding',
      header: 'Holding',
      value: (row) => row.symbol,
      cell: (row) => (
        <HoldingName
          kind={kind}
          instrumentId={row.instrumentId}
          symbol={row.symbol}
          name={row.name}
        >
          <HoldingFlagBadges flags={row.flags} />
        </HoldingName>
      ),
      minWidth: options.phone ? 120 : 170,
    },
    value: {
      id: 'value',
      header: 'Value',
      value: (row) => row.valueCents,
      cell: (row) => (held(row) ? <MoneyCell cents={row.valueCents} /> : <Missing />),
      numeric: true,
    },
    totalReturn: {
      id: 'totalReturn',
      header: 'Total return',
      value: (row) => row.totalReturnCents,
      cell: (row) => (held(row) ? <MoneyCell cents={row.totalReturnCents} /> : <Missing />),
      numeric: true,
    },
    returnRatio: {
      id: 'returnRatio',
      header: 'Return %',
      value: (row) => (row.totalReturnRatio === null ? null : Number(row.totalReturnRatio)),
      cell: (row) => (held(row) ? <RatioCell ratio={row.totalReturnRatio} loss /> : <Missing />),
      numeric: true,
    },
    xirr: {
      id: 'xirr',
      header: 'Est. return / yr',
      value: (row) => (row.xirr === null ? null : Number(row.xirr)),
      cell: (row) =>
        held(row) ? (
          <XirrCell xirr={row.xirr} hidden={xirrHiddenForHolding(row, firstTrades, asOf)} />
        ) : (
          <Missing />
        ),
      numeric: true,
    },
    units: {
      id: 'units',
      header: 'Units',
      value: (row) => Number(row.units),
      cell: (row) => (held(row) ? formatUnits(row.units, kind) : <Missing />),
      numeric: true,
    },
    price: {
      id: 'price',
      header: 'Price',
      value: (row) => (row.price.price === null ? null : Number(row.price.price)),
      cell: (row) => <PriceCell price={row.price} kind={kind} />,
      numeric: true,
    },
    current: {
      id: 'current',
      header: 'Current',
      value: (row) => (row.currentRatio === null ? null : Number(row.currentRatio)),
      cell: (row) => (held(row) ? <RatioCell ratio={row.currentRatio} /> : <Missing />),
      numeric: true,
    },
    target: {
      id: 'target',
      header: 'Target',
      value: (row) => (row.targetRatio === null ? null : Number(row.targetRatio)),
      cell: (row) => <RatioCell ratio={row.targetRatio} />,
      numeric: true,
    },
    difference: {
      id: 'difference',
      header: 'Difference',
      value: (row) => (row.differenceRatio === null ? null : Number(row.differenceRatio)),
      cell: (row) => <RatioCell ratio={row.differenceRatio} signed />,
      numeric: true,
    },
    dividends: {
      id: 'dividends',
      header: meta.dividendsLabel,
      value: (row) => row.dividendsCents,
      cell: (row) => <MoneyCell cents={row.dividendsCents} />,
      numeric: true,
    },
    realised: {
      id: 'realised',
      header: 'Realised',
      value: (row) => row.realisedCents,
      cell: (row) => <MoneyCell cents={row.realisedCents} />,
      numeric: true,
    },
    averagePrice: {
      id: 'averagePrice',
      header: 'Average price',
      value: (row) => (row.averagePrice === null ? null : Number(row.averagePrice)),
      cell: (row) =>
        row.averagePrice === null ? <Missing /> : formatHoldingPrice(row.averagePrice, kind),
      numeric: true,
    },
    yield: {
      id: 'yield',
      header: meta.yieldLabel,
      value: (row) => (row.dividendYieldRatio === null ? null : Number(row.dividendYieldRatio)),
      cell: (row) => <RatioCell ratio={row.dividendYieldRatio} />,
      numeric: true,
    },
    mgmtFee: {
      id: 'mgmtFee',
      header: 'Mgmt fee',
      value: (row) => (row.mgmtFeeRatio === null ? null : Number(row.mgmtFeeRatio)),
      // Fees are small: two decimals, so 0.07% does not read 0.1%.
      cell: (row) => <RatioCell ratio={row.mgmtFeeRatio} dp={2} />,
      numeric: true,
    },
    estFee: {
      id: 'estFee',
      header: 'Est. fee / yr',
      value: (row) => row.estMgmtFeeCents,
      cell: (row) => <MoneyCell cents={row.estMgmtFeeCents} />,
      numeric: true,
    },
    sector: {
      id: 'sector',
      header: 'Sector',
      value: (row) => row.sector,
      cell: (row) => row.sector ?? <Missing />,
      minWidth: 140,
    },
  };
  const more = MORE_ORDER.filter((id) => {
    if (id === 'mgmtFee' || id === 'estFee') return meta.hasRegions;
    if (id === 'sector') return meta.hasSector;
    return true;
  });
  const order = [...(options.phone ? PHONE_CORE_ORDER : CORE_ORDER), ...(options.more ? more : [])];
  return order.flatMap((id) => {
    const column = all[id];
    return column ? [column] : [];
  });
}

function exitedColumns(page: Pick<InvestmentPageResponse, 'kind'>): Column[] {
  return [
    {
      id: 'holding',
      header: 'Holding',
      value: (row) => row.symbol,
      cell: (row) => (
        <HoldingName
          kind={page.kind}
          instrumentId={row.instrumentId}
          symbol={row.symbol}
          name={row.name}
        >
          <HoldingFlagBadges flags={row.flags} />
        </HoldingName>
      ),
      minWidth: 150,
    },
    {
      id: 'realised',
      header: 'Realised',
      value: (row) => row.realisedCents,
      cell: (row) => <MoneyCell cents={row.realisedCents} />,
      numeric: true,
    },
    {
      id: 'lastTrade',
      header: 'Last trade',
      value: (row) => row.lastTradeDate,
      cell: (row) => (row.lastTradeDate ? formatDate(row.lastTradeDate) : <Missing />),
      numeric: true,
    },
  ];
}

export interface HoldingsTableProps {
  page: InvestmentPageResponse;
  /** First trade dates by instrument (the XIRR display rule); null while the ledger loads. */
  firstTrades: ReadonlyMap<number, IsoDate> | null;
}

export function HoldingsTable({ page, firstTrades }: HoldingsTableProps): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const [more, setMore] = useState(readMoreColumns);
  const meta = KIND_META[page.kind];
  const rows = page.holdings.filter((row) => row.status !== 'exited');
  const exited = page.holdings.filter((row) => row.status === 'exited');
  const columns = holdingColumns(page, firstTrades, { phone, more });

  const onMore = (on: boolean): void => {
    setMore(on);
    writeMoreColumns(on);
  };

  return (
    <>
      <Switch label="More columns" checked={more} onChange={onMore} />
      {/* Compact: the core columns fit the desktop content area without a sideways scroll. */}
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={columns}
          rows={rows}
          getRowId={(row) => String(row.instrumentId)}
          caption={`${meta.title} holdings`}
          emptyMessage={`No ${meta.plural} held or watched.`}
          total={{
            label: 'Total (priced holdings)',
            keyColumnId: 'value',
            cells: {
              value: <Amount cents={page.summary.valueCents} />,
              totalReturn: <Amount cents={page.summary.totalReturnCents} />,
              // The Σ of the rows shown, so the total equals what is visible (§6.3 item 4).
              dividends: <Amount cents={sumCents(rows.map((row) => row.dividendsCents))} />,
              realised: <Amount cents={sumCents(rows.map((row) => row.realisedCents))} />,
            },
          }}
        />
      </div>
      {targetsNeedCheck(page.summary.targetSumRatio) ? (
        <Callout kind="important" title="Targets">
          <p>
            Targets add up to {percentWords(page.summary.targetSumRatio)}. Set them to add up to
            100%.
          </p>
        </Callout>
      ) : null}
      {exited.length > 0 ? (
        <details className="jf-app-details">
          <summary className="jf-app-details__summary">Exited holdings ({exited.length})</summary>
          <ColumnTable
            columns={exitedColumns(page)}
            rows={exited}
            getRowId={(row) => String(row.instrumentId)}
            caption={`Exited ${meta.plural}`}
            total={{
              label: 'Total',
              cells: {
                realised: <Amount cents={sumCents(exited.map((row) => row.realisedCents))} />,
              },
            }}
          />
        </details>
      ) : null}
    </>
  );
}
