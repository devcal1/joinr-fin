// "Your path" (stage-6.md §5, §6.3 item 4, D101): the milestone line (the node-line motif, nodes
// coloured by position) and "Your path by year" with its Balances | Needed vs projected switch, each
// view with its table twin. The chart's markers are dots only on a phone or when two labels would
// be closer than 64 px (the milestone line above carries the words).
import {
  FIRE_PHASE_WORDS,
  type FirePageResponse,
  type FireProjectionDto,
  type FireRowDto,
} from '@joinr/schema';
import {
  Button,
  ChartCard,
  ColumnTable,
  LineChart,
  MEDIA,
  MilestoneLine,
  Pill,
  compactMoneyFormatter,
  moneyFormatter,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  FIRE_CHART_VIEWS,
  balancesSeries,
  chartCategories,
  chartMarkers,
  chartSummary,
  neededSeries,
  rowMilestones,
  type FireChartView,
} from './fireChart';
import { milestoneNodes, milestoneSegments, money, nodePosition, nodeSublabel } from './fireText';

const TOOLTIP_DOLLARS = moneyFormatter();

const CAPTIONS: Record<FireChartView, string> = {
  balances:
    'In today’s dollars, at each anniversary of today; the year’s saving and spending are counted at its end.',
  needed:
    'Needed: what the FIRE pot must hold to stop that year (spend to your access age plus any super shortfall). Projected: your pre-super net worth if you keep saving.',
};

const TABLE_CAPTIONS: Record<FireChartView, string> = {
  balances: 'Balances by year, in today’s dollars, at each anniversary of today',
  needed: 'Needed vs projected by year, in today’s dollars, at each anniversary of today',
};

/** Tracks an element's width (null until measured, or where there is no layout). */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function FireMilestones({ page }: { page: FirePageResponse }): JSX.Element | null {
  const { projection } = page;
  const phone = useMediaQuery(MEDIA.phone);
  const rows = projection.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const nodes = milestoneNodes(projection.milestones);
  if (!first || !last || nodes.length === 0) return null;
  return (
    <MilestoneLine
      ariaLabel="Your FIRE milestones"
      orientation={phone ? 'vertical' : 'horizontal'}
      nodes={nodes.map((node) => ({
        key: `${node.t}-${node.kinds.join('-')}`,
        tone: node.tone,
        position: nodePosition(node.year, first.year, last.year),
        label: node.words,
        sublabel: nodeSublabel(node, projection.status),
      }))}
      segments={milestoneSegments(projection, nodes)}
    />
  );
}

