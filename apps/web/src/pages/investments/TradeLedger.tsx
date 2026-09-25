// The trade ledger (stage-2.md §6.3 item 8, §6.7): newest first, with Holding and Side filters,
// the result of each trade, review flags, the row's source, and Edit / Delete actions. Delete
// confirms inside the Actions cell ("Delete the ASX:DEF buy of 18/08/2026? [Delete] [Cancel]";
// focus on Cancel, Escape cancels).
import type { InstrumentKind, TradeRowDto } from '@joinr/schema';
import {
  Button,
  Callout,
  Cluster,
  ColumnTable,
  MEDIA,
  Select,
  StatusBadge,
  formatDate,
  useMediaQuery,
  type ColumnTableColumn,
  type SelectOption,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { errorMessage, isApiError } from '../../api/client';
import { useDeleteTrade } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { IMPORT_RUNNING_MESSAGE } from './apiErrors';
import { HoldingName, MoneyCell, ReviewFlagBadges } from './cells';
import { feeText, formatHoldingPrice, formatUnits, sideLabel, tradeActionKey } from './display';
import { KIND_META } from './kinds';
import { Segmented } from './Segmented';
import { WORKBOOK_ROW_NOTE } from './TradeForm';

type SideFilter = 'all' | 'buy' | 'sell';

const SIDE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buys' },
  { value: 'sell', label: 'Sells' },
] as const;

const DESKTOP_ORDER = [
  'date',
  'holding',
  'side',
  'units',
  'price',
  'orderValue',
  'fee',
  'result',
  'flags',
  'source',
  'actions',
] as const;

/** Phone (D31): flags move into the Holding cell; the Flags column is dropped. */
const PHONE_ORDER = [
  'date',
  'holding',
  'side',
  'orderValue',
  'actions',
  'units',
  'price',
  'fee',
  'result',
  'source',
] as const;

/** True when the sell matched no lot for some units (the "Oversold N" badge shows). */
function isOversold(trade: TradeRowDto): boolean {
  return trade.oversoldUnits !== null && Number(trade.oversoldUnits) !== 0;
}

function OversoldBadge({ trade, kind }: { trade: TradeRowDto; kind: InstrumentKind }) {
  if (trade.oversoldUnits === null || !isOversold(trade)) return null;
  return <StatusBadge status="stop" label={`Oversold ${formatUnits(trade.oversoldUnits, kind)}`} />;
}

/**
 * The review flags shown for a row. The live `oversell` flag says what the "Oversold N" badge
 * already says, so it is left out wherever that badge renders (one badge per condition).
 */
function shownFlags(trade: TradeRowDto): TradeRowDto['flags'] {
  return isOversold(trade) ? trade.flags.filter((flag) => flag !== 'oversell') : trade.flags;
}

/** A result figure with its muted word: "+$24.00 unrealised", "−$220.00 realised". */
function ResultAmount({ cents, word }: { cents: number; word: string }): JSX.Element {
  return (
    <span className="jf-app-result-line">
      <MoneyCell cents={cents} />
      <span className="jf-app-result-word">{word}</span>
    </span>
  );
}

function ResultCell({ trade, kind }: { trade: TradeRowDto; kind: InstrumentKind }): JSX.Element {
  if (trade.side === 'buy') {
    if (trade.remainingUnits === null) return <Missing />;
    return (
      <span className="jf-app-result-cell">
        <span>
          {formatUnits(trade.remainingUnits, kind)} of {formatUnits(trade.units, kind)} left
        </span>
        {trade.unrealisedCents !== null ? (
          <ResultAmount cents={trade.unrealisedCents} word="unrealised" />
        ) : null}
      </span>
    );
  }
  return (
    <span className="jf-app-result-cell">
      {trade.realisedCents === null ? (
        <Missing />
      ) : (
        <ResultAmount cents={trade.realisedCents} word="realised" />
      )}
      <OversoldBadge trade={trade} kind={kind} />
    </span>
  );
}

