// A holding's detail page, `/<kind path>/$instrumentId` (stage-2.md §6.5): tiles, the "More
// columns" facts, parcels, disposals, the holding's trades, its dividends (read-only in Stage 2)
// and the holding settings form with Delete holding.
import {
  instrumentEditableFromDto,
  type HoldingDetailResponse,
  type InstrumentDto,
  type InstrumentKind,
  type TradeRowDto,
} from '@joinr/schema';
import {
  Amount,
  Button,
  Callout,
  Cluster,
  Grid,
  GridItem,
  Icon,
  KeyValueTable,
  PageHeader,
  SectionBar,
  StatTile,
  formatMoney,
  type KeyValueItem,
  type StatDelta,
} from '@joinr/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { errorMessage, isApiError } from '../../api/client';
import { useDeleteInstrument, useHoldingDetail, useInvestmentPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { Missing, QueryStates } from '../../components/QueryStates';
import { NotFoundPage } from '../NotFoundPage';
import { IMPORT_RUNNING_MESSAGE } from './apiErrors';
import { HoldingFlagBadges, MoneyCell, PriceCell, RatioCell } from './cells';
import { DisposalsTable, DividendsTable, LotsTable } from './DetailTables';
import {
  HELD_UNDER_90_DAYS,
  feeText,
  firstTradeDates,
  formatHoldingPrice,
  formatRatio,
  formatUnits,
  returnDelta,
  tradeActionKey,
  xirrHiddenForHolding,
} from './display';
import { HoldingForm } from './HoldingForm';
import { KIND_META } from './kinds';
import { TradeForm } from './TradeForm';
import { TradeLedger } from './TradeLedger';

type Editor = { trade?: TradeRowDto; opener: string };

const ADD_TRADE = '[data-page-action="add-trade"]';
const SETTINGS_ID = 'holding-settings';

function DetailTiles({ detail }: { detail: HoldingDetailResponse }): JSX.Element {
  const { holding, instrument } = detail;
  const kind = instrument.kind;
  const held = holding.status === 'held';
  const firstTrades = useMemo(() => firstTradeDates(detail.trades), [detail.trades]);
  const xirrHidden = xirrHiddenForHolding(holding, firstTrades, detail.asOf);
  const notHeld = held ? undefined : holding.status === 'watching' ? 'Watching' : 'Sold';

  let xirr: ReactNode = '—';
  let xirrHint = 'XIRR: trades, dividends and today’s value';
  if (xirrHidden) xirrHint = HELD_UNDER_90_DAYS;
  else if (holding.xirr === null) xirrHint = 'Needs a price and two dates';
  else {
    xirr = (
      <span className={Number(holding.xirr) < 0 ? 'jf-app-negative' : undefined}>
        {formatRatio(holding.xirr)}
      </span>
    );
  }

  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint?: string;
    keyFigure?: boolean;
    delta?: StatDelta;
  }[] = [
    {
      key: 'value',
      label: 'Value',
      value:
        held && holding.valueCents !== null
          ? formatMoney(holding.valueCents, { wholeDollars: true })
          : '—',
      hint: notHeld ?? (holding.valueCents === null ? 'No price' : undefined),
      keyFigure: true,
    },
    {
      key: 'units',
      label: 'Units',
      value: formatUnits(holding.units, kind),
      hint: holding.lastBuyDate ? undefined : 'No buys yet',
    },
    {
      key: 'totalReturn',
      label: 'Total return',
      value: holding.totalReturnCents === null ? '—' : <Amount cents={holding.totalReturnCents} />,
      delta: returnDelta(holding.totalReturnRatio),
      hint:
        holding.totalReturnCents === null ? 'Held, priced holdings only' : 'Unrealised + dividends',
    },
    {
      key: 'realised',
      label: 'Realised',
      value: <Amount cents={holding.realisedCents} />,
      hint: 'All time',
    },
    { key: 'xirr', label: 'Est. return / yr', value: xirr, hint: xirrHint },
    {
      key: 'averagePrice',
      label: 'Average price',
      value: holding.averagePrice === null ? '—' : formatHoldingPrice(holding.averagePrice, kind),
      hint: 'Open parcels, fees excluded',
    },
  ];
  return (
    <Grid className="jf-app-kpis">
      {tiles.map((tile) => (
        <GridItem key={tile.key} span={4}>
          <StatTile
            label={tile.label}
            value={tile.value}
            keyFigure={tile.keyFigure}
            delta={tile.delta}
            hint={tile.hint}
          />
        </GridItem>
      ))}
    </Grid>
  );
}