/** Two buttons with aria-pressed in a named group (the card's view switch). */
function ViewSwitch({
  value,
  onChange,
}: {
  value: FireChartView;
  onChange: (view: FireChartView) => void;
}): JSX.Element {
  return (
    <div className="jf-app-fire-view-switch" role="group" aria-label="Your path by year: view">
      {FIRE_CHART_VIEWS.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? 'secondary' : 'ghost'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function MilestonePills({ words }: { words: readonly string[] | undefined }): JSX.Element | null {
  if (!words || words.length === 0) return null;
  return (
    <span className="jf-app-fire-pills">
      {words.map((word) => (
        <Pill key={word} tone="violet">
          {word}
        </Pill>
      ))}
    </span>
  );
}

function Money({ cents, tintNegative = true }: { cents: number; tintNegative?: boolean }) {
  return (
    <span className={tintNegative && cents < 0 ? 'jf-app-negative' : undefined}>
      {money(cents)}
    </span>
  );
}

/** "Short by $X" in the stop tint; "Ahead by $X" in body text (not a gain). */
function GapText({ gapCents }: { gapCents: number }): JSX.Element {
  return gapCents > 0 ? (
    <span className="jf-app-negative">Short by {money(gapCents)}</span>
  ) : (
    <span>Ahead by {money(-gapCents)}</span>
  );
}

function balancesColumns(milestones: Map<number, string[]>): ColumnTableColumn<FireRowDto>[] {
  return [
    { id: 'year', header: 'Year', value: (r) => r.year },
    { id: 'age', header: 'Age', value: (r) => r.age, numeric: true },
    { id: 'phase', header: 'Phase', value: (r) => FIRE_PHASE_WORDS[r.phase] },
    {
      id: 'milestone',
      header: 'Milestone',
      value: (r) => (milestones.get(r.t) ?? []).join(', ') || null,
      cell: (r) => <MilestonePills words={milestones.get(r.t)} />,
    },
    {
      id: 'preSuper',
      header: 'Pre-super',
      value: (r) => r.preSuper.startCents,
      cell: (r) => <Money cents={r.preSuper.startCents} />,
      numeric: true,
    },
    {
      id: 'super',
      header: 'Super',
      value: (r) => r.super.startCents,
      cell: (r) => <Money cents={r.super.startCents} />,
      numeric: true,
    },
  ];
}

function neededColumns(milestones: Map<number, string[]>): ColumnTableColumn<FireRowDto>[] {
  return [
    { id: 'year', header: 'Year', value: (r) => r.year },
    {
      id: 'milestone',
      header: 'Milestone',
      value: (r) => (milestones.get(r.t) ?? []).join(', ') || null,
      cell: (r) => <MilestonePills words={milestones.get(r.t)} />,
    },
    {
      id: 'needed',
      header: 'Needed',
      value: (r) => r.helper?.neededCents ?? null,
      cell: (r) => (r.helper ? <Money cents={r.helper.neededCents} /> : null),
      numeric: true,
    },
    {
      id: 'projected',
      header: 'Projected',
      value: (r) => r.helper?.projectedCents ?? null,
      cell: (r) => (r.helper ? <Money cents={r.helper.projectedCents} /> : null),
      numeric: true,
    },
    {
      id: 'gap',
      header: 'Short by / Ahead by',
      value: (r) => r.helper?.gapCents ?? null,
      cell: (r) => (r.helper ? <GapText gapCents={r.helper.gapCents} /> : null),
      numeric: true,
    },
  ];
}

function PathTable({
  projection,
  view,
}: {
  projection: FireProjectionDto;
  view: FireChartView;
}): JSX.Element {
  const milestones = useMemo(() => rowMilestones(projection), [projection]);
  const columns = view === 'balances' ? balancesColumns(milestones) : neededColumns(milestones);
  return (
    <ColumnTable
      caption={TABLE_CAPTIONS[view]}
      showCaption
      columns={columns}
      rows={projection.rows}
      getRowId={(r) => String(r.t)}
      emptyMessage="No years to show at these settings."
    />
  );
}

export function FirePathChart({
  page,
  updating,
}: {
  page: FirePageResponse;
  /** A what-if is loading: the chart dims (the previous figures stay). */
  updating: boolean;
}): JSX.Element {
  const { projection } = page;
  const [view, setView] = useState<FireChartView>('balances');
  const phone = useMediaQuery(MEDIA.phone);
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const categories = useMemo(() => chartCategories(projection), [projection]);
  const series = useMemo(
    () => (view === 'balances' ? balancesSeries(projection) : neededSeries(projection)),
    [projection, view],
  );
  const markers = useMemo(() => chartMarkers(projection, width, phone), [projection, width, phone]);
  const summary = chartSummary(projection, view);
  const subtitle = view === 'balances' ? 'Balances' : 'Needed vs projected';
  return (
    <div ref={ref} className="jf-app-fire-chart" data-view={view}>
      <ChartCard
        title="Your path by year"
        subtitle={subtitle}
        actions={<ViewSwitch value={view} onChange={setView} />}
        chart={
          <>
            <LineChart
              ariaLabel={summary}
              categories={categories}
              series={series}
              markers={markers}
              valueFormatter={TOOLTIP_DOLLARS}
              axisFormatter={compactMoneyFormatter}
              loading={updating}
              height={300}
              emptyMessage={
                view === 'needed'
                  ? 'Set a yearly spend to see what you need each year.'
                  : 'No years to chart at these settings.'
              }
            />
            <p className="jf-app-fire-caption">{CAPTIONS[view]}</p>
          </>
        }
        table={<PathTable projection={projection} view={view} />}
      />
    </div>
  );
}
