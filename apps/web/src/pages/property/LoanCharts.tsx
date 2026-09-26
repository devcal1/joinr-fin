// A loan's charts (stage-4.md §5, §6.5 item 5, UX-3): "Loan balance" (its log points, one line),
// "Repaid so far" (cumulative principal slot 1 and interest and fees slot 2, stacked: parts of the
// repayments) and "Payoff projection" (the schedule's yearly points: "With your offset" slot 1,
// "Without the offset" slot 2; one "Projected balance" line without an offset). Each has its table.
import type { LoanBalanceEntryDto, LoanDto } from '@joinr/schema';
import {
  AreaChart,
  ChartCard,
  ColumnTable,
  Grid,
  GridItem,
  LineChart,
  compactMoneyFormatter,
  formatDate,
  moneyFormatter,
  type Series,
} from '@joinr/ui';
import { useMemo, type JSX } from 'react';
import { BalanceCell, FlowCell } from '../cashflow/cells';
import { payoffMissingText, toDollars } from '../assets/display';
import {
  PAYOFF_SERIES,
  REPAID_SERIES,
  bridgeGaps,
  projectionRows,
  type ProjectionRow,
} from './propertyText';

const dollarFormatter = moneyFormatter();

export function LoanCharts({
  loan,
  log,
}: {
  loan: LoanDto;
  log: readonly LoanBalanceEntryDto[];
}): JSX.Element {
  const hasOffset = loan.scheduleWithoutOffset !== null;
  const projection = useMemo(
    () => projectionRows(loan.schedule, loan.scheduleWithoutOffset),
    [loan.schedule, loan.scheduleWithoutOffset],
  );
  const data = useMemo(() => {
    const dates = projection.map((r) => r.date);
    const bridge = (values: (number | null)[]) => bridgeGaps(dates, values);
    const categories = log.map((e) => formatDate(e.asOf));
    const balance: Series[] = [
      { name: 'Balance', data: log.map((e) => toDollars(e.balanceCents)) },
    ];
    const repaid: Series[] = [
      {
        name: REPAID_SERIES.principal.name,
        data: log.map((e) => toDollars(e.cumulativePrincipalCents)),
        color: REPAID_SERIES.principal.color,
      },
      {
        name: REPAID_SERIES.interest.name,
        data: log.map((e) => toDollars(e.cumulativeInterestFeesCents)),
        color: REPAID_SERIES.interest.color,
      },
    ];
    const payoff: Series[] = hasOffset
      ? [
          {
            name: PAYOFF_SERIES.with.name,
            data: bridge(projection.map((r) => toDollars(r.withCents))),
            color: PAYOFF_SERIES.with.color,
          },
          {
            name: PAYOFF_SERIES.without.name,
            data: bridge(projection.map((r) => toDollars(r.withoutCents))),
            color: PAYOFF_SERIES.without.color,
          },
        ]
      : [
          {
            name: 'Projected balance',
            data: bridge(projection.map((r) => toDollars(r.withCents))),
          },
        ];
    return {
      categories,
      balance,
      repaid,
      payoff,
      payoffCategories: projection.map((r) => formatDate(r.date)),
    };
  }, [log, projection, hasOffset]);

  const noSchedule =
    loan.schedule === null
      ? (payoffMissingText(loan.flags) ?? 'No schedule')
      : (payoffMissingText(loan.schedule.flag ? [loan.schedule.flag] : []) ?? 'No payoff date');

  return (
    <Grid>
      <GridItem span={6}>
        <ChartCard
          title="Loan balance"
          subtitle={loan.name}
          chart={
            <LineChart
              ariaLabel={`Loan balance of ${loan.name}`}
              categories={data.categories}
              series={data.balance}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage="No balances yet"
            />
          }
          table={
            <ColumnTable
              columns={[
                {
                  id: 'asOf',
                  header: 'As of',
                  value: (e: LoanBalanceEntryDto) => e.asOf,
                  cell: (e) => formatDate(e.asOf),
                  minWidth: 104,
                },
                {
                  id: 'balance',
                  header: 'Balance',
                  value: (e) => e.balanceCents,
                  cell: (e) => <BalanceCell cents={e.balanceCents} />,
                  numeric: true,
                },
              ]}
              rows={log}
              getRowId={(e) => `${e.id ?? 'start'}-${e.asOf}`}
              caption={`Loan balance: ${loan.name}`}
            />
          }
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Repaid so far"
          subtitle="Principal and interest and fees, cumulative"
          chart={
            <AreaChart
              ariaLabel={`Repaid so far on ${loan.name}: principal and interest and fees`}
              categories={data.categories}
              series={data.repaid}
              stacked
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage="No repayments yet"
            />
          }
          table={
            <ColumnTable
              columns={[
                {
                  id: 'asOf',
                  header: 'As of',
                  value: (e: LoanBalanceEntryDto) => e.asOf,
                  cell: (e) => formatDate(e.asOf),
                  minWidth: 104,
                },
                {
                  id: 'principal',
                  header: 'Principal',
                  value: (e) => e.cumulativePrincipalCents,
                  cell: (e) => <FlowCell cents={e.cumulativePrincipalCents} />,
                  numeric: true,
                },
                {
                  id: 'interest',
                  header: 'Interest and fees',
                  value: (e) => e.cumulativeInterestFeesCents,
                  cell: (e) => <FlowCell cents={e.cumulativeInterestFeesCents} />,
                  numeric: true,
                },
              ]}
              rows={log}
              getRowId={(e) => `${e.id ?? 'start'}-${e.asOf}`}
              caption={`Repaid so far: ${loan.name}`}
            />
          }
        />
      </GridItem>
      <GridItem span={12}>
        <ChartCard
          title="Payoff projection"
          subtitle={hasOffset ? 'With and without your offset' : 'The balance year by year'}
          chart={
            <LineChart
              ariaLabel={`Payoff projection of ${loan.name}`}
              categories={data.payoffCategories}
              series={data.payoff}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={`No projection: ${noSchedule.toLowerCase()}`}
            />
          }
          table={
            <ColumnTable
              columns={[
                {
                  id: 'date',
                  header: 'Date',
                  value: (r: ProjectionRow) => r.date,
                  cell: (r) => formatDate(r.date),
                  minWidth: 104,
                },
                {
                  id: 'with',
                  header: hasOffset ? PAYOFF_SERIES.with.name : 'Projected balance',
                  value: (r) => r.withCents,
                  cell: (r) => <BalanceCell cents={r.withCents} />,
                  numeric: true,
                },
                ...(hasOffset
                  ? [
                      {
                        id: 'without',
                        header: PAYOFF_SERIES.without.name,
                        value: (r: ProjectionRow) => r.withoutCents,
                        cell: (r: ProjectionRow) => <BalanceCell cents={r.withoutCents} />,
                        numeric: true,
                      },
                    ]
                  : []),
              ]}
              rows={projection}
              getRowId={(r) => r.date}
              caption={`Payoff projection: ${loan.name}`}
              emptyMessage={`No projection: ${noSchedule.toLowerCase()}`}
            />
          }
        />
      </GridItem>
    </Grid>
  );
}
