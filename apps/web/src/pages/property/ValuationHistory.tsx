// Valuations (stage-4.md §6.5 item 4, UX-18): one property's valuations as a line and a table (As
// of · Value · Note · Source · Actions). A property keeps at least one valuation, so its last one
// has no Delete (409 LAST_BALANCE_ENTRY otherwise). The page moves focus to this card's heading.
import type { PropertyPageResponse, PropertyValuationDto } from '@joinr/schema';
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
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { useDeleteValuationEntry } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { BalanceCell, SourceCell } from '../cashflow/cells';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { toDollars } from '../assets/display';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { valuationActionKey } from './propertyText';

const ORDER = ['asOf', 'value', 'note', 'source', 'actions'] as const;
const dollarFormatter = moneyFormatter();

export interface ValuationHistoryProps {
  page: PropertyPageResponse;
  propertyId: number | null;
  onPropertyChange: (id: number) => void;
  onDeleted: (message: string) => void;
}

export function ValuationHistory({
  page,
  propertyId,
  onPropertyChange,
  onDeleted,
}: ValuationHistoryProps): JSX.Element | null {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteValuationEntry();
  const rowDelete = useRowDelete<number>((id) => actionSelector(valuationActionKey(id)));
  const property = page.properties.find((p) => p.id === propertyId) ?? page.properties[0] ?? null;
  const rows = useMemo(
    () => (property ? page.valuations.filter((v) => v.propertyId === property.id) : []),
    [page.valuations, property],
  );
  const chart = useMemo(() => {
    const ascending = [...rows].reverse();
    return {
      categories: ascending.map((v) => formatDate(v.asOf)),
      series: [
        { name: 'Value', data: ascending.map((v) => toDollars(v.valueCents)) },
      ] satisfies Series[],
    };
  }, [rows]);
  if (!property) return null;
  const onlyOne = rows.length <= 1;
  const confirming = rows.find((v) => v.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<PropertyValuationDto>> = {
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (v) => v.asOf,
      cell: (v) => (
        <FirstCell phone={phone} markers={[]}>
          <span className="jf-app-nowrap">{formatDate(v.asOf)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(104),
    },
    value: {
      id: 'value',
      header: 'Value',
      value: (v) => v.valueCents,
      cell: (v) => <BalanceCell cents={v.valueCents} />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (v) => v.note,
      cell: (v) => (v.note ? <span className="jf-app-note-cell">{v.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (v) => v.origin,
      cell: (v) => <SourceCell origin={v.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (v) => {
        const label = `valuation of ${formatDate(v.asOf)}`;
        if (onlyOne) return <span className="jf-app-muted">Last valuation</span>;
        if (rowDelete.confirming === v.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(v.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Valuation deleted');
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
            data-cf-action={valuationActionKey(v.id)}
            onClick={() => rowDelete.ask(v.id)}
            disabled={rowDelete.confirming !== null}
          >
            Delete
          </Button>
        );
      },
    },
  };

  const picker =
    page.properties.length > 1 ? (
      <div className="jf-app-card-select">
        <Select
          label="Property"
          value={String(property.id)}
          onChange={(value) => onPropertyChange(Number(value))}
          options={page.properties.map((p) => ({ value: String(p.id), label: p.name }))}
        />
      </div>
    ) : undefined;

  const table = (
    <div className="jf-app-block">
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(all, ORDER)}
        rows={rows}
        getRowId={(v) => String(v.id)}
        caption={`Valuations: ${property.name}`}
        emptyMessage="No valuations yet."
      />
      {onlyOne ? <p className="jf-app-meta">A property keeps at least one valuation.</p> : null}
    </div>
  );

  return (
    <ChartCard
      title="Valuations"
      subtitle={property.name}
      actions={picker}
      chart={
        <LineChart
          ariaLabel={`Valuations of ${property.name}`}
          categories={chart.categories}
          series={chart.series}
          valueFormatter={dollarFormatter}
          axisFormatter={compactMoneyFormatter}
          emptyMessage="No valuations yet"
        />
      }
      table={table}
    />
  );
}
