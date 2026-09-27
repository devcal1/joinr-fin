// The FIRE page's words and figures (stage-6.md §6.1, §6.3, STYLE_GUIDE §8), pure: the status
// words, the tile lines, the callouts in order with the two-callout cap, the milestone nodes (merged
// by year, coloured by position), the rates at one decimal and the real-rate comparison. No React.
import {
  FIRE_HORIZON_AGE,
  FIRE_MILESTONE_TONE_ORDER,
  FIRE_PHASE_WORDS,
  FIRE_WINDOW_STALE_DAYS,
  type FireMilestoneDto,
  type FireMilestoneKind,
  type FireMissingInput,
  type FirePageResponse,
  type FireProjectionDto,
  type FireStatus,
  type FireSummaryDto,
  type IsoDate,
} from '@joinr/schema';
import { formatDateLong, formatMoney, formatMonth, formatPercent } from '@joinr/ui';

export const DASH = '—';

/** Whole dollars (tiles, prose): `$42,500`, `−$50,000`. */
export function dollars(cents: number): string {
  return formatMoney(cents, { wholeDollars: true });
}

/** Two decimals (tables): `$42,500.00`. */
export function money(cents: number): string {
  return formatMoney(cents);
}

/** A ratio at one decimal (`7.4%`); "—" when unset. */
export function rateText(ratio: string | null | undefined): string {
  if (ratio === null || ratio === undefined) return DASH;
  const value = Number(ratio);
  return Number.isFinite(value) ? formatPercent(value) : DASH;
}

/** `1 year`, `3 years`. */
export function yearsText(count: number): string {
  return `${count} ${count === 1 ? 'year' : 'years'}`;
}

/** `1 month`, `12 months`. */
export function monthsText(count: number): string {
  return `${count} ${count === 1 ? 'month' : 'months'}`;
}

/** A calendar date in prose: `31 December 2029`. */
export function longDate(date: IsoDate): string {
  return formatDateLong(date);
}

/** `Mar 2029 – Feb 2030`. */
export function monthRange(from: string, to: string): string {
  return from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;
}

/** The words of each missing input (`needs_input`). */
export const MISSING_WORDS: Readonly<Record<FireMissingInput, string>> = {
  birthYear: 'birth year',
  accessAge: 'access age',
  inflationRate: 'inflation rate',
  withdrawalRate: 'withdrawal rate',
  marketReturn: 'market return',
  cashInterestRate: 'cash interest rate',
  rates: 'workable growth and inflation rates',
};

/** `birth year, withdrawal rate`. */
export function missingText(missing: readonly FireMissingInput[]): string {
  return missing.map((m) => MISSING_WORDS[m]).join(', ');
}

/** The status in a few words (the result strip, the "Saved:" lines). */
export function statusWords(status: FireStatus, missing: readonly FireMissingInput[] = []): string {
  switch (status) {
    case 'fire':
      return 'You’re FIRE';
    case 'not_reachable':
      return `Not reachable by ${FIRE_HORIZON_AGE}`;
    case 'spend_needed':
      return 'Yearly spend needed';
    case 'needs_input':
      return missing.length > 0 ? `Missing: ${missingText(missing)}` : 'Inputs missing';
    case 'on_track':
      return 'On track';
  }
}

/** `FIRE in 2031 · age 56` (with the access age when FIRE comes after it). */
export function fireLine(
  fire: NonNullable<FireProjectionDto['fire']>,
  accessAge: number | null,
): string {
  const base = `FIRE in ${fire.year} · age ${fire.age}`;
  return fire.afterAccess && accessAge !== null
    ? `${base} · after your access age (${accessAge})`
    : base;
}

/** The first tile's figure words: `1 year`, `You’re FIRE`, `Not by 100`, or "—". */
export function yearsToFireValue(projection: FireProjectionDto): string {
  switch (projection.status) {
    case 'on_track':
      return projection.fire ? yearsText(projection.fire.yearsToGo) : DASH;
    case 'fire':
      return 'You’re FIRE';
    case 'not_reachable':
      return `Not by ${FIRE_HORIZON_AGE}`;
    default:
      return DASH;
  }
}

/** The first tile's line under its figure. */
export function yearsToFireLine(projection: FireProjectionDto, accessAge: number | null): string {
  switch (projection.status) {
    case 'on_track':
      return projection.fire ? fireLine(projection.fire, accessAge) : '';
    case 'fire':
      return 'Your plan is funded today';
    case 'not_reachable':
      return 'At these settings';
    case 'spend_needed':
      return 'Set a yearly spend';
    case 'needs_input':
      return `Missing: ${missingText(projection.missing)}`;
  }
}

