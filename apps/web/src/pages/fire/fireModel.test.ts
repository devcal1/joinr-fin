// The FIRE page's pure words and chart model (stage-6.md §5, §6.1, §6.3): status words and tile
// lines, the callouts in order with the two-callout cap, milestone nodes merged by year and
// coloured by position, the real-rate comparison, the chart's series colours (with the palette
// validator's pair checks), markers (dots only when narrow or crowded) and summaries.
import { CHART_PALETTE, COLORS } from '@joinr/ui';
import { firePages } from '@joinr/schema/fixtures';
import type { FirePageResponse } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  NEEDED_COLOR,
  PRE_SUPER_COLOR,
  SUPER_COLOR,
  balancesSeries,
  chartCategories,
  chartMarkers,
  chartSummary,
  hasHelper,
  highlightedRow,
  markersCrowded,
  neededSeries,
  rowMilestones,
} from './fireChart';
import {
  FIRE_CALLOUT_CAP,
  accessAgeReplacedText,
  daysBetween,
  fireCallouts,
  isWindowStale,
  milestoneNodes,
  milestoneSegments,
  nodePosition,
  nodeSublabel,
  rateText,
  realRateComparison,
  resultStripText,
  savedFireText,
  spendSourceLine,
  splitCallouts,
  statusWords,
  yearsToFireLine,
  yearsToFireValue,
} from './fireText';

const withPage = (base: FirePageResponse, patch: Partial<FirePageResponse>): FirePageResponse => ({
  ...base,
  ...patch,
});

describe('status words and the first tile', () => {
  it('words every status', () => {
    expect(yearsToFireValue(firePages.onTrack.projection)).toBe('1 year');
    expect(yearsToFireLine(firePages.onTrack.projection, 60)).toBe('FIRE in 2031 · age 56');
    expect(yearsToFireValue(firePages.fireNow.projection)).toBe('You’re FIRE');
    expect(yearsToFireValue(firePages.notReachable.projection)).toBe('Not by 100');
    expect(yearsToFireLine(firePages.notReachable.projection, 60)).toBe('At these settings');
    expect(yearsToFireValue(firePages.spendNeeded.projection)).toBe('—');
    expect(yearsToFireLine(firePages.spendNeeded.projection, 60)).toBe('Set a yearly spend');
    expect(yearsToFireValue(firePages.needsInput.projection)).toBe('—');
    expect(yearsToFireLine(firePages.needsInput.projection, 60)).toBe(
      'Missing: birth year, withdrawal rate',
    );
  });

  it('says when FIRE comes after the access age', () => {
    const { projection } = firePages.afterAccess;
    expect(yearsToFireValue(projection)).toBe('8 years');
    expect(yearsToFireLine(projection, 60)).toBe(
      'FIRE in 2038 · age 63 · after your access age (60)',
    );
  });

  it('words the saved plan and the result strip', () => {
    const { whatIf, whatIfStatusChange } = firePages;
    expect(whatIf.baseline).not.toBeNull();
    if (whatIf.baseline) expect(savedFireText(whatIf.baseline)).toMatch(/^Saved: FIRE in \d{4}/);
    expect(resultStripText(whatIf)).toMatch(/^FIRE in \d{4} · age \d+ · Saved: \d{4}$/);
    expect(resultStripText(whatIfStatusChange)).toMatch(/^Not reachable by 100 · Saved: \d{4}$/);
    expect(resultStripText(firePages.onTrack)).toBe('FIRE in 2031 · age 56');
    expect(statusWords('fire')).toBe('You’re FIRE');
    expect(statusWords('needs_input', ['birthYear'])).toBe('Missing: birth year');
  });

  it('words the spend source, noting a short window', () => {
    expect(spendSourceLine(firePages.onTrack)).toBe('From your last 12 months');
    expect(spendSourceLine(firePages.shortWindow)).toBe(
      'From your last 3 months (only 3 months recorded)',
    );
    expect(spendSourceLine(firePages.spendOverride)).toBe('Your setting');
    expect(spendSourceLine(firePages.whatIf)).toBe('What-if');
  });
});