interface ConfirmProps {
  trade: TradeRowDto;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Scrolls a table that scrolls sideways so the cell holding `element` starts just right of the
 * sticky first column (a phone ledger): the browser's own focus scroll would otherwise slide the
 * start of the cell under that column. Nothing moves when the cell is already in full view.
 */
function revealRightOfStickyColumn(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>('.jf-table__scroll');
  const cell = element.closest<HTMLElement>('td');
  if (!scroller || !cell) return;
  const sticky = scroller.querySelector<HTMLElement>('.jf-table__cell--first');
  const left = cell.offsetLeft - (sticky?.offsetWidth ?? 0);
  const inView =
    left >= scroller.scrollLeft &&
    cell.offsetLeft + cell.offsetWidth <= scroller.scrollLeft + scroller.clientWidth;
  if (!inView) scroller.scrollLeft = Math.max(0, left);
}

function DeleteConfirm({ trade, busy, onConfirm, onCancel }: ConfirmProps): JSX.Element {
  const groupRef = useRef<HTMLSpanElement>(null);
  const questionId = useId();
  // Focus starts on Cancel, the safe choice, after the whole confirm is brought into view.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    revealRightOfStickyColumn(group);
    group.querySelector<HTMLElement>('[data-confirm="cancel"]')?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };
  const date = formatDate(trade.tradeDate);
  const label = `${trade.symbol} trade of ${date}`;
  return (
    <span
      ref={groupRef}
      className="jf-app-row-actions jf-app-confirm"
      role="group"
      aria-labelledby={questionId}
      onKeyDown={onKeyDown}
    >
      {/* The question names the trade, so the confirm never shows a bare "Delete?". */}
      <span id={questionId} className="jf-app-confirm__question">
        Delete the {trade.symbol} {sideLabel(trade.side).toLowerCase()} of {date}?
      </span>
      <Button
        variant="danger"
        size="sm"
        onClick={onConfirm}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={`Delete the ${label}`}
      >
        Delete
      </Button>
      <Button
        data-confirm="cancel"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={busy}
        // The accessible name starts with the visible word (WCAG 2.5.3 Label in Name).
        aria-label={`Cancel: keep the ${label}`}
      >
        Cancel
      </Button>
    </span>
  );
}

export interface TradeLedgerProps {
  kind: InstrumentKind;
  trades: readonly TradeRowDto[];
  /**
   * The investment page: the Holding and Side filters and the Holding column. A holding's page
   * passes false (its ledger is that holding's trades only).
   */
  filters?: boolean;
  /** The Trades section heading's id: focus goes there after a delete. */
  headingId: string;
  onEdit: (trade: TradeRowDto) => void;
  /** A trade was deleted (the page announces it). */
  onDeleted: (message: string) => void;
  /** Disables Edit and Delete while a form is open. */
  locked?: boolean;
  /** A holding's page: its symbol names the ledger ("ASX:DEF trades: 3 rows"). */
  symbol?: string;
}