/** The saved plan's FIRE words ("Saved: FIRE in 2033 · age 58", or its status). */
export function savedFireText(baseline: FireSummaryDto): string {
  if (baseline.status === 'on_track' && baseline.fireYear !== null) {
    return baseline.fireAge !== null
      ? `Saved: FIRE in ${baseline.fireYear} · age ${baseline.fireAge}`
      : `Saved: FIRE in ${baseline.fireYear}`;
  }
  return `Saved: ${statusWords(baseline.status)}`;
}

/** The result strip at the top of the what-if card: `FIRE in 2032 · age 57 · Saved: 2033`. */
export function resultStripText(page: FirePageResponse): string {
  const { projection, baseline } = page;
  const now =
    projection.status === 'on_track' && projection.fire
      ? `FIRE in ${projection.fire.year} · age ${projection.fire.age}`
      : statusWords(projection.status, projection.missing);
  if (!page.whatIfActive || !baseline) return now;
  const saved =
    baseline.status === 'on_track' && baseline.fireYear !== null
      ? String(baseline.fireYear)
      : statusWords(baseline.status);
  return `${now} · Saved: ${saved}`;
}

// ─── Milestones (D101, §2.5 step 8) ────────────────────────────────────────────────────────────

/** A milestone kind's words on the node line, the chart and the tables. */
export const MILESTONE_WORDS: Readonly<Record<FireMilestoneKind, string>> = {
  today: 'Today',
  fire_start: 'FIRE',
  top_ups_end: 'Top-ups end',
  access: 'Access',
};

/** The crosshair tooltip's words for a milestone year. */
export const MILESTONE_TOOLTIP_WORDS: Readonly<Record<FireMilestoneKind, string>> = {
  today: 'Today',
  fire_start: 'FIRE starts',
  top_ups_end: 'Top-ups end',
  access: 'Access age',
};

export interface MilestoneNode {
  t: number;
  year: number;
  age: number;
  kinds: FireMilestoneKind[];
  tone: (typeof FIRE_MILESTONE_TONE_ORDER)[number];
  /** `FIRE` or `FIRE · Access` (two milestones in one year share a node). */
  words: string;
}

/**
 * The distinct milestone nodes in time order: milestones with the same `t` merge into one node
 * (both labels), and the nodes take the spectrum colours by position (1st teal, 2nd violet, 3rd
 * fuchsia, 4th orange), whatever their kind.
 */
export function milestoneNodes(milestones: readonly FireMilestoneDto[]): MilestoneNode[] {
  const byT = new Map<number, FireMilestoneDto[]>();
  for (const m of [...milestones].sort((a, b) => a.t - b.t)) {
    byT.set(m.t, [...(byT.get(m.t) ?? []), m]);
  }
  return [...byT.values()].slice(0, FIRE_MILESTONE_TONE_ORDER.length).map((group, index) => {
    const first = group[0] as FireMilestoneDto;
    const kinds = group.map((m) => m.kind);
    return {
      t: first.t,
      year: first.year,
      age: first.age,
      kinds,
      tone: FIRE_MILESTONE_TONE_ORDER[index] ?? 'orange',
      words: kinds.map((k) => MILESTONE_WORDS[k]).join(' · '),
    };
  });
}

/** The node's sublabel: `2031 · 56`, or `You’re FIRE` on today's node when FIRE is now. */
export function nodeSublabel(node: MilestoneNode, status: FireStatus): string {
  if (status === 'fire' && node.kinds.includes('today')) return 'You’re FIRE';
  return `${node.year} · ${node.age}`;
}

/** The node's position along the line (0–1) between the first and last row's years. */
export function nodePosition(year: number, firstYear: number, lastYear: number): number {
  if (lastYear <= firstYear) return 0;
  return Math.min(1, Math.max(0, (year - firstYear) / (lastYear - firstYear)));
}

/** The phase words between nodes: each node starts the phase of its row. */
export function milestoneSegments(
  projection: FireProjectionDto,
  nodes: readonly MilestoneNode[],
): { from: number; to: number; label: string }[] {
  const rows = projection.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last || nodes.length === 0) return [];
  const segments: { from: number; to: number; label: string }[] = [];
  nodes.forEach((node, index) => {
    const next = nodes[index + 1];
    const row = rows.find((r) => r.t === node.t);
    if (!row) return;
    const from = nodePosition(node.year, first.year, last.year);
    const to = next ? nodePosition(next.year, first.year, last.year) : 1;
    if (to > from) segments.push({ from, to, label: FIRE_PHASE_WORDS[row.phase] });
  });
  return segments;
}

