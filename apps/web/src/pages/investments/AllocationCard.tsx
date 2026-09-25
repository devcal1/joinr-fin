// The allocation card (stage-2.md §6.3 item 5): a donut with current as the outer ring and target
// as the inner ring, grouped by sector, region (ETFs and managed funds) or holding (crypto: by
// coin only), with a table twin. With no priced holding the card opens on its table view.
import {
  JoinrDecimal,
  type AllocationSliceDto,
  type InstrumentKind,
  type InvestmentPageResponse,
} from '@joinr/schema';
import {
  Button,
  ChartCard,
  ColumnTable,
  DonutChart,
  formatMoney,
  percentFormatter,
  type ColumnTableColumn,
  type Datum,
} from '@joinr/ui';
import { useMemo, useState, type JSX } from 'react';
import { RatioCell } from './cells';
import { percentWords } from './display';
import { KIND_META } from './kinds';

type SliceMode = 'sector' | 'region' | 'holding';

const MODES_BY_KIND: Readonly<Record<InstrumentKind, readonly SliceMode[]>> = {
  stock: ['sector', 'holding'],
  etf: ['sector', 'region', 'holding'],
  managed_fund: ['sector', 'region', 'holding'],
  crypto: ['holding'],
};

export const NO_PRICED_HOLDINGS = 'No priced holdings yet. Targets are in the table view.';

interface SliceRow extends AllocationSliceDto {
  differenceRatio: string;
}

const COLUMNS: ColumnTableColumn<SliceRow>[] = [
  { id: 'slice', header: 'Slice', value: (row) => row.label, minWidth: 140 },
  {
    id: 'current',
    header: 'Current',
    value: (row) => Number(row.currentRatio),
    cell: (row) => <RatioCell ratio={row.currentRatio} />,
    numeric: true,
  },
  {
    id: 'target',
    header: 'Target',
    value: (row) => Number(row.targetRatio),
    cell: (row) => <RatioCell ratio={row.targetRatio} />,
    numeric: true,
  },
  {
    id: 'difference',
    header: 'Difference',
    value: (row) => Number(row.differenceRatio),
    cell: (row) => <RatioCell ratio={row.differenceRatio} signed />,
    numeric: true,
  },
];

export function AllocationCard({ page }: { page: InvestmentPageResponse }): JSX.Element {
  const { kind, allocation, summary } = page;
  const meta = KIND_META[kind];
  const modes = MODES_BY_KIND[kind].filter((mode) =>
    mode === 'sector'
      ? allocation.bySector !== null
      : mode === 'region'
        ? allocation.byRegion !== null
        : true,
  );
  const [mode, setMode] = useState<SliceMode>(modes[0] ?? 'holding');
  const label = (m: SliceMode): string =>
    m === 'sector' ? 'By sector' : m === 'region' ? 'By region' : meta.holdingSliceLabel;

  const { data, target, rows } = useMemo(() => {
    const slices: readonly AllocationSliceDto[] =
      mode === 'sector'
        ? (allocation.bySector ?? [])
        : mode === 'region'
          ? (allocation.byRegion ?? [])
          : allocation.byHolding;
    const current: Datum[] = slices.map((s) => ({ label: s.label, value: Number(s.currentRatio) }));
    const goal: Datum[] = slices.map((s) => ({ label: s.label, value: Number(s.targetRatio) }));
    const table: SliceRow[] = slices.map((s) => ({
      ...s,
      differenceRatio: new JoinrDecimal(s.currentRatio).minus(s.targetRatio).toFixed(),
    }));
    return { data: current, target: goal, rows: table };
  }, [mode, allocation]);

  // No held holding is priced: the current ring is empty, so the numbers come first.
  const noPricedHoldings = !allocation.byHolding.some((s) => Number(s.currentRatio) > 0);
  // A donut shows no legend for a single slice, so its one category is named under the ring:
  // a full ring alone would not say which sector, region or holding it is.
  const only = rows.length === 1 && Number(rows[0]?.currentRatio) > 0 ? rows[0] : undefined;

  const switcher =
    modes.length > 1 ? (
      <div className="jf-app-segmented" role="group" aria-label="Allocation: group by">
        {modes.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={m === mode ? 'secondary' : 'ghost'}
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
          >
            {label(m)}
          </Button>
        ))}
      </div>
    ) : null;

  const name = `${meta.title} allocation, ${label(mode).toLowerCase()}`;
  return (
    <ChartCard
      title="Allocation"
      subtitle={modes.length > 1 ? undefined : label(mode)}
      defaultView={noPricedHoldings ? 'table' : 'chart'}
      actions={switcher}
      chart={
        <div className="jf-app-block">
          <DonutChart
            ariaLabel={`${name}: current (outer ring) against target (inner ring)`}
            data={data}
            target={target}
            valueFormatter={percentFormatter}
            centerLabel="Value"
            centerValue={formatMoney(summary.valueCents, { wholeDollars: true })}
            emptyMessage={NO_PRICED_HOLDINGS}
          />
          {only ? (
            <p className="jf-app-meta" data-testid="allocation-single-slice">
              {`${percentWords(only.currentRatio)} ${only.label}`}
            </p>
          ) : null}
        </div>
      }
      table={
        <ColumnTable
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.key}
          caption={name}
          emptyMessage="No holdings or targets yet."
        />
      }
    />
  );
}
