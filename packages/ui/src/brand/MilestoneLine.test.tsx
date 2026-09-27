// MilestoneLine (stage-6.md §6.5, web-fire): nodes in the order and tones the caller gives, placed
// by position, labels under the line, the segments' words, colliding labels stacked, the
// orientation modes, the decorative visual duplicated as a visually-hidden ordered list, and a
// stylesheet with no glow and a container query for 'auto'.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MILESTONE_ASSUMED_WIDTH,
  MILESTONE_LABEL_GAP,
  MilestoneLine,
  milestoneLabelRows,
  type MilestoneLineNode,
  type MilestoneLineSegment,
} from './MilestoneLine';

const NODES: MilestoneLineNode[] = [
  { key: 'today', tone: 'teal', position: 0, label: 'Today', sublabel: '2030 · 55' },
  { key: 'fire', tone: 'violet', position: 1 / 6, label: 'FIRE', sublabel: '2031 · 56' },
  { key: 'topups', tone: 'fuchsia', position: 4 / 6, label: 'Top-ups end', sublabel: '2034 · 59' },
  { key: 'access', tone: 'orange', position: 5 / 6, label: 'Access', sublabel: '2035 · 60' },
];
const SEGMENTS: MilestoneLineSegment[] = [
  { from: 0, to: 1 / 6, label: 'Saving' },
  { from: 1 / 6, to: 4 / 6, label: 'Drawing down, topping up super' },
  { from: 4 / 6, to: 5 / 6, label: 'Drawing down' },
  { from: 5 / 6, to: 1, label: 'Living on super' },
];

function renderLine(extra: Partial<Parameters<typeof MilestoneLine>[0]> = {}) {
  return render(
    <MilestoneLine nodes={NODES} segments={SEGMENTS} ariaLabel="Your FIRE milestones" {...extra} />,
  );
}