// ─── Callouts (§6.3 item 2) ────────────────────────────────────────────────────────────────────

export type FireCalloutId =
  | 'featureOff'
  | 'needsInput'
  | 'spendNeeded'
  | 'accessAgeReplaced'
  | 'staleWindow'
  | 'workbookContribution';

/** At most this many callouts sit under the header; the rest move into "How it's worked out". */
export const FIRE_CALLOUT_CAP = 2;

/** Whole days from `a` to `b` (calendar dates, no time zone). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const utc = (date: IsoDate): number => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** The months used end more than FIRE_WINDOW_STALE_DAYS before the as-of date. */
export function isWindowStale(page: FirePageResponse): boolean {
  const window = page.derived.window;
  return window !== null && daysBetween(window.through, page.asOf) > FIRE_WINDOW_STALE_DAYS;
}

/**
 * The page's callouts in order: status callouts first, then notes. `featureOffShown` is true when
 * the layout already shows the switched-off note (the page then leaves it out).
 */
export function fireCallouts(page: FirePageResponse, featureOffShown: boolean): FireCalloutId[] {
  const ids: FireCalloutId[] = [];
  const { status } = page.projection;
  if (status === 'needs_input') ids.push('needsInput');
  if (status === 'spend_needed') ids.push('spendNeeded');
  if (!page.featureOn && !featureOffShown) ids.push('featureOff');
  if (page.inputs.accessAge.replaced) ids.push('accessAgeReplaced');
  if (isWindowStale(page)) ids.push('staleWindow');
  const contribution = page.inputs.superContribution;
  if (contribution.workbookCents !== null && contribution.source === 'derived') {
    ids.push('workbookContribution');
  }
  return ids;
}

/** Splits the callouts into those under the header (the cap) and those moved further down. */
export function splitCallouts(ids: readonly FireCalloutId[]): {
  shown: FireCalloutId[];
  moved: FireCalloutId[];
} {
  return { shown: ids.slice(0, FIRE_CALLOUT_CAP), moved: ids.slice(FIRE_CALLOUT_CAP) };
}

/** The D98 note (§3.4): the date is the marker's, in the prose form. */
export function accessAgeReplacedText(
  replaced: NonNullable<FirePageResponse['inputs']['accessAge']['replaced']>,
): string {
  const when = new Date(replaced.at);
  const date = Number.isNaN(when.getTime()) ? replaced.at : formatDateLong(when);
  return (
    `Access age changed from ${replaced.from} (the workbook) to ${replaced.to} on ${date}: ` +
    `${replaced.to} is the preservation age for anyone born after 30 June 1964; ` +
    `${replaced.from} is when super is released unconditionally.`
  );
}

// ─── Rates (§6.1, §6.3 item 6) ─────────────────────────────────────────────────────────────────

/**
 * The real growth and its comparison with the simple difference: `4.0% (not 4.1%)` when the
 * one-decimal texts differ, else both at two decimals (`4.00% (not 4.08%)`); just the rate when the
 * two are equal.
 */
export function realRateComparison(realRatio: string, simpleRatio: string): string {
  const real = Number(realRatio);
  const simple = Number(simpleRatio);
  if (!Number.isFinite(real) || !Number.isFinite(simple)) return rateText(realRatio);
  const r1 = formatPercent(real);
  const s1 = formatPercent(simple);
  if (r1 !== s1) return `${r1} (not ${s1})`;
  const r2 = formatPercent(real, { dp: 2 });
  const s2 = formatPercent(simple, { dp: 2 });
  return r2 === s2 ? r1 : `${r2} (not ${s2})`;
}

/** The yearly spend's source line (the fourth tile). */
export function spendSourceLine(page: FirePageResponse): string {
  const spend = page.inputs.yearlySpend;
  switch (spend.source) {
    case 'setting':
      return 'Your setting';
    case 'what_if':
      return 'What-if';
    case 'derived': {
      const periods = page.derived.window?.periods ?? 0;
      const base = `From your last ${monthsText(periods)}`;
      return periods < 6 ? `${base} (only ${monthsText(periods)} recorded)` : base;
    }
    case 'default':
    case 'missing':
      return 'No recorded months to base it on';
  }
}