describe('callouts', () => {
  it('lists status callouts first, then the notes in order', () => {
    expect(fireCallouts(firePages.onTrack, false)).toEqual([]);
    expect(fireCallouts(firePages.needsInput, false)).toEqual(['needsInput']);
    expect(fireCallouts(firePages.spendNeeded, false)).toEqual(['spendNeeded']);
    expect(fireCallouts(firePages.upgradedAge, false)).toEqual(['accessAgeReplaced']);
    expect(fireCallouts(firePages.staleWindow, false)).toEqual(['staleWindow']);
    expect(fireCallouts(firePages.workbookContribution, false)).toEqual(['workbookContribution']);
    expect(fireCallouts(firePages.featureOff, false)).toEqual(['featureOff']);
    // The layout already shows the switched-off note: the page leaves it out.
    expect(fireCallouts(firePages.featureOff, true)).toEqual([]);
  });

  it('keeps two under the header and moves the rest', () => {
    const crowded = withPage(firePages.needsInput, {
      inputs: {
        ...firePages.needsInput.inputs,
        accessAge: firePages.upgradedAge.inputs.accessAge,
        superContribution: firePages.workbookContribution.inputs.superContribution,
      },
      derived: firePages.staleWindow.derived,
    });
    const ids = fireCallouts(crowded, false);
    expect(ids).toEqual(['needsInput', 'accessAgeReplaced', 'staleWindow', 'workbookContribution']);
    expect(FIRE_CALLOUT_CAP).toBe(2);
    expect(splitCallouts(ids)).toEqual({
      shown: ['needsInput', 'accessAgeReplaced'],
      moved: ['staleWindow', 'workbookContribution'],
    });
  });

  it('finds a stale window more than 45 days before the as-of date', () => {
    expect(daysBetween('2030-01-31', '2030-03-15')).toBe(43);
    expect(isWindowStale(firePages.onTrack)).toBe(false);
    expect(isWindowStale(firePages.staleWindow)).toBe(true);
    expect(isWindowStale(firePages.spendNeeded)).toBe(false);
  });

  it('writes the D98 note with the marker’s date in prose', () => {
    const replaced = firePages.upgradedAge.inputs.accessAge.replaced;
    expect(replaced).not.toBeNull();
    if (!replaced) return;
    expect(accessAgeReplacedText(replaced)).toMatch(
      /^Access age changed from 65 \(the workbook\) to 60 on \d{1,2} [A-Z][a-z]+ \d{4}: 60 is the preservation age for anyone born after 30 June 1964; 65 is when super is released unconditionally\.$/,
    );
  });
});

