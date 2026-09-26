// The dividends ledger (stage-3.md §6.6 item 4, §6.9): Holding, Kind and FY filters (`?holding=`
// preselects the holding), newest first, with Edit and Delete. Unlinked rows show the typed ticker
// with a "Not linked" badge. A dividend is a flow: body text, never red (D33).
import {
  INSTRUMENT_KINDS,
  type DividendRowDto,
  type DividendsPageResponse,
  type InstrumentKind,
} from '@joinr/schema';
import {
  Button,
  Cluster,
  ColumnTable,
  MEDIA,
  Select,
  StatusBadge,
  formatDate,
  formatFinancialYear,
  useMediaQuery,
  type ColumnTableColumn,
  type SelectOption,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useDeleteDividend } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { formatHoldingPrice, formatUnits } from '../investments/display';
import { ReviewFlagBadges } from '../investments/cells';
import { FlowCell, RatioCell, SourceCell } from '../cashflow/cells';
import { HOLDING_KIND_LABELS, yesNo } from '../cashflow/display';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { dividendActionKey } from './dividendsModel';

const DESKTOP_ORDER = [
  'paid',
  'holding',
  'kind',
  'exDate',
  'net',
  'reinvested',
  'price',
  'units',
  'yield',
  'source',
  'actions',
] as const;
const PHONE_ORDER = [
  'paid',
  'holding',
  'net',
  'reinvested',
  'kind',
  'exDate',
  'yield',
  'units',
  'price',
  'source',
  'actions',
] as const;

const deleteSelector = (id: number): string => actionSelector(dividendActionKey('delete', id));

/** Where the price at the ex-date came from: typed, the workbook's formula (an import row) or Yahoo. */
function priceSource(d: Pick<DividendRowDto, 'priceAtExManual' | 'origin'>): string {
  if (d.priceAtExManual) return 'Typed';
  return d.origin === 'import' ? 'Workbook' : 'Yahoo';
}

export interface LedgerSectionProps {
  page: DividendsPageResponse;
  /** `?holding=<id>` preselects the holding filter. */
  holding?: number;
  locked: boolean;
  onEdit: (dividend: DividendRowDto) => void;
  onDeleted: (message: string) => void;
}