export function TradeLedger({
  kind,
  trades,
  filters = true,
  headingId,
  onEdit,
  onDeleted,
  locked = false,
  symbol,
}: TradeLedgerProps): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const meta = KIND_META[kind];
  const [holdingFilter, setHoldingFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<SideFilter>('all');
  const [confirming, setConfirming] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useDeleteTrade();
  const returnFocusTo = useRef<number | null>(null);

  // A cancelled confirm puts focus back on the row's Delete button.
  useEffect(() => {
    const id = returnFocusTo.current;
    if (confirming !== null || id === null) return;
    returnFocusTo.current = null;
    document
      .querySelector<HTMLElement>(`[data-trade-action="${tradeActionKey('delete', id)}"]`)
      ?.focus();
  }, [confirming]);

  const confirmingTrade = trades.find((t) => t.id === confirming);

  const cancelDelete = (): void => {
    returnFocusTo.current = confirming;
    setConfirming(null);
  };

  const confirmDelete = (trade: TradeRowDto): void => {
    setDeleteError(null);
    remove.mutate(trade.id, {
      onSuccess: () => {
        setConfirming(null);
        onDeleted('Trade deleted');
        const heading = document.getElementById(headingId);
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        }
      },
      onError: (error) => {
        setDeleteError(
          isApiError(error) && error.code === 'IMPORT_IN_PROGRESS'
            ? IMPORT_RUNNING_MESSAGE
            : errorMessage(error),
        );
      },
    });
  };

  const rows = trades.filter(
    (t) =>
      (holdingFilter === 'all' || String(t.instrumentId) === holdingFilter) &&
      (sideFilter === 'all' || t.side === sideFilter),
  );

  const holdingOptions: SelectOption[] = [
    { value: 'all', label: 'All holdings' },
    ...[...new Map(trades.map((t) => [t.instrumentId, t.symbol])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, symbol]) => ({ value: String(id), label: symbol })),
  ];

  const all: Record<string, ColumnTableColumn<TradeRowDto>> = {
    date: {
      id: 'date',
      header: 'Date',
      value: (t) => t.tradeDate,
      cell: (t) => formatDate(t.tradeDate),
      numeric: true,
      minWidth: 104,
    },
    holding: {
      id: 'holding',
      header: 'Holding',
      value: (t) => t.symbol,
      cell: (t) => (
        <HoldingName kind={kind} instrumentId={t.instrumentId} symbol={t.symbol}>
          {phone ? (
            <span className="jf-app-flags">
              <ReviewFlagBadges flags={shownFlags(t)} />
              <OversoldBadge trade={t} kind={kind} />
            </span>
          ) : null}
        </HoldingName>
      ),
      minWidth: phone ? 110 : undefined,
    },
    side: { id: 'side', header: 'Side', value: (t) => sideLabel(t.side) },
    units: {
      id: 'units',
      header: 'Units',
      value: (t) => Number(t.units),
      cell: (t) => formatUnits(t.units, kind),
      numeric: true,
    },
    price: {
      id: 'price',
      header: 'Price',
      value: (t) => Number(t.price),
      cell: (t) => formatHoldingPrice(t.price, kind),
      numeric: true,
    },
    orderValue: {
      id: 'orderValue',
      header: 'Order value',
      value: (t) => t.orderValueCents,
      // Always positive, body text: the side says buy or sell (D33).
      cell: (t) => <MoneyCell cents={t.orderValueCents} loss={false} />,
      numeric: true,
    },
    fee: {
      id: 'fee',
      header: 'Fee',
      value: (t) => t.feeCents,
      cell: (t) =>
        t.fee.kind === 'rate' ? (
          <span className="jf-app-fee-cell">
            <MoneyCell cents={t.feeCents} loss={false} />
            <span className="jf-app-muted">{feeText(t.fee)}</span>
          </span>
        ) : (
          <MoneyCell cents={t.feeCents} loss={false} />
        ),
      numeric: true,
    },
    result: {
      id: 'result',
      header: 'Result',
      value: (t) => t.realisedCents ?? t.unrealisedCents,
      cell: (t) => <ResultCell trade={t} kind={kind} />,
      // Money right-aligned like every other money column (STYLE_GUIDE §5).
      numeric: true,
    },
    flags: {
      id: 'flags',
      header: 'Flags',
      value: (t) => shownFlags(t).join(', ') || null,
      cell: (t) => {
        const flags = shownFlags(t);
        return flags.length ? <ReviewFlagBadges flags={flags} /> : <Missing />;
      },
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (t) => t.origin,
      cell: (t) => <span className="jf-app-muted">{t.origin === 'app' ? 'App' : 'Workbook'}</span>,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (t) => {
        if (confirming === t.id) {
          return (
            <DeleteConfirm
              trade={t}
              busy={remove.isPending}
              onConfirm={() => confirmDelete(t)}
              onCancel={cancelDelete}
            />
          );
        }
        const label = `${t.symbol} trade of ${formatDate(t.tradeDate)}`;
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit ${label}`}
              data-trade-action={tradeActionKey('edit', t.id)}
              onClick={() => onEdit(t)}
              disabled={locked || confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete ${label}`}
              data-trade-action={tradeActionKey('delete', t.id)}
              onClick={() => {
                setDeleteError(null);
                setConfirming(t.id);
              }}
              disabled={locked || confirming !== null}
            >
              Delete
            </Button>
          </span>
        );
      },
    },
  };
  // A holding's own page drops the Holding column (every row is that holding); on a phone its
  // Flags column then stays, since the flags have no Holding cell to sit in.
  const order: readonly string[] = filters
    ? phone
      ? PHONE_ORDER
      : DESKTOP_ORDER
    : phone
      ? [...PHONE_ORDER.filter((id) => id !== 'holding'), 'flags']
      : DESKTOP_ORDER.filter((id) => id !== 'holding');
  const columns = order.flatMap((id) => {
    const column = all[id];
    return column ? [column] : [];
  });

  return (
    <>
      {filters ? (
        <Cluster gap={4} align="end" className="jf-app-filters">
          <div className="jf-app-filters__section">
            <Select
              label="Holding"
              value={holdingFilter}
              onChange={setHoldingFilter}
              options={holdingOptions}
            />
          </div>
          <Segmented<SideFilter>
            label="Side"
            options={SIDE_FILTERS}
            value={sideFilter}
            onChange={setSideFilter}
          />
        </Cluster>
      ) : null}
      {confirmingTrade?.origin === 'import' ? (
        <Callout kind="important" title="Workbook row">
          <p>{WORKBOOK_ROW_NOTE}</p>
        </Callout>
      ) : null}
      {deleteError ? (
        <Callout kind="do-not" title="Not deleted">
          <p>{deleteError}</p>
        </Callout>
      ) : null}
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={columns}
          rows={rows}
          getRowId={(t) => String(t.id)}
          caption={`${filters || symbol === undefined ? meta.title : symbol} trades: ${plural(rows.length, 'row')}`}
          showCaption
          emptyMessage={trades.length === 0 ? 'No trades yet.' : 'No trades match the filters.'}
        />
      </div>
    </>
  );
}