describe('milestone nodes (D101: colour by position, merged by year)', () => {
  it('keeps teal → violet → fuchsia → orange along the line in onTrack', () => {
    const nodes = milestoneNodes(firePages.onTrack.projection.milestones);
    expect(nodes.map((n) => [n.words, n.year, n.tone])).toEqual([
      ['Today', 2030, 'teal'],
      ['FIRE', 2031, 'violet'],
      ['Top-ups end', 2034, 'fuchsia'],
      ['Access', 2035, 'orange'],
    ]);
  });

  it('colours afterAccess by position, not kind (access before FIRE)', () => {
    const nodes = milestoneNodes(firePages.afterAccess.projection.milestones);
    expect(nodes.map((n) => [n.words, n.tone])).toEqual([
      ['Today', 'teal'],
      ['Access', 'violet'],
      ['FIRE', 'fuchsia'],
    ]);
  });

  it('merges two milestones in one year into one node with both labels (fireAtAccess)', () => {
    const { projection } = firePages.fireAtAccess;
    const nodes = milestoneNodes(projection.milestones);
    const merged = nodes.find((n) => n.kinds.length > 1);
    expect(merged?.words).toBe('FIRE · Access');
    expect(nodes.map((n) => n.tone)).toEqual(
      ['teal', 'violet', 'fuchsia', 'orange'].slice(0, nodes.length),
    );
    expect(new Set(nodes.map((n) => n.t)).size).toBe(nodes.length);
  });

  it('omits the FIRE node when FIRE is now and says so on today', () => {
    const { projection } = firePages.fireNow;
    const nodes = milestoneNodes(projection.milestones);
    expect(nodes.some((n) => n.kinds.includes('fire_start'))).toBe(false);
    const [today, next] = nodes;
    if (!today || !next) throw new Error('expected two nodes');
    expect(nodeSublabel(today, 'fire')).toBe('You’re FIRE');
    expect(nodeSublabel(next, 'fire')).toBe('2034 · 59');
  });

  it('has no access node once the access age is reached', () => {
    const nodes = milestoneNodes(firePages.accessReached.projection.milestones);
    expect(nodes.some((n) => n.kinds.includes('access'))).toBe(false);
  });

  it('places nodes by year and writes the phases between them', () => {
    expect(nodePosition(2031, 2030, 2036)).toBeCloseTo(1 / 6, 10);
    expect(nodePosition(2030, 2030, 2030)).toBe(0);
    const { projection } = firePages.onTrack;
    const segments = milestoneSegments(projection, milestoneNodes(projection.milestones));
    expect(segments.map((s) => s.label)).toEqual([
      'Saving',
      'Drawing down, topping up super',
      'Drawing down',
      'Living on super',
    ]);
    expect(segments[3]?.to).toBe(1);
  });
});

describe('rates', () => {
  it('shows one decimal everywhere', () => {
    expect(rateText('0.0612')).toBe('6.1%');
    expect(rateText('0.05')).toBe('5.0%');
    expect(rateText(null)).toBe('—');
  });

  it('compares the exact real rate with the simple one (fix 4)', () => {
    expect(realRateComparison('0.04', '0.0408')).toBe('4.0% (not 4.1%)');
    expect(realRateComparison('0.0401', '0.0404')).toBe('4.01% (not 4.04%)');
    expect(realRateComparison('0.04', '0.04')).toBe('4.0%');
  });
});

