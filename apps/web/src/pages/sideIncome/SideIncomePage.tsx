// The Side Income page (stage-3.md §6.4, D49, D53, D57): KPI tiles (this FY so far is the teal
// figure), the D49 note, the deposits ledger, the periods (chart and table) and the streams.
import type { SideIncomePageResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  Grid,
  GridItem,
  PageHeader,
  SectionBar,
  StatTile,
  formatDate,
  formatFinancialYear,
  formatMoney,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { ListPlus, Plus } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { useSideIncomePage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadError, Loading } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { actionSelector, useEditor } from '../cashflow/formState';
import { DepositForm } from './DepositForm';
import { DepositsSection } from './DepositsSection';
import { PeriodsSection } from './PeriodsSection';
import { depositActionKey, streamActionKey, type SideIncomeEditor } from './sideIncomeEditor';
import { StreamForm, StreamsSection } from './StreamsSection';

export const LOANS_NOTE =
  "Only interest from loans you've made counts as side income. A principal repayment moves money between your accounts, so it is not income.";

const ADD_DEPOSIT = 'add-deposit';
const ADD_STREAM = 'add-stream';
const DASH = '—';

function money(cents: number | null): string {
  return cents === null ? DASH : formatMoney(cents, { wholeDollars: true });
}

function Tiles({ page }: { page: SideIncomePageResponse }): JSX.Element {
  const { kpis, budget } = page;
  const fy = formatFinancialYear(kpis.financialYear);
  const tiles: {
    key: string;
    label: string;
    value: ReactNode;
    hint: string;
    keyFigure?: boolean;
  }[] = [
    {
      key: 'fy',
      label: 'This FY so far',
      value: money(kpis.fyToDateCents),
      keyFigure: true,
      hint: `${fy} to ${formatDate(page.asOf)}`,
    },
    {
      key: 'avg',
      label: 'Average per period this FY',
      value: money(kpis.avgPerPeriodThisFyCents),
      hint:
        kpis.avgPerPeriodThisFyCents === null
          ? `No recorded months in ${fy} yet`
          : `${plural(kpis.periodsThisFy, 'recorded period')} in ${fy}`,
    },
    {
      key: 'projected',
      label: 'Projected this FY',
      value: money(kpis.projectedYearCents),
      hint: kpis.projectedYearCents === null ? 'Needs a recorded month' : 'The average × 12',
    },
    {
      key: '365',
      label: '365-day average',
      value: money(kpis.avg365Cents),
      hint:
        kpis.avg365Cents === null
          ? 'Needs recorded months'
          : `${plural(kpis.periods365, 'recorded period')} in the last 365 days`,
    },
    {
      key: 'lifetime',
      label: 'Lifetime',
      value: money(kpis.lifetimeCents),
      hint: plural(page.deposits.length, 'deposit'),
    },
    {
      key: 'budget',
      label: 'In the budget',
      value: (
        <Link to="/budget" className="jf-app-tile-link">
          {budget.includeSideIncome
            ? `Included: ${money(budget.avg365Cents)} a month`
            : 'Not included'}
        </Link>
      ),
      hint: budget.includeSideIncome
        ? 'The 365-day average is added to monthly income'
        : 'Turn it on in the Budget settings',
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

export function SideIncomePage(): JSX.Element {
  const query = useSideIncomePage();
  const page = query.data;
  const editor = useEditor<SideIncomeEditor>();
  const open = editor.editor;
  const activeStreams = page?.streams.filter((s) => !s.archived) ?? [];

  const actions = page ? (
    <>
      {activeStreams.length > 0 ? (
        <Button
          variant="primary"
          icon={Plus}
          data-cf-action={ADD_DEPOSIT}
          onClick={() => editor.open({ form: 'deposit', opener: actionSelector(ADD_DEPOSIT) })}
        >
          Add deposit
        </Button>
      ) : null}
      <Button
        variant="secondary"
        icon={ListPlus}
        data-cf-action={ADD_STREAM}
        onClick={() => editor.open({ form: 'stream', opener: actionSelector(ADD_STREAM) })}
      >
        Add stream
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Side Income" subtitle="Cash flow" actions={actions} />
      {query.isPending ? <Loading label="Loading side income…" /> : null}
      {query.isError ? (
        <LoadError
          title="Could not load the side income page"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {page ? (
        <>
          <LiveRegion kind="status" label="Save result">
            {editor.notice ? (
              <Callout kind="note" title="Saved">
                <p>{editor.notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <Tiles page={page} />
          <Callout kind="note" title="Loans you've made">
            <p>{LOANS_NOTE}</p>
          </Callout>
          {open?.form === 'deposit' ? (
            <DepositForm
              key={open.deposit ? `deposit-${open.deposit.id}` : 'new-deposit'}
              streams={page.streams}
              deposit={open.deposit}
              onDone={editor.done}
              onCancel={editor.close}
            />
          ) : null}
          {open?.form === 'stream' ? (
            <StreamForm
              key={open.stream ? `stream-${open.stream.id}` : 'new-stream'}
              stream={open.stream}
              onDone={editor.done}
              onCancel={editor.close}
            />
          ) : null}
          <section className="jf-app-block" aria-labelledby="side-deposits-heading">
            <SectionBar id="side-deposits-heading" title="Deposits" role="primary" />
            {page.streams.length === 0 ? (
              <Callout kind="note" title="No streams">
                <p>Add a stream to start logging deposits.</p>
              </Callout>
            ) : (
              <DepositsSection
                page={page}
                locked={open !== null}
                onEdit={(deposit) =>
                  editor.open({
                    form: 'deposit',
                    deposit,
                    opener: actionSelector(depositActionKey('edit', deposit.id)),
                  })
                }
                onDeleted={editor.announce}
              />
            )}
          </section>
          <section className="jf-app-block" aria-labelledby="side-periods-heading">
            <SectionBar id="side-periods-heading" title="By period" role="supporting" />
            <PeriodsSection page={page} editor={editor} />
          </section>
          <section className="jf-app-block" aria-labelledby="side-streams-heading">
            <SectionBar id="side-streams-heading" title="Streams" role="reference" />
            <StreamsSection
              streams={page.streams}
              locked={open !== null}
              onRename={(stream) =>
                editor.open({
                  form: 'stream',
                  stream,
                  opener: actionSelector(streamActionKey('rename', stream.id)),
                })
              }
              onChanged={editor.announce}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
