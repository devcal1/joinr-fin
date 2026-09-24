import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandBlock } from './BrandBlock';
import { WORDMARK_MIN_HEIGHT, Wordmark } from './Wordmark';
import { WORDMARK_ASPECT } from './wordmarkGeometry';

describe('Wordmark', () => {
  it('is an image named "joinr" by default', () => {
    render(<Wordmark />);
    const mark = screen.getByRole('img', { name: 'joinr' });
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark).toHaveClass('jf-brand-wordmark');
  });

  it('takes a custom accessible name and class', () => {
    render(<Wordmark title="Joinr home" className="extra" />);
    expect(screen.getByRole('img', { name: 'Joinr home' })).toHaveClass(
      'jf-brand-wordmark',
      'extra',
    );
  });

  it('draws five white letter paths and one gradient-filled circle, no raster or text', () => {
    const { container } = render(<Wordmark />);
    const svg = container.querySelector('svg');
    expect(svg?.querySelectorAll('g[fill="#FFFFFF"] > path')).toHaveLength(5);
    const circle = svg?.querySelector('circle');
    expect(circle?.getAttribute('fill')).toMatch(/^url\(#jf-wordmark-dot-[\w-]+\)$/);
    expect(svg?.querySelector('image, text, foreignObject')).toBeNull();
  });

  it('defaults to 32px tall and keeps the aspect ratio', () => {
    render(<Wordmark />);
    const mark = screen.getByRole('img', { name: 'joinr' });
    expect(mark).toHaveAttribute('height', '32');
    expect(Number(mark.getAttribute('width'))).toBeCloseTo(32 * WORDMARK_ASPECT, 1);
  });

  it('never renders below the 24px minimum', () => {
    render(<Wordmark height={10} />);
    expect(screen.getByRole('img', { name: 'joinr' })).toHaveAttribute(
      'height',
      String(WORDMARK_MIN_HEIGHT),
    );
  });

  it('gives every instance its own gradient and title ids', () => {
    const { container } = render(
      <>
        <Wordmark />
        <Wordmark />
      </>,
    );
    const gradients = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(gradients).toHaveLength(2);
    expect(new Set(gradients).size).toBe(2);
    container.querySelectorAll('svg').forEach((svg) => {
      const id = svg.querySelector('linearGradient')?.id ?? '';
      expect(id).toMatch(/^[A-Za-z][\w-]*$/);
      expect(svg.querySelector('circle')?.getAttribute('fill')).toBe(`url(#${id})`);
      const titleId = svg.getAttribute('aria-labelledby') ?? '';
      expect(svg.querySelector('title')?.id).toBe(titleId);
    });
  });
});

describe('BrandBlock', () => {
  it('shows the wordmark with the FINANCE label', () => {
    render(<BrandBlock />);
    expect(screen.getByRole('img', { name: 'joinr' })).toBeInTheDocument();
    const label = screen.getByText('FINANCE');
    expect(label).toHaveClass('jf-brand-block__label');
  });

  it.each([
    ['sm', 24],
    ['md', 32],
    ['lg', 48],
  ] as const)('size %s uses a %ipx wordmark', (size, height) => {
    const { container } = render(<BrandBlock size={size} />);
    expect(container.firstElementChild).toHaveClass('jf-brand-block', `jf-brand-block--${size}`);
    expect(screen.getByRole('img', { name: 'joinr' })).toHaveAttribute('height', String(height));
  });

  it('defaults to md and accepts a custom label', () => {
    const { container } = render(<BrandBlock label="Planner" className="x" />);
    expect(container.firstElementChild).toHaveClass('jf-brand-block--md', 'x');
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });
});
