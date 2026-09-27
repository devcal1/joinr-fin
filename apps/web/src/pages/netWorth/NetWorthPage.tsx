// The Net Worth dashboard (stage-5.md §5, §6.3, D83, D84, D93, D94): the brand hero with four KPI
// tiles, the callouts, "Where it stands" (assets and liabilities, the distribution donut, the
// savings-rate gauge, the liquid allocation), "Over time" (four charts under one view switch) and
// the rolling net worth. The view switch is a view-only query override: the previous response
// stays on screen while the new view loads, so the page never unmounts (§6.2).
import type { NetWorthPageResponse } from '@joinr/schema';
import { BrandScreen, Grid, GridItem, PageHeader, SectionBar, Stack } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { CalendarPlus, History } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useNetWorthPage, type ChartView } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { LinkButton } from '../history/LinkButton';
import { ViewSwitch } from '../history/ViewSwitch';
import { viewAnnouncement } from '../history/display';
import { AllocationTable } from './AllocationTable';
import { AssetsCard } from './AssetsCard';
import { DistributionCard } from './DistributionCard';
import { NetWorthCallouts } from './NetWorthCallouts';
import { NetWorthTiles } from './NetWorthTiles';
import { OverTimeCharts } from './OverTimeCharts';
import { RollingSection } from './RollingSection';
import { SavingsRateCard } from './SavingsRateCard';
import { EMPTY_DASHBOARD, isEmptyDashboard } from './netWorthText';

export function NetWorthPage(): JSX.Element {
  const [view, setView] = useState<ChartView>({});
  const query = useNetWorthPage(view);
  const page = query.data;
  const actions = page ? (
    <>
      {page.recordable.length > 0 ? (
        <LinkButton to="/history" hash="record" icon={CalendarPlus} variant="secondary">
          Record month
        </LinkButton>
      ) : null}
      <LinkButton to="/history" icon={History} variant="ghost">
        History
      </LinkButton>
    </>
  ) : undefined;
  return (
    <>
      <PageHeader title="Net worth" subtitle="Overview" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading net worth…"
        layout="dashboard"
        errorTitle="Could not load net worth"
      />
      {page ? (
        <NetWorthContent page={page} switching={query.isPlaceholderData} onView={setView} />
      ) : null}
    </>
  );
}

function NetWorthContent({
  page,
  switching,
  onView,
}: {
  page: NetWorthPageResponse;
  /** A view change is loading: the previous response is on screen, the charts dim. */
  switching: boolean;
  onView: (view: ChartView) => void;
}): JSX.Element {
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const changed = useRef(false);
  const { unit, count } = page.charts;
  // Announce the new view once it has arrived (never on the first load).
  useEffect(() => {
    if (changed.current && !switching) setAnnouncement(viewAnnouncement(unit, count));
  }, [unit, count, switching]);

  if (isEmptyDashboard(page)) {
    return (
      <BrandScreen
        variant="empty"
        fullViewport={false}
        title="No figures yet"
        message={EMPTY_DASHBOARD}
        actions={
          <>
            <Link to="/import">Import the workbook</Link>
            <Link to="/cash">Add accounts</Link>
          </>
        }
      />
    );
  }

  const changeView = (next: ChartView): void => {
    changed.current = true;
    onView(next);
  };

  return (
    <>
      <NetWorthTiles page={page} />
      <NetWorthCallouts page={page} />
      <LiveRegion kind="status" label="Chart view" className="jf-visually-hidden">
        {announcement}
      </LiveRegion>

      <section className="jf-app-block" aria-labelledby="networth-stands-heading">
        <SectionBar id="networth-stands-heading" title="Where it stands" role="primary" />
        {/* Dense (D109): the assets table on the left; the allocation, the donut and the gauge
            share the right half, so the whole position fits in about one screen at 1440 px. */}
        <Grid>
          <GridItem span={6} spanTablet={6}>
            <AssetsCard page={page} />
          </GridItem>
          <GridItem span={6} spanTablet={6}>
            <Stack gap={3}>
              <AllocationTable page={page} />
              <Grid>
                <GridItem span={6} spanTablet={3}>
                  <DistributionCard page={page} loading={switching} />
                </GridItem>
                <GridItem span={6} spanTablet={3}>
                  <SavingsRateCard page={page} />
                </GridItem>
              </Grid>
            </Stack>
          </GridItem>
        </Grid>
      </section>

      <section className="jf-app-block" aria-labelledby="networth-time-heading">
        <SectionBar
          id="networth-time-heading"
          title="Over time"
          role="supporting"
          actions={<ViewSwitch unit={unit} count={count} onChange={changeView} />}
        />
        <OverTimeCharts page={page} loading={switching} />
      </section>

      <RollingSection page={page} />
    </>
  );
}
