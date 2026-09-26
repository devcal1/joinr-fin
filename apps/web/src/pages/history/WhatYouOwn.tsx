// "What you own over time" (stage-5.md §5, §6.4 item 6): the stacked area in the same stack order,
// colours and Cash definition as the Net Worth charts ("Other debts" grey below zero), with the
// view switch. The page's own groups show by default; a view change reads the aggregation API
// (`/api/history/series`), keeping the previous groups on screen while it loads.
import type { ChartDateUnit, HistoryPageResponse, SnapshotGroupDto } from '@joinr/schema';
import {
  AreaChart,
  ChartCard,
  ColumnTable,
  SectionBar,
  compactMoneyFormatter,
  moneyFormatter,
  type ColumnTableColumn,
} from '@joinr/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useHistorySeries, type ChartView } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { MoneyCell } from '../investments/cells';
import { groupCategories, stackColumns, stackSeries } from './charts';
import {
  LIVE_AREA_NOTE,
  LIVE_TABLE_NOTE,
  NET_WORTH_TOTAL,
  groupCategory,
  unitTitle,
  viewAnnouncement,
} from './display';
import { ViewSwitch } from './ViewSwitch';

const dollars = moneyFormatter();
const NO_GROUPS = 'No recorded months yet.';

export function WhatYouOwn({ page }: { page: HistoryPageResponse }): JSX.Element {
  const [view, setView] = useState<ChartView | null>(null);
  const series = useHistorySeries(view ?? {}, { enabled: view !== null });
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const fromSeries = view !== null && series.data !== undefined;
  const seriesGroups = series.data?.groups;
  const groups: readonly SnapshotGroupDto[] = useMemo(
    () => (fromSeries ? (seriesGroups ?? []) : page.charts.groups),
    [fromSeries, seriesGroups, page.charts.groups],
  );
  const unit: ChartDateUnit = fromSeries ? (series.data?.unit ?? 'monthly') : page.charts.unit;
  const count = fromSeries ? (series.data?.count ?? null) : page.charts.count;
  const loading = view !== null && (series.isPlaceholderData || series.isFetching);
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current && fromSeries && !series.isPlaceholderData) {
      setAnnouncement(viewAnnouncement(unit, count));
    }
  }, [fromSeries, series.isPlaceholderData, unit, count]);

  const data = useMemo(() => {
    const columns = stackColumns(groups);
    return { columns, series: stackSeries(columns), categories: groupCategories(groups) };
  }, [groups]);
  const live = groups.some((g) => g.live);
  const title = unitTitle('What you own', unit);

  const index = new Map(groups.map((g, i) => [g.period, i]));
  const tableColumns: ColumnTableColumn<SnapshotGroupDto>[] = [
    {
      id: 'period',
      header: 'Period',
      value: (g) => g.period,
      cell: (g) => groupCategory(g),
      minWidth: 120,
    },
    ...data.columns.map((column) => ({
      id: column.key,
      header: column.label,
      value: (g: SnapshotGroupDto) => column.cents[index.get(g.period) ?? -1] ?? null,
      cell: (g: SnapshotGroupDto) => (
        <MoneyCell cents={column.cents[index.get(g.period) ?? -1] ?? null} />
      ),
      numeric: true,
    })),
    {
      id: 'netWorth',
      header: NET_WORTH_TOTAL,
      value: (g) => g.netWorth.netWorthCents,
      cell: (g) => <MoneyCell cents={g.netWorth.netWorthCents} />,
      numeric: true,
    },
  ];

  return (
    <section className="jf-app-block" aria-labelledby="history-own-heading">
      <SectionBar
        id="history-own-heading"
        title="What you own over time"
        role="supporting"
        actions={
          <ViewSwitch
            unit={unit}
            count={count}
            onChange={(next) => {
              announced.current = true;
              setView(next);
            }}
          />
        }
      />
      <LiveRegion kind="status" label="Chart view" className="jf-visually-hidden">
        {announcement}
      </LiveRegion>
      <ChartCard
        title={title}
        subtitle="Each class at the end of the period; other debts below zero"
        chart={
          <div className="jf-app-block jf-app-block--tight">
            <AreaChart
              ariaLabel={title}
              categories={data.categories}
              series={data.series}
              stacked
              valueFormatter={dollars}
              axisFormatter={compactMoneyFormatter}
              loading={loading}
              emptyMessage={NO_GROUPS}
              height={320}
            />
            {live ? <p className="jf-app-meta">{LIVE_AREA_NOTE}</p> : null}
          </div>
        }
        table={
          <div className="jf-app-block jf-app-block--tight">
            <ColumnTable
              columns={tableColumns}
              rows={groups}
              getRowId={(g) => g.period}
              caption={title}
              emptyMessage={NO_GROUPS}
            />
            {live ? <p className="jf-app-meta">{LIVE_TABLE_NOTE}</p> : null}
          </div>
        }
      />
    </section>
  );
}