describe('MilestoneLine', () => {
  it('is a named group whose visual is decorative', () => {
    const { container } = renderLine();
    const group = screen.getByRole('group', { name: 'Your FIRE milestones' });
    expect(group).toHaveClass('jf-milestone-line', 'jf-milestone-line--auto');
    expect(container.querySelector('.jf-milestone-line__body')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(container.querySelector('.jf-milestone-line__rule')).not.toBeNull();
  });

  it('draws the nodes in the given order and tones, placed by position', () => {
    const { container } = renderLine();
    const nodes = [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__node')];
    expect(nodes.map((n) => n.dataset.tone)).toEqual(['teal', 'violet', 'fuchsia', 'orange']);
    expect(nodes.map((n) => n.style.getPropertyValue('--jf-ml-pos'))).toEqual(
      NODES.map((n) => String(n.position)),
    );
    const dots = nodes.map((n) => n.querySelector('.jf-milestone-line__dot')?.className);
    expect(dots).toEqual([
      'jf-milestone-line__dot jf-milestone-line__dot--teal',
      'jf-milestone-line__dot jf-milestone-line__dot--violet',
      'jf-milestone-line__dot jf-milestone-line__dot--fuchsia',
      'jf-milestone-line__dot jf-milestone-line__dot--orange',
    ]);
    // Labels under the line: the words and the year · age.
    expect(nodes[1]?.textContent).toBe('FIRE2031 · 56');
    // The ends stay inside the line.
    expect(nodes.map((n) => n.dataset.anchor)).toEqual(['start', 'middle', 'middle', 'end']);
  });

  it('clamps positions to the line', () => {
    const { container } = render(
      <MilestoneLine
        ariaLabel="x"
        nodes={[
          { key: 'a', tone: 'teal', position: -0.5, label: 'A' },
          { key: 'b', tone: 'violet', position: 3, label: 'B' },
        ]}
      />,
    );
    const nodes = [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__node')];
    expect(nodes.map((n) => n.style.getPropertyValue('--jf-ml-pos'))).toEqual(['0', '1']);
  });

  it('writes each phase above the line between its nodes, in order for the vertical layout', () => {
    const { container } = renderLine();
    const segments = [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__segment')];
    expect(segments.map((s) => s.textContent)).toEqual(SEGMENTS.map((s) => s.label));
    // Vertical order interleaves node, phase, node, phase…
    const nodes = [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__node')];
    expect(nodes.map((n) => n.style.order)).toEqual(['0', '2', '4', '6']);
    expect(segments.map((s) => s.style.order)).toEqual(['1', '3', '5', '7']);
  });

  it('stacks the labels of nodes closer than 64 px on a second row', () => {
    expect(MILESTONE_LABEL_GAP).toBe(64);
    // At the assumed width, 1/6 of 640 px is 107 px: no stacking.
    expect(milestoneLabelRows([0, 1 / 6, 4 / 6, 5 / 6], MILESTONE_ASSUMED_WIDTH)).toEqual([
      0, 0, 0, 0,
    ]);
    // At 300 px, 0 and 50 px collide; 200 and 250 collide.
    expect(milestoneLabelRows([0, 1 / 6, 4 / 6, 5 / 6], 300)).toEqual([0, 1, 0, 1]);
    // Three close nodes: the third goes back to the first row once it clears it.
    expect(milestoneLabelRows([0, 0.05, 0.12], 1000)).toEqual([0, 1, 0]);
    const { container } = render(
      <MilestoneLine
        ariaLabel="x"
        nodes={[
          { key: 'a', tone: 'teal', position: 0, label: 'Today' },
          { key: 'b', tone: 'violet', position: 0.05, label: 'FIRE' },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__node')].map(
      (n) => n.dataset.row,
    );
    expect(rows).toEqual(['0', '1']);
    expect(container.querySelector('.jf-milestone-line__body--stacked')).not.toBeNull();
  });

  it('takes a forced orientation', () => {
    const { rerender } = renderLine({ orientation: 'vertical' });
    expect(screen.getByRole('group')).toHaveClass('jf-milestone-line--vertical');
    rerender(
      <MilestoneLine nodes={NODES} ariaLabel="Your FIRE milestones" orientation="horizontal" />,
    );
    expect(screen.getByRole('group')).toHaveClass('jf-milestone-line--horizontal');
  });

  it('reads as an ordered list with each phase that starts at a node', () => {
    renderLine();
    const list = within(screen.getByRole('group')).getByRole('list', { hidden: true });
    expect(list.tagName).toBe('OL');
    expect(list).toHaveClass('jf-visually-hidden');
    const items = within(list)
      .getAllByRole('listitem', { hidden: true })
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Today · 2030 · 55. Then: Saving',
      'FIRE · 2031 · 56. Then: Drawing down, topping up super',
      'Top-ups end · 2034 · 59. Then: Drawing down',
      'Access · 2035 · 60. Then: Living on super',
    ]);
  });
});

describe('MilestoneLine: segment words that do not fit (triage STYLE-7)', () => {
  const LONG = 'Drawing down, topping up super';
  const saved = (['scrollWidth', 'clientWidth'] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  });

  /** jsdom has no layout: the long segment's words are wider than its span, the others fit. */
  function mockWidths(): void {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent === LONG ? 240 : 40;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 80,
    });
  }

  const segmentsOf = (container: HTMLElement) =>
    new Map(
      [...container.querySelectorAll<HTMLElement>('.jf-milestone-line__segment')].map((s) => [
        s.textContent,
        s,
      ]),
    );

  it('hides a horizontal segment whose words overflow, and keeps the others', () => {
    mockWidths();
    const { container } = renderLine({ orientation: 'horizontal' });
    const segments = segmentsOf(container);
    expect(segments.get(LONG)).toHaveAttribute('data-fits', 'false');
    expect(segments.get('Saving')).not.toHaveAttribute('data-fits');
    expect(segments.get('Drawing down')).not.toHaveAttribute('data-fits');
    // The words stay in the DOM (measured again on resize) and in the hidden list.
    expect(segments.get(LONG)).toHaveTextContent(LONG);
    const list = within(screen.getByRole('group')).getByRole('list', { hidden: true });
    expect(list).toHaveTextContent(`Then: ${LONG}`);
  });

  it('leaves vertical segments alone', () => {
    mockWidths();
    const { container } = renderLine({ orientation: 'vertical' });
    for (const segment of segmentsOf(container).values()) {
      expect(segment).not.toHaveAttribute('data-fits');
    }
  });

  it('never clips a word: no ellipsis, a hidden segment is invisible whole', () => {
    const css = readFileSync(`${dirname}/milestone.css`, 'utf8');
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(
      /\.jf-milestone-line__segment\[data-fits='false'\] \{\s*visibility: hidden;/,
    );
  });
});

// Vitest blanks CSS (even `?raw`), so the stylesheet is read from disk (as tokens.test.ts does;
// this package has no Node types, hence the untyped dynamic import).
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { dirname } = import.meta as ImportMeta & { dirname: string };

describe('milestone.css', () => {
  const css = readFileSync(`${dirname}/milestone.css`, 'utf8');

  it('lives in the brand layer, with no glow (a data display)', () => {
    expect(css).toMatch(/@layer brand\s*\{/);
    expect(css).not.toMatch(/box-shadow|filter|radial-gradient|blur/);
  });

  it('turns vertical below 768 px of its own container', () => {
    expect(css).toMatch(/container:\s*jf-milestone \/ inline-size/);
    expect(css).toMatch(/@container jf-milestone \(max-width: 767\.98px\)/);
  });

  it('draws a 1 px hairline and colours the dots with the brand tokens', () => {
    expect(css).toMatch(/background: var\(--hairline\)/);
    for (const tone of ['teal', 'violet', 'fuchsia', 'orange']) {
      expect(css).toContain(`.jf-milestone-line__dot--${tone} {\n    background: var(--${tone});`);
    }
  });
});