function detailFacts(detail: HoldingDetailResponse): KeyValueItem[] {
  const { holding, instrument } = detail;
  const kind = instrument.kind;
  const meta = KIND_META[kind];
  const items: KeyValueItem[] = [
    {
      label: 'Status',
      value: (
        <span className="jf-app-series">
          <span>
            {holding.status === 'held'
              ? 'Held'
              : holding.status === 'watching'
                ? 'Watching'
                : 'Exited'}
          </span>
          <HoldingFlagBadges flags={holding.flags} />
        </span>
      ),
    },
    { label: 'Price', value: <PriceCell price={holding.price} kind={kind} />, numeric: true },
    { label: 'Current', value: <RatioCell ratio={holding.currentRatio} />, numeric: true },
    { label: 'Target', value: <RatioCell ratio={holding.targetRatio} />, numeric: true },
    {
      label: 'Difference',
      value: <RatioCell ratio={holding.differenceRatio} signed />,
      numeric: true,
    },
    {
      label: meta.dividendsLabel,
      value: <MoneyCell cents={holding.dividendsCents} />,
      numeric: true,
    },
    {
      label: meta.yieldLabel,
      value: <RatioCell ratio={holding.dividendYieldRatio} />,
      numeric: true,
    },
  ];
  if (meta.hasRegions) {
    items.push(
      {
        label: 'Mgmt fee',
        value: <RatioCell ratio={holding.mgmtFeeRatio} dp={2} />,
        numeric: true,
      },
      {
        label: 'Est. fee / yr',
        value: <MoneyCell cents={holding.estMgmtFeeCents} />,
        numeric: true,
      },
    );
  }
  if (meta.hasSector) items.push({ label: 'Sector', value: holding.sector ?? <Missing /> });
  items.push({
    label: 'Default fee',
    value: `${feeText(instrument.effectiveDefaultFee)} ${
      instrument.defaultFee === null ? '(the global default)' : '(this holding’s own)'
    }`,
  });
  return items;
}

function DeleteHolding({
  instrument,
  onDeleted,
}: {
  instrument: InstrumentDto;
  onDeleted: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteInstrument();
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirming) {
      areaRef.current?.querySelector<HTMLElement>('[data-confirm="cancel"]')?.focus();
    }
  }, [confirming]);

  if (instrument.tradeCount > 0 || instrument.dividendCount > 0) {
    return (
      <p className="jf-app-meta">
        A holding with trades or dividends cannot be deleted. Stop watching it instead.
      </p>
    );
  }
  if (!confirming) {
    return (
      <Cluster gap={3}>
        <Button variant="danger" icon={Trash2} onClick={() => setConfirming(true)}>
          Delete holding
        </Button>
      </Cluster>
    );
  }
  const onDelete = (): void => {
    setError(null);
    remove.mutate(instrument.id, {
      onSuccess: onDeleted,
      onError: (e) =>
        setError(
          isApiError(e) && e.code === 'IMPORT_IN_PROGRESS'
            ? IMPORT_RUNNING_MESSAGE
            : errorMessage(e),
        ),
    });
  };
  return (
    <div
      ref={areaRef}
      className="jf-app-block"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setConfirming(false);
      }}
    >
      <Callout kind="do-not" title="Delete holding">
        <p>Delete {instrument.symbol}? This cannot be undone.</p>
        {instrument.sheetRef !== null ? (
          <p>
            This holding came from the workbook. Deleting it counts as an app edit: re-importing the
            workbook will then be blocked.
          </p>
        ) : null}
        <Cluster gap={3}>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={onDelete}
            disabled={remove.isPending}
            aria-busy={remove.isPending || undefined}
          >
            Delete holding
          </Button>
          <Button
            variant="ghost"
            data-confirm="cancel"
            onClick={() => setConfirming(false)}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
        </Cluster>
      </Callout>
      {error ? (
        <Callout kind="do-not" title="Not deleted">
          <p>{error}</p>
        </Callout>
      ) : null}
    </div>
  );
}

