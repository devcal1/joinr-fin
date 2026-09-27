// /prices: the price of every instrument, its source and freshness, manual overrides and the
// built-in market series (stage-1.md §5.6, §6.5).
import type { MarketQuoteItem, PriceItem, PricesResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Cluster,
  ColumnTable,
  KeyValueTable,
  MEDIA,
  PageHeader,
  Pill,
  SectionBar,
  Switch,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { errorMessage } from '../../api/client';
import { usePrices, useRefreshPrices } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { Missing, QueryStates } from '../../components/QueryStates';
import { formatDateTime } from '../../formatting';
import { ManualPriceForm } from './ManualPriceForm';
import { PriceSourceForm } from './PriceSourceForm';
import { PriceStatusBadge, SeriesStatusBadge } from './PriceBadges';
import {
  formatItemPrice,
  formatSeriesValue,
  formatUnits,
  kindLabel,
  orderSeries,
  refreshLine,
  refreshSummaryText,
  sourceLabel,
  statusReason,
} from './priceDisplay';

type Editing = { form: 'manual' | 'source'; instrumentId: number } | null;

export const MODE_OFF_NOTE =
  'Price fetching is switched off on this server (market data mode "off"). Manual prices still work.';

/** Wider screens: the columns in reading order. */
const PRICE_COLUMN_ORDER = [
  'instrument',
  'kind',
  'heldUnits',
  'price',
  'source',
  'asOf',
  'status',
  'lastError',
  'actions',
] as const;

/** Phone (D31): the price, its status and the actions show without scrolling sideways. */
const PHONE_PRICE_COLUMN_ORDER = [
  'instrument',
  'price',
  'status',
  'actions',
  'kind',
  'heldUnits',
  'source',
  'asOf',
  'lastError',
] as const;

/** Narrower minimum widths on a phone (the sticky Instrument column and Status). */
const PHONE_MIN_WIDTHS: Readonly<Record<string, number | undefined>> = {
  instrument: 104,
  status: undefined,
};

function priceColumns(
  onEdit: (editing: Editing) => void,
  phone: boolean,
): ColumnTableColumn<PriceItem>[] {
  const byId = new Map(allPriceColumns(onEdit).map((column) => [column.id, column]));
  const order = phone ? PHONE_PRICE_COLUMN_ORDER : PRICE_COLUMN_ORDER;
  return order.flatMap((id) => {
    const column = byId.get(id);
    if (!column) return [];
    return phone && id in PHONE_MIN_WIDTHS
      ? [{ ...column, minWidth: PHONE_MIN_WIDTHS[id] }]
      : [column];
  });
}

function allPriceColumns(onEdit: (editing: Editing) => void): ColumnTableColumn<PriceItem>[] {
  return [
    {
      id: 'instrument',
      header: 'Instrument',
      value: (item) => item.symbol,
      cell: (item) => (
        <span className="jf-app-instrument">
          <span className="jf-app-instrument__symbol">{item.symbol}</span>
          {item.name ? <span className="jf-app-instrument__name">{item.name}</span> : null}
        </span>
      ),
      sortable: true,
      minWidth: 160,
    },
    {
      id: 'kind',
      header: 'Kind',
      value: (item) => kindLabel(item.kind),
      cell: (item) => <Pill>{kindLabel(item.kind)}</Pill>,
      sortable: true,
    },
    {
      id: 'heldUnits',
      header: 'Held units',
      value: (item) => Number(item.heldUnits),
      cell: (item) => formatUnits(item.heldUnits),
      numeric: true,
      sortable: true,
    },
    {
      id: 'price',
      header: 'Price',
      value: (item) => (item.price === null ? null : Number(item.price)),
      cell: (item) => (item.price === null ? <Missing /> : formatItemPrice(item.price)),
      numeric: true,
      sortable: true,
    },
    {
      id: 'source',
      header: 'Source',
      value: (item) => sourceLabel(item),
      cell: (item) => {
        const label = sourceLabel(item);
        return label ? <span className="jf-app-nowrap">{label}</span> : <Missing />;
      },
    },
    {
      id: 'asOf',
      header: 'As of',
      value: (item) => item.asOf,
      cell: (item) => (item.asOf ? formatDateTime(item.asOf) : <Missing />),
      numeric: true,
      sortable: true,
      minWidth: 140,
    },
    {
      id: 'status',
      header: 'Status',
      value: (item) => item.status,
      cell: (item) => {
        const reason = statusReason(item);
        return (
          <span className="jf-app-status-cell">
            <PriceStatusBadge status={item.status} />
            {reason && reason !== item.lastError ? (
              <span className="jf-app-muted">{reason}</span>
            ) : null}
          </span>
        );
      },
      sortable: true,
      minWidth: 140,
    },
    {
      id: 'lastError',
      header: 'Last error',
      value: (item) => item.lastError,
      cell: (item) =>
        item.lastError ? <span className="jf-app-muted">{item.lastError}</span> : <Missing />,
    },
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (item) => (
        <span className="jf-app-row-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Set price for ${item.symbol}`}
            data-price-action={`manual-${item.instrumentId}`}
            onClick={() => onEdit({ form: 'manual', instrumentId: item.instrumentId })}
          >
            Set price
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Source for ${item.symbol}`}
            data-price-action={`source-${item.instrumentId}`}
            onClick={() => onEdit({ form: 'source', instrumentId: item.instrumentId })}
          >
            Source
          </Button>
        </span>
      ),
    },
  ];
}

function MarketSeriesCard({ series }: { series: readonly MarketQuoteItem[] }): JSX.Element {
  return (
    <Card as="section" title="Market series" subtitle="FX and bullion, used to convert prices">
      {series.length === 0 ? (
        <p className="jf-app-meta">No market series yet.</p>
      ) : (
        <KeyValueTable
          caption="Market series"
          items={orderSeries(series).map((item) => ({
            label: item.label,
            // Only the figure and its as-of time are mono; the badge and words keep the body face.
            value: (
              <span className="jf-app-series">
                <span className="jf-app-series__value">
                  {formatSeriesValue(item) ?? <Missing />}
                </span>
                <SeriesStatusBadge status={item.status} />
                {item.asOf ? (
                  <span className="jf-app-muted jf-app-num jf-app-num--inline">
                    {formatDateTime(item.asOf)}
                  </span>
                ) : item.lastError ? (
                  <span className="jf-app-muted">{item.lastError}</span>
                ) : null}
              </span>
            ),
          }))}
        />
      )}
    </Card>
  );
}

function PricesBody({ prices }: { prices: PricesResponse }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const [heldOnly, setHeldOnly] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // The row button that opened the form: focus goes back to it when the form closes.
  const returnFocus = useRef<Editing>(null);
  const editingItem = editing
    ? prices.items.find((item) => item.instrumentId === editing.instrumentId)
    : undefined;

  // Bring an opened form into view and put the cursor in its first field.
  useEffect(() => {
    if (!editing) return;
    const container = formRef.current;
    container?.scrollIntoView?.({ block: 'nearest' });
    container?.querySelector<HTMLElement>('input:not([type="hidden"]), select')?.focus();
  }, [editing]);

  // When a form closes (Cancel, Save, Clear), put focus back on the button that opened it, so
  // keyboard users keep their place in the table.
  useEffect(() => {
    const target = returnFocus.current;
    if (editing || !target) return;
    returnFocus.current = null;
    document
      .querySelector<HTMLElement>(`[data-price-action="${target.form}-${target.instrumentId}"]`)
      ?.focus();
  }, [editing]);

  const onEdit = (next: Editing): void => {
    setNotice(null);
    setEditing(next);
  };
  const close = (): void => {
    returnFocus.current = editing;
    setEditing(null);
  };
  const onDone = (message: string): void => {
    close();
    setNotice(message);
  };

  const rows = heldOnly ? prices.items.filter((item) => item.held) : prices.items;
  let emptyMessage: ReactNode = 'No instruments to price.';
  if (prices.items.length === 0) {
    emptyMessage = (
      <>
        No instruments yet. <Link to="/import">Import a workbook</Link> first.
      </>
    );
  } else if (heldOnly) {
    emptyMessage = 'No held instruments. Turn off “Held only” to see the watched ones.';
  }

  return (
    <>
      <LiveRegion kind="status" label="Save result">
        {notice ? (
          <Callout kind="note" title="Saved">
            <p>{notice}</p>
          </Callout>
        ) : null}
      </LiveRegion>
      {editingItem ? (
        <div ref={formRef}>
          {editing?.form === 'manual' ? (
            <ManualPriceForm
              key={`manual-${editingItem.instrumentId}`}
              item={editingItem}
              onDone={onDone}
              onCancel={close}
            />
          ) : (
            <PriceSourceForm
              key={`source-${editingItem.instrumentId}`}
              item={editingItem}
              onDone={onDone}
              onCancel={close}
            />
          )}
        </div>
      ) : null}
      <section className="jf-app-block" aria-labelledby="prices-instruments">
        <SectionBar id="prices-instruments" title="Instruments" role="primary" />
        <Switch label="Held only" checked={heldOnly} onChange={setHeldOnly} />
        <ColumnTable
          columns={priceColumns(onEdit, phone)}
          rows={rows}
          getRowId={(item) => String(item.instrumentId)}
          caption={heldOnly ? 'Prices of held instruments' : 'Prices of all instruments'}
          emptyMessage={emptyMessage}
        />
      </section>
      <MarketSeriesCard series={prices.series} />
    </>
  );
}

export function PricesPage(): JSX.Element {
  const query = usePrices();
  const refresh = useRefreshPrices();
  const prices = query.data;
  const off = prices?.mode === 'off';
  const running = refresh.isPending || prices?.running === true;

  const actions =
    prices && !off ? (
      <Button
        variant="secondary"
        icon={RefreshCw}
        onClick={() => refresh.mutate()}
        disabled={running}
        aria-busy={running || undefined}
      >
        {running ? 'Refreshing…' : 'Refresh now'}
      </Button>
    ) : undefined;

  return (
    <>
      <PageHeader title="Prices" subtitle="Market data for your holdings" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading prices…"
        layout="table"
        errorTitle="Could not load prices"
      />
      {prices ? (
        <>
          <Cluster gap={3} className="jf-app-freshness">
            <span className="jf-app-meta">{refreshLine(prices, new Date())}</span>
            {prices.mode === 'fake' ? <Pill>Test prices</Pill> : null}
          </Cluster>
          {off ? (
            <Callout kind="note" title="Refresh is off">
              <p>{MODE_OFF_NOTE}</p>
            </Callout>
          ) : null}
          {/* Persistent live regions: the refresh outcome is announced when it appears. */}
          <LiveRegion kind="status" label="Refresh result">
            {refresh.isSuccess ? (
              <Callout kind="note" title="Prices refreshed">
                <p>{refreshSummaryText(refresh.data.summary)}</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <LiveRegion kind="alert" label="Refresh error">
            {refresh.isError ? (
              <Callout kind="do-not" title="Refresh failed">
                <p>{errorMessage(refresh.error)}</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <PricesBody prices={prices} />
        </>
      ) : null}
    </>
  );
}
