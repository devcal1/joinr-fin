// Skeleton (web-polish-ui, stage-6.md §6.9 A): first-load placeholders, hidden from assistive
// technology, pulsing on --surface blocks except under prefers-reduced-motion.
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installUiCss, keyframeNames } from '../testing/cssHarness';
import { Skeleton, type SkeletonVariant } from './Skeleton';

const VARIANTS: SkeletonVariant[] = ['text', 'tile', 'card', 'table', 'chart'];

let removeCss: () => void = () => undefined;
afterEach(() => {
  removeCss();
  removeCss = () => undefined;
});

function block(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.jf-skeleton');
  if (!element) throw new Error('no skeleton rendered');
  return element;
}

describe('Skeleton', () => {
  it.each(VARIANTS)('%s: one aria-hidden block with its variant class and no text', (variant) => {
    const { container } = render(<Skeleton variant={variant} className="extra" />);
    const element = block(container);
    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element).toHaveClass('jf-skeleton', `jf-skeleton--${variant}`, 'extra');
    expect(element).toHaveAttribute('data-variant', variant);
    expect(element.textContent).toBe('');
    expect(element.querySelectorAll('[role], [tabindex], a, button')).toHaveLength(0);
  });

  it('text: three lines by default, `lines` of them otherwise, the last one shorter', () => {
    const { container, rerender } = render(<Skeleton variant="text" />);
    expect(block(container).querySelectorAll('.jf-skeleton__bar')).toHaveLength(3);
    rerender(<Skeleton variant="text" lines={5} />);
    const bars = block(container).querySelectorAll<HTMLElement>('.jf-skeleton__bar');
    expect(bars).toHaveLength(5);
    expect(bars[4]?.style.getPropertyValue('--jf-skeleton-w')).toBe('60%');
    rerender(<Skeleton variant="text" lines={0} />);
    expect(block(container).querySelectorAll('.jf-skeleton__bar')).toHaveLength(1);
    rerender(<Skeleton variant="text" lines={Number.NaN} />);
    expect(block(container).querySelectorAll('.jf-skeleton__bar')).toHaveLength(1);
  });

  it('table: a header bar and five rows by default, `lines` rows otherwise', () => {
    const { container, rerender } = render(<Skeleton variant="table" />);
    expect(block(container).querySelectorAll('.jf-skeleton__head')).toHaveLength(1);
    expect(block(container).querySelectorAll('.jf-skeleton__row')).toHaveLength(5);
    rerender(<Skeleton variant="table" lines={2} />);
    expect(block(container).querySelectorAll('.jf-skeleton__row')).toHaveLength(2);
  });

  it('tile: a label bar and a figure bar; chart: a title bar and the plot', () => {
    const { container, rerender } = render(<Skeleton variant="tile" />);
    expect(block(container).querySelector('.jf-skeleton__label')).not.toBeNull();
    expect(block(container).querySelector('.jf-skeleton__figure')).not.toBeNull();
    rerender(<Skeleton variant="chart" />);
    expect(block(container).querySelector('.jf-skeleton__title')).not.toBeNull();
    expect(block(container).querySelector('.jf-skeleton__plot')).not.toBeNull();
  });

  it('height sets the block height variable; a missing or invalid height leaves the default', () => {
    const { container, rerender } = render(<Skeleton variant="chart" height={200} />);
    expect(block(container).style.getPropertyValue('--jf-skeleton-h')).toBe('200px');
    rerender(<Skeleton variant="chart" height={-1} />);
    expect(block(container).style.getPropertyValue('--jf-skeleton-h')).toBe('');
    rerender(<Skeleton variant="card" />);
    expect(block(container).style.getPropertyValue('--jf-skeleton-h')).toBe('');
  });
});

describe('Skeleton styles', () => {
  it('pulses its opacity every 1.2 s on --surface blocks', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const { container } = render(
      <>
        <Skeleton variant="tile" />
        <Skeleton variant="text" />
      </>,
    );
    const [tile, text] = Array.from(container.querySelectorAll<HTMLElement>('.jf-skeleton'));
    const style = getComputedStyle(tile as HTMLElement);
    expect(style.animation).toContain('jf-skeleton-pulse');
    expect(style.animation).toContain('1.2s');
    expect(style.background).toContain('var(--surface)');
    const bar = text?.querySelector<HTMLElement>('.jf-skeleton__bar');
    expect(getComputedStyle(bar as HTMLElement).background).toContain('var(--surface)');
    expect(keyframeNames(['content'])).toContain('jf-skeleton-pulse');
  });

  it('does not animate under prefers-reduced-motion', () => {
    removeCss = installUiCss(['tokens', 'base', 'content'], { reducedMotion: true });
    const { container } = render(<Skeleton variant="card" />);
    const style = getComputedStyle(block(container));
    expect(style.animation).toBe('none');
  });

  it('steps a text skeleton up to --raised inside a card', () => {
    removeCss = installUiCss(['tokens', 'base', 'content']);
    const { container } = render(
      <div className="jf-card">
        <Skeleton variant="text" lines={1} />
      </div>,
    );
    const bar = container.querySelector<HTMLElement>('.jf-skeleton__bar');
    expect(getComputedStyle(bar as HTMLElement).background).toContain('var(--raised)');
  });
});
