// One investment page per kind (stage-2.md §6.3–6.8): /stocks, /etfs, /managed-funds, /crypto.
// Header with Add trade / Add holding, price freshness and the price callout, the KPI tiles, the
// holdings table, next buy & allocation, history charts, realised gains by FY and the ledger.
import type { InstrumentKind, TradeRowDto } from '@joinr/schema';
import { Button, Callout, Cluster, Grid, GridItem, PageHeader, Pill, SectionBar } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { ListPlus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useInvestmentPage, useInvestmentTrades } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { AllocationCard } from './AllocationCard';
import {
  firstTradeDates,
  freshnessText,
  loadErrorTitle,
  loadingText,
  priceCalloutText,
  tradeActionKey,
} from './display';
import { HistoryCharts } from './HistoryCharts';
import { HoldingForm } from './HoldingForm';
import { HoldingsTable } from './HoldingsTable';
import { KIND_META } from './kinds';
import { KpiTiles } from './KpiTiles';
import { NextBuyCard } from './NextBuyCard';
import { RealisedFyTable } from './RealisedFyTable';
import { TradeForm } from './TradeForm';
import { TradeLedger } from './TradeLedger';

/** The one inline form that is open, and the button to give focus back to when it closes. */
type Editor =
  { form: 'trade'; trade?: TradeRowDto; opener: string } | { form: 'holding'; opener: string };

const ADD_TRADE = '[data-page-action="add-trade"]';
const ADD_HOLDING = '[data-page-action="add-holding"]';

export function InvestmentPage({ kind }: { kind: InstrumentKind }): JSX.Element {
  const meta = KIND_META[kind];
  const query = useInvestmentPage(kind);
  const tradesQuery = useInvestmentTrades(kind);
  const page = query.data;
  const trades = tradesQuery.data?.trades;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);
  const firstTrades = useMemo(() => (trades ? firstTradeDates(trades) : null), [trades]);
  const tradesHeadingId = `${kind}-trades-heading`;

  // When a form closes, focus goes back to the button that opened it (the PricesPage pattern).
  useEffect(() => {
    const selector = returnFocus.current;
    if (editor || !selector) return;
    returnFocus.current = null;
    document.querySelector<HTMLElement>(selector)?.focus();
  }, [editor]);

  const open = (next: Editor): void => {
    setNotice(null);
    setEditor(next);
  };
  const close = (): void => {
    returnFocus.current = editor?.opener ?? null;
    setEditor(null);
  };
  const done = (message: string): void => {
    close();
    setNotice(message);
  };

  const hasHoldings = (page?.holdings.length ?? 0) > 0;
  const actions = page ? (
    <>
      {hasHoldings ? (
        <Button
          variant="primary"
          icon={Plus}
          data-page-action="add-trade"
          onClick={() => open({ form: 'trade', opener: ADD_TRADE })}
        >
          Add trade
        </Button>
      ) : null}
      <Button
        variant="secondary"
        icon={ListPlus}
        data-page-action="add-holding"
        onClick={() => open({ form: 'holding', opener: ADD_HOLDING })}
      >
        Add holding
      </Button>
    </>
  ) : undefined;

  const priceNote = page ? priceCalloutText(page.holdings, page.summary) : null;

  return (
    <>
      <PageHeader title={meta.title} subtitle="Investments" actions={actions} />
      <QueryStates
        query={query}
        loading={loadingText(kind)}
        layout="dashboard"
        errorTitle={loadErrorTitle(kind)}
      />
      {page ? (
        <>
          <Cluster gap={3} className="jf-app-freshness">
            <span className="jf-app-meta">{freshnessText(page.prices, new Date())}</span>
            {page.prices.mode === 'fake' ? <Pill>Test prices</Pill> : null}
          </Cluster>
          <LiveRegion kind="status" label="Save result">
            {notice ? (
              <Callout kind="note" title="Saved">
                <p>{notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          {editor?.form === 'trade' ? (
            <TradeForm
              key={editor.trade ? `edit-${editor.trade.id}` : 'new'}
              kind={kind}
              holdings={page.holdings}
              trade={editor.trade}
              onDone={done}
              onCancel={close}
            />
          ) : null}
          {editor?.form === 'holding' ? (
            <HoldingForm kind={kind} autoFocus onDone={done} onCancel={close} />
          ) : null}
          {priceNote ? (
            <Callout kind="important" title="Prices">
              <p>
                {priceNote} <Link to="/prices">Check the prices</Link>.
              </p>
            </Callout>
          ) : null}
          {hasHoldings ? (
            <>
              <KpiTiles page={page} firstTrades={firstTrades} />
              <section className="jf-app-block" aria-labelledby={`${kind}-holdings-heading`}>
                <SectionBar id={`${kind}-holdings-heading`} title="Holdings" role="primary" />
                <HoldingsTable page={page} firstTrades={firstTrades} />
              </section>
              <section className="jf-app-block" aria-labelledby={`${kind}-next-heading`}>
                <SectionBar
                  id={`${kind}-next-heading`}
                  title="Next buy & allocation"
                  role="supporting"
                />
                <Grid>
                  <GridItem span={6}>
                    <NextBuyCard page={page} />
                  </GridItem>
                  <GridItem span={6}>
                    <AllocationCard page={page} />
                  </GridItem>
                </Grid>
              </section>
              <section className="jf-app-block" aria-labelledby={`${kind}-history-heading`}>
                <SectionBar id={`${kind}-history-heading`} title="History" role="supporting" />
                <HistoryCharts page={page} />
              </section>
              <section className="jf-app-block" aria-labelledby={`${kind}-realised-heading`}>
                <SectionBar
                  id={`${kind}-realised-heading`}
                  title="Realised gains by financial year"
                  role="supporting"
                />
                <RealisedFyTable rows={page.realisedByFy} />
              </section>
              <section className="jf-app-block" aria-labelledby={tradesHeadingId}>
                <SectionBar id={tradesHeadingId} title="Trades" role="reference" />
                <QueryStates
                  query={tradesQuery}
                  loading="Loading trades…"
                  layout="table"
                  errorTitle="Could not load the trades"
                />
                {trades ? (
                  <TradeLedger
                    kind={kind}
                    trades={trades}
                    headingId={tradesHeadingId}
                    onEdit={(trade) =>
                      open({
                        form: 'trade',
                        trade,
                        opener: `[data-trade-action="${tradeActionKey('edit', trade.id)}"]`,
                      })
                    }
                    onDeleted={(message) => {
                      setEditor(null);
                      setNotice(message);
                    }}
                  />
                ) : null}
              </section>
            </>
          ) : (
            <Callout kind="note">
              <p>
                No {meta.plural} yet. Add a holding, or import the workbook on the{' '}
                <Link to="/import">Import page</Link>.
              </p>
              <p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ListPlus}
                  onClick={() => open({ form: 'holding', opener: ADD_HOLDING })}
                >
                  Add holding
                </Button>
              </p>
            </Callout>
          )}
        </>
      ) : null}
    </>
  );
}
