// Checks the ui test environment itself (Scaffolder): jsdom, JSX, jest-dom matchers and stubs.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandBlock, COLORS, PageHeader, formatMoney } from '../src';

describe('ui test environment', () => {
  it('renders JSX with jest-dom matchers', () => {
    render(<PageHeader title="Example" subtitle="Overview" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Example' })).toBeInTheDocument();
  });

  it('resolves image imports and the public barrel', () => {
    render(<BrandBlock />);
    expect(screen.getByRole('img', { name: 'joinr' })).toBeInTheDocument();
    expect(screen.getByText('FINANCE')).toBeInTheDocument();
    expect(COLORS.teal).toBe('#17C8A0');
    expect(formatMoney(1_248_000)).toBe('$12,480.00');
  });

  it('stubs browser APIs that jsdom lacks', () => {
    expect(typeof ResizeObserver).toBe('function');
    expect(window.matchMedia('(min-width: 1024px)').matches).toBe(false);
    expect(document.createElement('canvas').getContext('2d')).toBeNull();
  });
});
