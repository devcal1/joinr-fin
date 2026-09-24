import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroBand } from './HeroBand';
import { HERO_NODE_TONES, HeroBackground } from './HeroBackground';

describe('HeroBackground', () => {
  it('draws every banner layer inside a decorative, hidden artwork', () => {
    const { container } = render(<HeroBackground />);
    const art = container.querySelector('.jf-brand-hero-bg__art');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    const layers = [...(art?.querySelectorAll('[data-layer]') ?? [])].map((el) =>
      el.getAttribute('data-layer'),
    );
    expect(layers).toEqual(['glow', 'grid', 'guides', 'line', 'nodes']);
  });

  it('places the four nodes in the fixed spectrum order', () => {
    const { container } = render(<HeroBackground />);
    const nodes = [...container.querySelectorAll('[data-node]')].map((el) =>
      el.getAttribute('data-node'),
    );
    expect(nodes).toEqual(['teal', 'violet', 'fuchsia', 'orange']);
    expect(HERO_NODE_TONES).toEqual(nodes);
    expect(container.querySelectorAll('.jf-brand-hero-bg__guide')).toHaveLength(6);
  });

  it('renders children above the artwork', () => {
    render(
      <HeroBackground className="custom">
        <p>On top</p>
      </HeroBackground>,
    );
    const child = screen.getByText('On top');
    expect(child.parentElement).toHaveClass('jf-brand-hero-bg', 'custom');
  });
});

describe('HeroBand', () => {
  it('is a named region when given a label, holding its content', () => {
    render(
      <HeroBand ariaLabel="Summary">
        <p>KPI</p>
      </HeroBand>,
    );
    const region = screen.getByRole('region', { name: 'Summary' });
    expect(region).toHaveClass(
      'jf-brand-hero',
      'jf-brand-hero--regular',
      'jf-brand-hero--has-content',
    );
    expect(region).toContainElement(screen.getByText('KPI'));
    expect(region.querySelector('.jf-brand-hero-bg__art')).not.toBeNull();
  });

  it('is a plain container without a label, and hides the wordmark by default', () => {
    const { container } = render(<HeroBand />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild).not.toHaveClass('jf-brand-hero--has-content');
  });

  it('shows the wordmark on request, smaller when compact', () => {
    const { rerender } = render(<HeroBand showWordmark />);
    expect(screen.getByRole('img', { name: 'joinr' })).toHaveAttribute('height', '32');
    rerender(<HeroBand showWordmark height="compact" />);
    expect(screen.getByRole('img', { name: 'joinr' })).toHaveAttribute('height', '24');
    expect(document.querySelector('.jf-brand-hero')).toHaveClass('jf-brand-hero--compact');
  });

  it('treats false and null children as no content', () => {
    const { container } = render(<HeroBand>{false}</HeroBand>);
    expect(container.querySelector('.jf-brand-hero__body')).toBeNull();
  });
});
