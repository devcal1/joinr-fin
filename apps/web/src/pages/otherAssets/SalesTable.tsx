// Sales (stage-4.md §6.3 item 4, D72): Date · Item · Units · Proceeds · Cost · Realised gain · Note ·
// Actions (Edit, Delete with an in-row confirm). A negative realised gain is a loss (stop tint).
import type { OtherAssetDto, OtherAssetSaleDto, OtherAssetsPageResponse } from '@joinr/schema';
import {
  Amount,
  Button,
  ColumnTable,
  formatDate,
  formatQuantity,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { useDeleteOtherAssetSale } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { MoneyCell } from '../cashflow/cells';
import { DeleteConfirm, FormError } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { shortName, sumCents } from '../assets/display';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { saleActionKey } from './otherAssetsText';

const DESKTOP_ORDER = [
  'date',
  'item',
  'units',
  'proceeds',
  'cost',
  'realised',
  'note',
  'actions',
] as const;
const PHONE_ORDER = [
  'date',
  'item',
  'realised',
  'proceeds',
  'units',
  'cost',
  'note',
  'actions',
] as const;

const deleteSelector = (id: number): string => actionSelector(saleActionKey('delete', id));

export interface SalesTableProps {
  page: OtherAssetsPageResponse;
  locked: boolean;
  onEdit: (asset: OtherAssetDto, sale: OtherAssetSaleDto) => void;
  onDeleted: (message: string) => void;
}

export function SalesTable({ page, locked, onEdit, onDeleted }: SalesTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteOtherAssetSale();
  const rowDelete = useRowDelete<number>(deleteSelector);
  const assetOf = (sale: OtherAssetSaleDto): OtherAssetDto | undefined =>
    page.assets.find((a) => a.id === sale.assetId);
  const nameOf = (sale: OtherAssetSaleDto): string => {
    const asset = assetOf(sale);
    return asset ? shortName(asset.description) : `Item ${sale.assetId}`;
  };

  const all: Record<string, ColumnTableColumn<OtherAssetSaleDto>> = {
    date: {
      id: 'date',
      header: 'Date',
      value: (s) => s.saleDate,
      cell: (s) => (
        <FirstCell phone={phone} markers={[]}>
          <span className="jf-app-nowrap">{formatDate(s.saleDate)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(112, 104),
    },
    item: {
      id: 'item',
      header: 'Item',
      value: nameOf,
      cell: (s) => <span className="jf-app-note-cell">{nameOf(s)}</span>,
      minWidth: 200,
    },
    units: {
      id: 'units',
      header: 'Units',
      value: (s) => Number(s.units),
      cell: (s) => formatQuantity(s.units),
      numeric: true,
    },
    proceeds: {
      id: 'proceeds',
      header: 'Proceeds',
      value: (s) => s.proceedsCents,
      cell: (s) => <MoneyCell cents={s.proceedsCents} loss={false} />,
      numeric: true,
    },
    cost: {
      id: 'cost',
      header: 'Cost',
      value: (s) => s.costCents,
      cell: (s) => <MoneyCell cents={s.costCents} loss={false} />,
      numeric: true,
    },
    realised: {
      id: 'realised',
      header: 'Realised gain',
      value: (s) => s.realisedCents,
      cell: (s) => <MoneyCell cents={s.realisedCents} loss />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (s) => s.note,
      cell: (s) => (s.note ? <span className="jf-app-note-cell">{s.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (s) => {
        const label = `sale of ${nameOf(s)} on ${formatDate(s.saleDate)}`;
        if (rowDelete.confirming === s.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() => {
                // The table is shown only while there are sales: deleting the last one unmounts
                // it, and TanStack Query skips the mutate() callbacks of an unmounted observer;
                // the mutateAsync promise still settles, so the page announces the delete.
                void remove.mutateAsync(s.id).then(() => {
                  rowDelete.finish();
                  onDeleted('Sale deleted');
                }, rowDelete.fail);
              }}
              onCancel={rowDelete.cancel}
            />
          );
        }
        const asset = assetOf(s);
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit the ${label}`}
              data-cf-action={saleActionKey('edit', s.id)}
              onClick={() => (asset ? onEdit(asset, s) : undefined)}
              disabled={locked || !asset || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete the ${label}`}
              data-cf-action={saleActionKey('delete', s.id)}
              onClick={() => rowDelete.ask(s.id)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Delete
            </Button>
          </span>
        );
      },
    },
  };

  return (
    <div className="jf-app-block jf-app-sales-table">
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={page.sales}
        getRowId={(s) => String(s.id)}
        caption={`Sales: ${plural(page.sales.length, 'sale')}`}
        showCaption
        total={{
          label: 'Total',
          cells: {
            proceeds: <Amount cents={sumCents(page.sales.map((s) => s.proceedsCents))} />,
            realised: <Amount cents={page.totals.realisedCents} />,
          },
        }}
      />
    </div>
  );
}
