// The Dividends page (stage-3.md §6.6, §6.10, D50, D62): Add dividend and Check Yahoo (the Prices
// page pattern: hidden when market data is off, "Test data" in fake mode, "Checking…" while it
// runs), the check result, KPI tiles (this FY is the teal figure), the Yahoo suggestions, the
// ledger, the FY and 12-month summaries and this FY by holding.
import type { DividendsPageResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  Cluster,
  Grid,
  GridItem,
  PageHeader,
  Pill,
  SectionBar,
  StatTile,
  formatMoney,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { errorMessage } from '../../api/client';
import { useDividendsPage, useRefreshDividendEvents } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { checkProblemText, checkSummaryText, eventsFreshnessText } from '../cashflow/display';
import { actionSelector, useEditor } from '../cashflow/formState';
import { FinancialYearChart, RollingChart } from './DividendCharts';
import { DividendForm } from './DividendForm';
import { MARKET_OFF_NOTE, dividendActionKey, type DividendsEditor } from './dividendsModel';
import { HoldingsFyTable } from './HoldingsFyTable';
import { LedgerSection } from './LedgerSection';
import { SuggestionsSection } from './SuggestionsSection';

export interface DividendsPageProps {
  /** `?holding=<instrumentId>`: preselects the ledger's holding filter. */
  holding?: number;
}

const ADD_DIVIDEND = 'add-dividend';
const LEDGER_HEADING = 'dividends-ledger-heading';

/** The symbol of `?holding=<id>` when the ledger accepts it as a filter (LedgerSection's rule). */
function filteredSymbol(page: DividendsPageResponse, holding: number | undefined): string | null {
  if (holding === undefined) return null;
  const listed = page.holdings.find((h) => h.instrumentId === holding);
  if (listed) return listed.symbol;
  const paid = page.dividends.find((d) => d.instrumentId === holding);
  return paid ? (paid.symbol ?? paid.ticker) : null;
}

/**
 * `?holding=` (the holding page's "Edit on the Dividends page" link): once, when the page first
 * loads, scroll the ledger into view and focus its Holding filter (or the ledger heading when there
 * is no filter), so the filtered rows are not screens below the tiles and suggestions.
 */
function useLedgerFocus(holding: number | undefined, loaded: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (holding === undefined || !loaded || done.current) return;
    done.current = true;
    const heading = document.getElementById(LEDGER_HEADING);
    const section = heading?.closest('section');
    // No smooth scrolling; jsdom has no scrollIntoView.
    section?.scrollIntoView?.({ block: 'start' });
    const filter = section?.querySelector<HTMLSelectElement>('select');
    if (filter) {
      filter.focus({ preventScroll: true });
    } else if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [holding, loaded]);
}

function Tiles({ page }: { page: DividendsPageResponse }): JSX.Element {
  const { kpis } = page;
  const money = (cents: number | null): string =>
    cents === null ? '—' : formatMoney(cents, { wholeDollars: true });
  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint: string;
    keyFigure?: boolean;
  }[] = [
    {
      key: 'fy',
      label: 'This FY',
      value: money(kpis.thisFyCents),
      keyFigure: true,
      hint: 'By payment date, every kind',
    },
    {
      key: 'projected',
      label: 'Projected this FY',
      value: money(kpis.projectedFyCents),
      hint: `From ${plural(kpis.daysIntoFy, 'day')} of the FY`,
    },
    {
      key: '12m',
      label: 'Last 12 months',
      value: money(kpis.rolling12Cents),
      hint: 'The 12 calendar months to this one',
    },
    { key: 'lastFy', label: 'Last FY', value: money(kpis.lastFyCents), hint: 'The previous FY' },
    { key: 'all', label: 'All time', value: money(kpis.allTimeCents), hint: 'Every dividend' },
    {
      key: 'reinvested',
      label: 'Reinvested this FY',
      value: money(kpis.reinvestedThisFyCents),
      hint: 'Paid as units through a DRP',
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
            hint={tile.hint}
          />
        </GridItem>
      ))}
    </Grid>
  );
}

/** The disabled Add dividend button's reason (no holdings yet). */
const NO_HOLDINGS_REASON_ID = 'dividends-no-holdings-reason';

