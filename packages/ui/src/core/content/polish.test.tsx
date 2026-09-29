// Stage 6 core polish (web-polish-ui, stage-6.md §6.5, §6.9 D, E): KeyValueTable labels never split
// a word and stack below 480 px of the table's width (STYLE-6); every KV value is left-aligned with
// figures monospaced (STYLE-7); StatTile's footer slot. jsdom has no layout, so the stylesheets are
// loaded through the test harness (container widths simulated); the geometric checks (no overflow
// at 375 px, one left edge) are in e2e/polish.spec.ts.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installUiCss } from '../testing/cssHarness';
import { Amount } from './Amount';
import { KeyValueTable } from './KeyValueTable';
import { Meter } from './Meter';
import { StatTile } from './StatTile';

/** A long uppercase label of the kind the settings registry has (generic words). */
const LONG_LABEL = 'Super contributions a year from salary sacrifice';

let removeCss: () => void = () => undefined;
afterEach(() => {
  removeCss();
  removeCss = () => undefined;
});

function renderFacts(): HTMLElement {
  render(
    <KeyValueTable
      caption="Loan facts"
      items={[
        { label: 'Lender', value: 'Example Bank' },
        { label: 'Balance', value: <Amount cents={42_000_00} />, numeric: true },
        { label: 'Rate', value: <span className="jf-num">5.1%</span> },
        { label: LONG_LABEL, value: 'Monthly' },
      ]}
    />,
  );
  return screen.getByRole('table', { name: 'Loan facts' });
}

describe('KeyValueTable alignment (STYLE-7)', () => {
  it('left-aligns phrase and number values alike; figures stay monospaced', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const table = renderFacts();
    const cells = within(table).getAllByRole('cell');
    for (const cell of cells) {
      expect(getComputedStyle(cell).textAlign).toBe('left');
    }
    expect(getComputedStyle(table).textAlign).toBe('left');
    const figure = cells[1] as HTMLElement;
    expect(figure).toHaveClass('jf-kv__value--num');
    // Its rule is `inherit`, which resolves to the table's `left`.
    expect(getComputedStyle(figure).textAlign).toBe('left');
    expect(getComputedStyle(figure).fontFamily).toContain('var(--font-mono)');
    expect(getComputedStyle(figure).fontVariantNumeric).toBe('tabular-nums');
    // A `.jf-num` (right-aligned elsewhere) inside a value keeps the value's edge.
    const num = (cells[2] as HTMLElement).querySelector('.jf-num') as HTMLElement;
    expect(getComputedStyle(num).textAlign).toBe('left');
  });

  it('no value in the fixed rows is right-aligned', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const table = renderFacts();
    for (const cell of within(table).getAllByRole('cell')) {
      expect(getComputedStyle(cell).textAlign).not.toBe('right');
    }
  });
});

describe('KeyValueTable at narrow widths (STYLE-6)', () => {
  it('labels wrap between words only', () => {
    removeCss = installUiCss(['tokens', 'base', 'content'], { containerWidth: 900 });
    const table = renderFacts();
    const label = within(table).getByRole('rowheader', { name: LONG_LABEL });
    const style = getComputedStyle(label);
    expect(style.overflowWrap).toBe('normal');
    expect(style.wordBreak).toBe('normal');
    expect(style.hyphens).toBe('manual');
  });

  it('is a size container, so the stacking follows the table’s own width', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const table = renderFacts();
    const box = table.parentElement as HTMLElement;
    expect(box).toHaveClass('jf-kv');
    expect(getComputedStyle(box).getPropertyValue('container-type')).toBe('inline-size');
  });

  it('in a 343 px container each row stacks: the label strip above the value, both full width', () => {
    removeCss = installUiCss(['tokens', 'base', 'content'], { containerWidth: 343 });
    const table = renderFacts();
    expect(getComputedStyle(table).display).toBe('block');
    for (const row of within(table).getAllByRole('row')) {
      expect(getComputedStyle(row).display).toBe('block');
      const [label, value] = Array.from(row.children) as HTMLElement[];
      for (const cell of [label, value]) {
        expect(getComputedStyle(cell as HTMLElement).display).toBe('block');
        expect(getComputedStyle(cell as HTMLElement).width).toBe('100%');
      }
    }
    // Label first in the DOM, so it sits above its value.
    const row = within(table).getByRole('rowheader', { name: LONG_LABEL }).parentElement;
    expect(row?.firstElementChild).toHaveClass('jf-kv__label');
  });

  it('at 480 px and wider the two-column table stays', () => {
    removeCss = installUiCss(['tokens', 'base', 'content'], { containerWidth: 480 });
    const table = renderFacts();
    expect(getComputedStyle(table).display).not.toBe('block');
    // Both columns size to their content (owner 2026-09-29), not a fixed label share.
    expect(getComputedStyle(table).width).toBe('auto');
    expect(getComputedStyle(table).tableLayout).toBe('auto');
  });
});

describe('StatTile footer (§6.5)', () => {
  it('renders the footer under the hint, in the tile’s group', () => {
    render(
      <StatTile
        label="Super needed"
        value="$800,000"
        hint="You have $300,000"
        footer={
          <>
            <Meter label="Progress" valueCents={30_000_000} targetCents={80_000_000} />
            <p>Saved: $750,000</p>
          </>
        }
      />,
    );
    const group = screen.getByRole('group', { name: 'Super needed' });
    const hint = within(group).getByText('You have $300,000');
    const footer = group.querySelector('.jf-stat-tile__footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(hint.nextElementSibling).toBe(footer);
    expect(within(footer).getByText('Saved: $750,000')).toBeInTheDocument();
    expect(within(footer).getByRole('meter')).toBeInTheDocument();
    expect(group.lastElementChild).toBe(footer);
  });

  it('renders no footer element without one', () => {
    const { container } = render(<StatTile label="Net worth" value="$1" hint="Hint" />);
    expect(container.querySelector('.jf-stat-tile__footer')).toBeNull();
  });

  it('sits at the tile’s foot in muted small text', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const { container } = render(<StatTile label="Spend" value="$1" footer={<p>Saved: $2</p>} />);
    const footer = container.querySelector('.jf-stat-tile__footer') as HTMLElement;
    const style = getComputedStyle(footer);
    expect(style.marginTop).toBe('auto');
    expect(style.color).toBe('var(--text-muted)');
    expect(style.display).toBe('flex');
  });
});