export function LedgerSection({ page, holding, locked, onEdit, onDeleted }: LedgerSectionProps) {
  const phone = useMediaQuery(MEDIA.phone);
  // An unknown id (a stale link) falls back to every holding.
  const [holdingFilter, setHoldingFilter] = useState(() =>
    holding !== undefined &&
    (page.dividends.some((d) => d.instrumentId === holding) ||
      page.holdings.some((h) => h.instrumentId === holding))
      ? String(holding)
      : 'all',
  );
  const [kind, setKind] = useState('all');
  const [year, setYear] = useState('all');
  const remove = useDeleteDividend();
  const rowDelete = useRowDelete<number>(deleteSelector);
  const dividends = page.dividends;

  const holdingChoices = new Map<number, string>();
  for (const h of page.holdings) holdingChoices.set(h.instrumentId, h.symbol);
  for (const d of dividends) {
    if (d.instrumentId !== null && d.symbol !== null) holdingChoices.set(d.instrumentId, d.symbol);
  }
  const holdingOptions: SelectOption[] = [
    { value: 'all', label: 'All holdings' },
    ...[...holdingChoices.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, symbol]) => ({ value: String(id), label: symbol })),
    ...(dividends.some((d) => d.instrumentId === null)
      ? [{ value: 'unlinked', label: 'Not linked' }]
      : []),
  ];
  const kindOptions: SelectOption[] = [
    { value: 'all', label: 'All kinds' },
    ...INSTRUMENT_KINDS.map((k) => ({ value: k, label: HOLDING_KIND_LABELS[k] })),
  ];
  const years = [...new Set(dividends.map((d) => d.financialYear))].sort((a, b) => b - a);
  const yearOptions: SelectOption[] = [
    { value: 'all', label: 'All years' },
    ...years.map((y) => ({ value: String(y), label: formatFinancialYear(y) })),
  ];

  const rows = dividends.filter(
    (d) =>
      (holdingFilter === 'all' ||
        (holdingFilter === 'unlinked'
          ? d.instrumentId === null
          : String(d.instrumentId) === holdingFilter)) &&
      (kind === 'all' || d.holdingKind === (kind as InstrumentKind)) &&
      (year === 'all' || String(d.financialYear) === year),
  );
  const confirming = dividends.find((d) => d.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<DividendRowDto>> = {
    paid: {
      id: 'paid',
      header: 'Paid',
      value: (d) => d.paymentDate,
      cell: (d) => formatDate(d.paymentDate),
      numeric: true,
      minWidth: 104,
    },
    holding: {
      id: 'holding',
      header: 'Holding',
      value: (d) => d.symbol ?? d.ticker,
      cell: (d) => (
        <span className="jf-app-item-cell">
          <span className="jf-app-instrument__symbol">{d.symbol ?? d.ticker}</span>
          {d.instrumentId === null ? <StatusBadge status="check" label="Not linked" /> : null}
          <ReviewFlagBadges flags={d.flags.filter((f) => f !== 'unmatched_ticker')} />
          {d.note ? <span className="jf-app-instrument__name">{d.note}</span> : null}
        </span>
      ),
      minWidth: phone ? 110 : 130,
    },
    kind: {
      id: 'kind',
      header: 'Kind',
      value: (d) => d.holdingKind,
      cell: (d) => HOLDING_KIND_LABELS[d.holdingKind],
    },
    exDate: {
      id: 'exDate',
      header: 'Ex-date',
      value: (d) => d.exDate,
      cell: (d) => (d.exDate ? formatDate(d.exDate) : <Missing />),
      numeric: true,
    },
    net: {
      id: 'net',
      header: 'Net',
      value: (d) => d.netAmountCents,
      cell: (d) => <FlowCell cents={d.netAmountCents} />,
      numeric: true,
    },
    reinvested: {
      id: 'reinvested',
      header: 'Reinvested',
      value: (d) => yesNo(d.reinvested),
      cell: (d) =>
        d.reinvested === null ? <span className="jf-app-muted">Unknown</span> : yesNo(d.reinvested),
    },
    price: {
      id: 'price',
      header: 'Price at ex-date',
      value: (d) => (d.priceAtEx === null ? null : Number(d.priceAtEx)),
      cell: (d) =>
        d.priceAtEx === null ? (
          <Missing />
        ) : (
          <span className="jf-app-kv-stack jf-app-align-end">
            <span>{formatHoldingPrice(d.priceAtEx, d.holdingKind)}</span>
            <span className="jf-app-muted jf-app-small jf-app-text-value jf-app-text-value--whole">
              {priceSource(d)}
            </span>
          </span>
        ),
      numeric: true,
    },
    units: {
      id: 'units',
      header: 'Units then',
      value: (d) => (d.unitsAtEx === null ? null : Number(d.unitsAtEx)),
      cell: (d) => (d.unitsAtEx === null ? <Missing /> : formatUnits(d.unitsAtEx, d.holdingKind)),
      numeric: true,
    },
    yield: {
      id: 'yield',
      header: 'Yield',
      value: (d) => (d.yieldRatio === null ? null : Number(d.yieldRatio)),
      cell: (d) => <RatioCell ratio={d.yieldRatio} />,
      numeric: true,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (d) => d.origin,
      cell: (d) => <SourceCell origin={d.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (d) => {
        const label = `dividend of ${formatDate(d.paymentDate)} (${d.symbol ?? d.ticker})`;
        if (rowDelete.confirming === d.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(d.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Dividend deleted');
                  },
                  onError: rowDelete.fail,
                })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit the ${label}`}
              data-cf-action={dividendActionKey('edit', d.id)}
              onClick={() => onEdit(d)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete the ${label}`}
              data-cf-action={dividendActionKey('delete', d.id)}
              onClick={() => rowDelete.ask(d.id)}
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
    <>
      {dividends.length > 0 ? (
        <Cluster gap={4} align="end" className="jf-app-filters">
          <div className="jf-app-filters__section">
            <Select
              label="Holding"
              value={holdingFilter}
              onChange={setHoldingFilter}
              options={holdingOptions}
            />
          </div>
          <div className="jf-app-filters__section">
            <Select label="Kind" value={kind} onChange={setKind} options={kindOptions} />
          </div>
          <div className="jf-app-filters__section">
            <Select label="Financial year" value={year} onChange={setYear} options={yearOptions} />
          </div>
        </Cluster>
      ) : null}
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
          rows={rows}
          getRowId={(d) => String(d.id)}
          caption={`Dividends: ${plural(rows.length, 'payment')}`}
          showCaption
          emptyMessage={
            dividends.length === 0 ? 'No dividends yet.' : 'No dividends match the filters.'
          }
        />
      </div>
    </>
  );
}