export function DividendsPage({ holding }: DividendsPageProps): JSX.Element {
  const query = useDividendsPage();
  const refresh = useRefreshDividendEvents();
  const page = query.data;
  const editor = useEditor<DividendsEditor>();
  const open = editor.editor;
  const off = page?.events.mode === 'off';
  const running = refresh.isPending || page?.events.running === true;
  useLedgerFocus(holding, page !== undefined);

  const actions = page ? (
    <>
      {page.holdings.length > 0 ? (
        <Button
          variant="primary"
          icon={Plus}
          data-cf-action={ADD_DIVIDEND}
          onClick={() => editor.open({ form: 'dividend', opener: actionSelector(ADD_DIVIDEND) })}
        >
          Add dividend
        </Button>
      ) : (
        // STYLE-13 (stage-6.md §6.9 C): the action stays visible, disabled, with its reason.
        <>
          <Button variant="primary" icon={Plus} disabled aria-describedby={NO_HOLDINGS_REASON_ID}>
            Add dividend
          </Button>
          <span className="jf-app-meta jf-app-action-reason" id={NO_HOLDINGS_REASON_ID}>
            Add a holding on the <Link to="/etfs">ETFs</Link>, <Link to="/stocks">Stocks</Link> or{' '}
            <Link to="/managed-funds">Managed Funds</Link> page first; each dividend belongs to a
            holding.
          </span>
        </>
      )}
      {off ? null : (
        <>
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => refresh.mutate()}
            disabled={running}
            aria-busy={running || undefined}
          >
            {running ? 'Checking…' : 'Check Yahoo'}
          </Button>
          {page.events.mode === 'fake' ? <Pill>Test data</Pill> : null}
        </>
      )}
    </>
  ) : undefined;

  const summary = refresh.data?.summary;
  const problem = summary ? checkProblemText(summary) : null;
  const partial = summary !== undefined && problem !== null;
  const activeSuggestions = page?.suggestions.filter((s) => s.status !== 'dismissed').length ?? 0;
  const showSuggestions = page !== undefined && !off && page.events.lastRefreshAt !== null;
  // The check failed or stopped early: "no missing dividends found" would overstate it.
  const checkIncomplete =
    refresh.isError || partial || (!summary && Boolean(page?.events.lastError));
  const ledgerSymbol = page ? filteredSymbol(page, holding) : null;

  return (
    <>
      <PageHeader title="Dividends" subtitle="Cash flow" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading dividends…"
        layout="dashboard"
        errorTitle="Could not load the dividends"
      />
      {page ? (
        <>
          <Cluster gap={3} className="jf-app-freshness">
            <span className="jf-app-meta" data-testid="events-freshness">
              {off ? 'Yahoo checks are off' : eventsFreshnessText(page.events, new Date())}
            </span>
            {ledgerSymbol ? (
              <span className="jf-app-meta" data-testid="ledger-filter-line">
                Showing {ledgerSymbol} in the <a href={`#${LEDGER_HEADING}`}>ledger below</a>
              </span>
            ) : null}
          </Cluster>
          {off ? (
            <Callout kind="note" title="Suggestions off">
              <p>{MARKET_OFF_NOTE}</p>
            </Callout>
          ) : null}
          <LiveRegion kind="status" label="Save result">
            {editor.notice ? (
              <Callout kind="note" title="Saved">
                <p>{editor.notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <LiveRegion kind="status" label="Check result">
            {summary && !partial ? (
              <Callout kind="note" title="Yahoo checked">
                <p>{checkSummaryText(summary, activeSuggestions)}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <LiveRegion kind="alert" label="Check problem">
            {refresh.isError ? (
              <Callout kind="do-not" title="Check failed">
                <p>{errorMessage(refresh.error)}</p>
              </Callout>
            ) : partial ? (
              <Callout kind="do-not" title="Check incomplete">
                <p>{refresh.data?.events.lastError ?? problem}</p>
              </Callout>
            ) : !summary && !off && page.events.lastError ? (
              <Callout kind="do-not" title="Last check had a problem">
                <p>{page.events.lastError}</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <Tiles page={page} />
          {showSuggestions ? (
            <section className="jf-app-block" aria-labelledby="dividends-suggestions-heading">
              <SectionBar
                id="dividends-suggestions-heading"
                title="Suggestions from Yahoo"
                role="primary"
              />
              <SuggestionsSection page={page} editor={editor} checkIncomplete={checkIncomplete} />
            </section>
          ) : null}
          <section className="jf-app-block" aria-labelledby={LEDGER_HEADING}>
            <SectionBar id={LEDGER_HEADING} title="Ledger" role="reference" />
            {open?.form === 'dividend' ? (
              <DividendForm
                key={open.dividend ? `dividend-${open.dividend.id}` : 'new-dividend'}
                page={page}
                dividend={open.dividend}
                preselectedId={holding}
                onDone={editor.done}
                onCancel={editor.close}
              />
            ) : null}
            <LedgerSection
              page={page}
              holding={holding}
              locked={open !== null}
              onEdit={(dividend) =>
                editor.open({
                  form: 'dividend',
                  dividend,
                  opener: actionSelector(dividendActionKey('edit', dividend.id)),
                })
              }
              onDeleted={editor.announce}
            />
          </section>
          <section className="jf-app-block" aria-labelledby="dividends-fy-heading">
            <SectionBar id="dividends-fy-heading" title="By financial year" role="supporting" />
            <FinancialYearChart rows={page.byFinancialYear} />
          </section>
          <section className="jf-app-block" aria-labelledby="dividends-12m-heading">
            <SectionBar id="dividends-12m-heading" title="Last 12 months" role="supporting" />
            <RollingChart rows={page.rolling12} />
          </section>
          <section className="jf-app-block" aria-labelledby="dividends-holdings-heading">
            <SectionBar
              id="dividends-holdings-heading"
              title="This FY by holding"
              role="supporting"
            />
            <HoldingsFyTable page={page} />
          </section>
        </>
      ) : null}
    </>
  );
}