export function HoldingDetailPage({
  kind,
  instrumentId,
}: {
  kind: InstrumentKind;
  instrumentId: number;
}): JSX.Element {
  const meta = KIND_META[kind];
  const navigate = useNavigate();
  const query = useHoldingDetail(instrumentId);
  const detail = query.data;
  const [editor, setEditor] = useState<Editor | null>(null);
  // The trade form's Holding list: every instrument of the kind (the page is cached when the owner
  // came from it); until it loads, this holding alone.
  const pageQuery = useInvestmentPage(kind, { enabled: editor !== null });
  const [notice, setNotice] = useState<string | null>(null);
  // "Holding saved" shows beside the holding form, not at the top of the page, far from Save.
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);
  const tradesHeadingId = `holding-${instrumentId}-trades-heading`;

  useEffect(() => {
    const selector = returnFocus.current;
    if (editor || !selector) return;
    returnFocus.current = null;
    document.querySelector<HTMLElement>(selector)?.focus();
  }, [editor]);

  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return <NotFoundPage />;
  }
  if (detail && detail.instrument.kind !== kind) return <NotFoundPage />;

  const open = (next: Editor): void => {
    setNotice(null);
    setSettingsNotice(null);
    setEditor(next);
  };
  const close = (): void => {
    returnFocus.current = editor?.opener ?? null;
    setEditor(null);
  };
  const done = (message: string): void => {
    close();
    setSettingsNotice(null);
    setNotice(message);
  };
  const editHolding = (): void => {
    const settings = document.getElementById(SETTINGS_ID);
    settings?.scrollIntoView?.({ block: 'start' });
    settings?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"])')?.focus();
  };

  const pageHoldings = pageQuery.data?.holdings;
  const tradeHoldings =
    pageHoldings?.some((h) => h.instrumentId === instrumentId) === true
      ? pageHoldings
      : detail
        ? [detail.holding]
        : [];

  const actions = (
    <>
      <Link to={meta.path} className="jf-app-back-link">
        <Icon icon={ArrowLeft} />
        All {meta.title}
      </Link>
      {detail ? (
        <>
          <Button
            variant="primary"
            icon={Plus}
            data-page-action="add-trade"
            onClick={() => open({ opener: ADD_TRADE })}
          >
            Add trade
          </Button>
          <Button
            variant="secondary"
            icon={Pencil}
            data-page-action="edit-holding"
            onClick={editHolding}
          >
            Edit holding
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title={detail?.instrument.symbol ?? 'Holding'}
        subtitle={detail?.instrument.name ?? meta.title}
        actions={actions}
      />
      <QueryStates
        query={query}
        loading="Loading the holding…"
        layout="dashboard"
        errorTitle="Could not load the holding"
      />
      {detail ? (
        <>
          <LiveRegion kind="status" label="Save result">
            {notice ? (
              <Callout kind="note" title="Saved">
                <p>{notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          {editor ? (
            <TradeForm
              key={editor.trade ? `edit-${editor.trade.id}` : 'new'}
              kind={kind}
              holdings={tradeHoldings}
              trade={editor.trade}
              preselectedId={instrumentId}
              onDone={done}
              onCancel={close}
            />
          ) : null}
          <DetailTiles detail={detail} />
          <KeyValueTable
            caption={`${detail.instrument.symbol} details`}
            items={detailFacts(detail)}
          />
          <section className="jf-app-block" aria-labelledby="holding-parcels-heading">
            <SectionBar id="holding-parcels-heading" title="Parcels" role="primary" />
            <LotsTable kind={kind} lots={detail.lots} />
          </section>
          <section className="jf-app-block" aria-labelledby="holding-disposals-heading">
            <SectionBar id="holding-disposals-heading" title="Disposals" role="supporting" />
            <DisposalsTable kind={kind} disposals={detail.disposals} />
          </section>
          <section className="jf-app-block" aria-labelledby={tradesHeadingId}>
            <SectionBar id={tradesHeadingId} title="Trades" role="reference" />
            <TradeLedger
              kind={kind}
              trades={detail.trades}
              filters={false}
              symbol={detail.instrument.symbol}
              headingId={tradesHeadingId}
              onEdit={(trade) =>
                open({
                  trade,
                  opener: `[data-trade-action="${tradeActionKey('edit', trade.id)}"]`,
                })
              }
              onDeleted={(message) => {
                setEditor(null);
                setSettingsNotice(null);
                setNotice(message);
              }}
            />
          </section>
          <section className="jf-app-block" aria-labelledby="holding-dividends-heading">
            <SectionBar
              id="holding-dividends-heading"
              title={meta.dividendsLabel}
              role="supporting"
            />
            <DividendsTable kind={kind} dividends={detail.dividends} />
            <p className="jf-app-meta">
              <Link to="/dividends" search={{ holding: detail.instrument.id }}>
                Edit on the Dividends page
              </Link>
            </p>
          </section>
          <section className="jf-app-block" id={SETTINGS_ID} aria-label="Holding settings">
            <HoldingForm
              // Remount (fresh starting values) only when the saved editable fields change, not
              // when a background refetch brings a new price.
              key={`${detail.instrument.id}:${JSON.stringify(instrumentEditableFromDto(detail.instrument))}`}
              kind={kind}
              instrument={detail.instrument}
              onDone={(message) => {
                setNotice(null);
                setSettingsNotice(message);
              }}
            />
            <LiveRegion kind="status" label="Holding save result">
              {settingsNotice ? (
                <Callout kind="note" title="Saved">
                  <p>{settingsNotice}.</p>
                </Callout>
              ) : null}
            </LiveRegion>
            <DeleteHolding
              instrument={detail.instrument}
              onDeleted={() => void navigate({ to: meta.path })}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
