// Price history (stage-4.md §6.3 item 4, UX-18, D72): one item's prices. A hand-priced item shows
// its price entries as a line in its own currency and a table (As of · Price · Note · Source ·
// Actions: Delete); a bullion item shows the spot history × its ounces per unit, in AUD. The item
// Select defaults to the item with the most entries; the page moves focus to this card's heading.
import type { OtherAssetPriceEntryDto, OtherAssetsPageResponse } from '@joinr/schema';
import {
  Button,
  ChartCard,
  ColumnTable,
  LineChart,
  Select,
  compactMoneyFormatter,
  formatDate,
  moneyFormatter,
  type ColumnTableColumn,
  type Series,
  type ValueFormatter,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { useDeleteOtherAssetPriceEntry } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { SourceCell } from '../cashflow/cells';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { plainPrice, shortName } from '../assets/display';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { METAL_LABELS, SPOT_EMPTY, chosenHistoryAsset } from './otherAssetsText';

const DESKTOP_ORDER = ['asOf', 'price', 'note', 'source', 'actions'] as const;
const dollarFormatter = moneyFormatter();
const entryKey = (id: number): string => `price-entry-delete-${id}`;

function currencyFormatter(currency: string): ValueFormatter {
  if (currency === 'AUD') return dollarFormatter;
  return (v) => `${plainPrice(String(v))} ${currency}`;
}

export interface PriceHistoryProps {
  page: OtherAssetsPageResponse;
  assetId: number | null;
  onAssetChange: (id: number) => void;
  onDeleted: (message: string) => void;
}

export function PriceHistory({
  page,
  assetId,
  onAssetChange,
  onDeleted,
}: PriceHistoryProps): JSX.Element | null {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteOtherAssetPriceEntry();
  const rowDelete = useRowDelete<number>((id) => actionSelector(entryKey(id)));
  const asset = chosenHistoryAsset(page, assetId);
  const entries = useMemo(
    () => (asset ? page.priceEntries.filter((e) => e.assetId === asset.id) : []),
    [page.priceEntries, asset],
  );
  const bullion = asset?.priceSource === 'bullion';
  const spot = useMemo(() => {
    if (!asset || asset.priceSource !== 'bullion' || asset.metal === null) return [];
    const oz = Number(asset.ozPerUnit ?? '0');
    return (page.spotHistory.find((h) => h.metal === asset.metal)?.points ?? []).map((p) => ({
      date: p.date,
      audPerUnit: Number(p.audPerOz) * oz,
    }));
  }, [asset, page.spotHistory]);
  const chart = useMemo(() => {
    if (bullion) {
      return {
        categories: spot.map((p) => formatDate(p.date)),
        series: [{ name: 'Price', data: spot.map((p) => p.audPerUnit) }] satisfies Series[],
      };
    }
    const ascending = [...entries].reverse();
    return {
      categories: ascending.map((e) => formatDate(e.asOf)),
      series: [
        { name: 'Price', data: ascending.map((e) => Number(e.unitPrice)) },
      ] satisfies Series[],
    };
  }, [bullion, entries, spot]);

  if (!asset) return null;
  const name = shortName(asset.description);
  const currency = bullion ? 'AUD' : asset.currency;
  const formatter = currencyFormatter(currency);
  const confirming = entries.find((e) => e.id === rowDelete.confirming);

  const columns: Record<string, ColumnTableColumn<OtherAssetPriceEntryDto>> = {
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (e) => e.asOf,
      cell: (e) => (
        <FirstCell phone={phone} markers={[]}>
          <span className="jf-app-nowrap">{formatDate(e.asOf)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(104),
    },
    price: {
      id: 'price',
      header: 'Price',
      value: (e) => Number(e.unitPrice),
      cell: (e) =>
        e.currency === 'AUD'
          ? `$${plainPrice(e.unitPrice)}`
          : `${plainPrice(e.unitPrice)} ${e.currency}`,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (e) => e.note,
      cell: (e) => (e.note ? <span className="jf-app-note-cell">{e.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (e) => e.origin,
      cell: (e) => <SourceCell origin={e.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (e) => {
        const label = `price of ${formatDate(e.asOf)}`;
        if (rowDelete.confirming === e.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(e.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Price deleted');
                  },
                  onError: rowDelete.fail,
                })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        return (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            aria-label={`Delete the ${label}`}
            data-cf-action={entryKey(e.id)}
            onClick={() => rowDelete.ask(e.id)}
            disabled={rowDelete.confirming !== null}
          >
            Delete
          </Button>
        );
      },
    },
  };

  const picker = (
    <div className="jf-app-card-select">
      <Select
        label="Item"
        value={String(asset.id)}
        onChange={(value) => onAssetChange(Number(value))}
        options={page.assets.map((a) => ({ value: String(a.id), label: shortName(a.description) }))}
      />
    </div>
  );

  const bullionNote =
    bullion && asset.metal ? (
      <p className="jf-app-meta">
        Priced from the {METAL_LABELS[asset.metal].toLowerCase()} spot price (AUD per ounce) ×{' '}
        {asset.ozPerUnit} oz
      </p>
    ) : null;

  const table = bullion ? (
    <div className="jf-app-block">
      <ColumnTable
        columns={[
          {
            id: 'date',
            header: 'Date',
            value: (p: { date: string; audPerUnit: number }) => p.date,
            cell: (p) => formatDate(p.date),
            minWidth: 104,
          },
          {
            id: 'price',
            header: 'Price per unit',
            value: (p) => p.audPerUnit,
            cell: (p) => dollarFormatter(p.audPerUnit),
            numeric: true,
          },
        ]}
        rows={[...spot].reverse()}
        getRowId={(p) => p.date}
        caption={`Price history: ${name}`}
        emptyMessage={SPOT_EMPTY}
      />
      {bullionNote}
    </div>
  ) : (
    <div className="jf-app-block">
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(columns, DESKTOP_ORDER)}
        rows={entries}
        getRowId={(e) => String(e.id)}
        caption={`Price history: ${name}`}
        emptyMessage="No prices recorded yet."
      />
    </div>
  );

  return (
    <ChartCard
      title="Price history"
      subtitle={name}
      actions={picker}
      chart={
        <div className="jf-app-block">
          <LineChart
            ariaLabel={`Price history of ${name}`}
            categories={chart.categories}
            series={chart.series}
            valueFormatter={formatter}
            axisFormatter={currency === 'AUD' ? compactMoneyFormatter : formatter}
            emptyMessage={bullion ? SPOT_EMPTY : 'No prices recorded yet'}
          />
          {bullionNote}
        </div>
      }
      table={table}
    />
  );
}
