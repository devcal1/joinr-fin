// "Your path by year" (stage-6.md §5, D101), pure: the two views' categories, series (entity
// colours: pre-super slot 1, super slot 6 as everywhere in the app, the needed line slot 3 and
// dashed), the milestone markers (colour by position, dots only when narrow or crowded), the
// one-line summaries and the table rows. Values are dollars for the chart; cents for the tables.
import {
  NET_WORTH_CLASS_SLOTS,
  type FireProjectionDto,
  type FireRowDto,
  type FireStatus,
} from '@joinr/schema';
import { CHART_PALETTE, type LineChartMarker, type Series } from '@joinr/ui';
import {
  MILESTONE_TOOLTIP_WORDS,
  MILESTONE_WORDS,
  milestoneNodes,
  type MilestoneNode,
} from './fireText';

export type FireChartView = 'balances' | 'needed';

export const FIRE_CHART_VIEWS: readonly { value: FireChartView; label: string }[] = [
  { value: 'balances', label: 'Balances' },
  { value: 'needed', label: 'Needed vs projected' },
];

/** Pre-super: slot 1; super: its app-wide class slot (6); the needed line: slot 3. */
export const PRE_SUPER_COLOR = CHART_PALETTE[0] ?? '#07AE8B';
export const SUPER_COLOR = CHART_PALETTE[NET_WORTH_CLASS_SLOTS.super - 1] ?? '#B268FF';
export const NEEDED_COLOR = CHART_PALETTE[2] ?? '#EB6903';

export const SERIES_NAMES = {
  preSuper: 'Pre-super',
  super: 'Super',
  projected: 'Projected pre-super',
  needed: 'Needed to stop that year',
} as const;

/** Labels closer than this (px) turn the chart's markers into dots only. */
export const MARKER_LABEL_GAP = 64;
/** The plot is about this much narrower than the chart (the value axis and the card's padding). */
export const PLOT_INSET_PX = 96;
/** An 11 px label's width, roughly, per character (px). */
const LABEL_CHAR_PX = 6;

/** Cents → dollars for the chart (an exact division; the tables keep the cents). */
function toDollars(cents: number): number {
  return cents / 100;
}

export function chartCategories(projection: FireProjectionDto): string[] {
  return projection.rows.map((row) => String(row.year));
}

export function balancesSeries(projection: FireProjectionDto): Series[] {
  return [
    {
      name: SERIES_NAMES.preSuper,
      data: projection.rows.map((r) => toDollars(r.preSuper.startCents)),
      color: PRE_SUPER_COLOR,
    },
    {
      name: SERIES_NAMES.super,
      data: projection.rows.map((r) => toDollars(r.super.startCents)),
      color: SUPER_COLOR,
    },
  ];
}

export function neededSeries(projection: FireProjectionDto): Series[] {
  return [
    {
      name: SERIES_NAMES.projected,
      data: projection.rows.map((r) => (r.helper ? toDollars(r.helper.projectedCents) : null)),
      color: PRE_SUPER_COLOR,
    },
    {
      name: SERIES_NAMES.needed,
      data: projection.rows.map((r) => (r.helper ? toDollars(r.helper.neededCents) : null)),
      color: NEEDED_COLOR,
      dashed: true,
    },
  ];
}

/** True when the needed-vs-projected view has something to draw (the helper needs a spend). */
export function hasHelper(projection: FireProjectionDto): boolean {
  return projection.rows.some((r) => r.helper !== null);
}

/** Two labels would sit closer than 64 px on a chart of this width. */
/**
 * Two markers' labels would sit closer than 64 px, or overlap, on a chart this wide: the labels'
 * widths are estimated from their length and anchored as the chart draws them (the first to the
 * right of its line, the last to the left, the others centred).
 */
export function markersCrowded(
  nodes: readonly MilestoneNode[],
  categoryCount: number,
  widthPx: number,
): boolean {
  if (categoryCount < 2 || nodes.length < 2) return false;
  const perCategory = Math.max(0, widthPx - PLOT_INSET_PX) / (categoryCount - 1);
  const last = nodes.length - 1;
  const span = (node: MilestoneNode, index: number): [number, number] => {
    const x = node.t * perCategory;
    const w = `${node.words} ${node.year}`.length * LABEL_CHAR_PX;
    if (index === 0) return [x, x + w];
    if (index === last) return [x - w, x];
    return [x - w / 2, x + w / 2];
  };
  return nodes.some((node, i) => {
    const next = nodes[i + 1];
    if (next === undefined) return false;
    if ((next.t - node.t) * perCategory < MARKER_LABEL_GAP) return true;
    return span(next, i + 1)[0] - span(node, i)[1] < 8;
  });
}

/**
 * The chart's markers: one per node (merged milestones share it), at the node's row, coloured by
 * position; dots only on a phone (below 768 px) or when two labels would be closer than 64 px
 * or overlap.
 */
export function chartMarkers(
  projection: FireProjectionDto,
  widthPx: number | null,
  narrow: boolean,
): LineChartMarker[] {
  const nodes = milestoneNodes(projection.milestones);
  const categoryCount = projection.rows.length;
  const dotsOnly = narrow || (widthPx !== null && markersCrowded(nodes, categoryCount, widthPx));
  return nodes
    .map((node) => {
      const index = projection.rows.findIndex((r) => r.t === node.t);
      return {
        index,
        label: `${node.words} ${node.year}`,
        tone: node.tone,
        labelHidden: dotsOnly,
        tooltip: node.kinds.map((k) => MILESTONE_TOOLTIP_WORDS[k]).join(' · '),
      } satisfies LineChartMarker;
    })
    .filter((m) => m.index >= 0);
}

/** The one-line summary of each view (the chart's accessible name). */
export function chartSummary(projection: FireProjectionDto, view: FireChartView): string {
  const rows = projection.rows;
  const first = rows[0]?.year;
  const last = rows[rows.length - 1]?.year;
  const fire = projection.fire;
  const status: FireStatus = projection.status;
  if (view === 'balances') {
    const span =
      first !== undefined && last !== undefined ? ` from ${first} to ${last}` : ' (no years yet)';
    const tail =
      status === 'fire'
        ? '; you are FIRE now.'
        : fire
          ? `; FIRE in ${fire.year}.`
          : status === 'not_reachable'
            ? '; FIRE not reachable at these settings.'
            : '.';
    return `Pre-super and super balances${span}${tail}`;
  }
  if (!hasHelper(projection))
    return 'Needed and projected pre-super: set a yearly spend to see them.';
  const tail =
    status === 'fire'
      ? '; projected already covers needed.'
      : fire
        ? `; projected first covers needed in ${fire.year}.`
        : '; projected never covers needed at these settings.';
  return `Needed and projected pre-super by year${tail}`;
}

/** The milestone words of each row (the tables' Milestone column and Year pills). */
export function rowMilestones(projection: FireProjectionDto): Map<number, string[]> {
  const words = new Map<number, string[]>();
  for (const m of projection.milestones) {
    if (m.kind === 'today') continue;
    words.set(m.t, [...(words.get(m.t) ?? []), MILESTONE_WORDS[m.kind]]);
  }
  return words;
}

/** The rows the year-by-year table marks (the sheet's highlight): the FIRE row and the access row. */
export function highlightedRow(projection: FireProjectionDto, row: FireRowDto): boolean {
  if (projection.fire && row.t === projection.fire.yearsToGo && projection.status !== 'fire') {
    return true;
  }
  return projection.yearsToAccess !== null && projection.yearsToAccess > 0
    ? row.t === projection.yearsToAccess
    : false;
}