describe('the chart model', () => {
  const { projection } = firePages.onTrack;

  it('draws pre-super in slot 1, super in slot 6 and the needed line dashed in slot 3', () => {
    expect(PRE_SUPER_COLOR).toBe(CHART_PALETTE[0]);
    expect(SUPER_COLOR).toBe(CHART_PALETTE[5]);
    expect(NEEDED_COLOR).toBe(CHART_PALETTE[2]);
    expect(chartCategories(projection)).toEqual([
      '2030',
      '2031',
      '2032',
      '2033',
      '2034',
      '2035',
      '2036',
    ]);
    const balances = balancesSeries(projection);
    expect(balances.map((s) => [s.name, s.color, s.dashed ?? false])).toEqual([
      ['Pre-super', PRE_SUPER_COLOR, false],
      ['Super', SUPER_COLOR, false],
    ]);
    expect(balances[0]?.data[0]).toBe(150_000);
    expect(balances[1]?.data[5]).toBe(800_000);
    const needed = neededSeries(projection);
    expect(needed.map((s) => [s.name, s.color, s.dashed ?? false])).toEqual([
      ['Projected pre-super', PRE_SUPER_COLOR, false],
      ['Needed to stop that year', NEEDED_COLOR, true],
    ]);
    expect(needed[1]?.data.slice(0, 2)).toEqual([235_614.58, 185_039.16]);
    expect(hasHelper(firePages.spendNeeded.projection)).toBe(false);
  });

  it('keeps the pairs distinguishable (the palette validator’s maths)', () => {
    type Rgb = [number, number, number];
    const toLinear = (hex: string): Rgb =>
      [0, 2, 4].map((i) => {
        const c = parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as Rgb;
    const oklab = ([r, g, b]: Rgb): Rgb => {
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ];
    };
    const MACHADO = {
      protan: [
        [0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281, 0.099216],
        [-0.003882, -0.048116, 1.051998],
      ],
      deutan: [
        [0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501, 0.047413],
        [-0.01182, 0.04294, 0.968881],
      ],
    } as const;
    const simulate = (hex: string, kind: keyof typeof MACHADO): Rgb => {
      const [r, g, b] = toLinear(hex);
      const clamp = (v: number): number => Math.min(1, Math.max(0, v));
      return MACHADO[kind].map(([x, y, z]) => clamp(x * r + y * g + z * b)) as Rgb;
    };
    const deltaE = (a: Rgb, b: Rgb): number => {
      const [p, q] = [oklab(a), oklab(b)];
      return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    const luminance = (hex: string): number => {
      const [r, g, b] = toLinear(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const [a, b] of [
      [PRE_SUPER_COLOR, SUPER_COLOR],
      [PRE_SUPER_COLOR, NEEDED_COLOR],
    ] as const) {
      expect(deltaE(toLinear(a), toLinear(b)), `${a}↔${b}`).toBeGreaterThanOrEqual(15);
      expect(
        Math.min(
          deltaE(simulate(a, 'protan'), simulate(b, 'protan')),
          deltaE(simulate(a, 'deutan'), simulate(b, 'deutan')),
        ),
        `${a}↔${b} (CVD)`,
      ).toBeGreaterThanOrEqual(8);
      expect(contrast(a, COLORS.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(b, COLORS.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('marks each node with its label and tone, dots only when narrow or crowded', () => {
    const wide = chartMarkers(projection, 1200, false);
    expect(wide.map((m) => [m.index, m.label, m.tone, m.labelHidden])).toEqual([
      [0, 'Today 2030', 'teal', false],
      [1, 'FIRE 2031', 'violet', false],
      [4, 'Top-ups end 2034', 'fuchsia', false],
      [5, 'Access 2035', 'orange', false],
    ]);
    expect(wide[1]?.tooltip).toBe('FIRE starts');
    expect(chartMarkers(projection, 1200, true).every((m) => m.labelHidden)).toBe(true);
    expect(chartMarkers(projection, 700, false).every((m) => m.labelHidden)).toBe(true);
    // Unmeasured (no layout): labels shown unless on a phone.
    expect(chartMarkers(projection, null, false).every((m) => !m.labelHidden)).toBe(true);
    const nodes = milestoneNodes(projection.milestones);
    // Six gaps: 200 px per year at 1200 px; at 360 px, 60 px per year → crowded.
    expect(markersCrowded(nodes, 7, 1200)).toBe(false);
    expect(markersCrowded(nodes, 7, 360)).toBe(true);
    const merged = chartMarkers(firePages.fireAtAccess.projection, 1200, false);
    expect(merged.some((m) => m.label.startsWith('FIRE · Access '))).toBe(true);
  });

  it('summarises each view in one line', () => {
    expect(chartSummary(projection, 'balances')).toBe(
      'Pre-super and super balances from 2030 to 2036; FIRE in 2031.',
    );
    expect(chartSummary(projection, 'needed')).toBe(
      'Needed and projected pre-super by year; projected first covers needed in 2031.',
    );
    expect(chartSummary(firePages.spendNeeded.projection, 'needed')).toMatch(/set a yearly spend/);
  });

  it('finds the milestone words and the highlighted rows of the tables', () => {
    const words = rowMilestones(projection);
    expect([...words.entries()]).toEqual([
      [1, ['FIRE']],
      [4, ['Top-ups end']],
      [5, ['Access']],
    ]);
    const marked = projection.rows.filter((r) => highlightedRow(projection, r)).map((r) => r.t);
    expect(marked).toEqual([1, 5]);
  });
});
