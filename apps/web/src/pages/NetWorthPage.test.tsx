import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NetWorthPage } from './NetWorthPage';

describe('NetWorthPage', () => {
  it('has the page title and group sub-line', () => {
    render(<NetWorthPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Net worth' })).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('shows four sample KPI tiles on the hero band', () => {
    render(<NetWorthPage />);
    const hero = screen.getByRole('region', { name: 'Net worth summary (sample figures)' });
    expect(hero).toHaveClass('jf-brand-hero');
    expect(within(hero).getAllByRole('group')).toHaveLength(4);
    const byLabel = (name: string): HTMLElement => within(hero).getByRole('group', { name });
    expect(byLabel('Net worth')).toHaveTextContent('$12,480');
    expect(byLabel('Change')).toHaveTextContent('+$1,240');
    expect(byLabel('Change')).toHaveTextContent('+11.0%');
    expect(byLabel('Savings rate')).toHaveTextContent('7.4%');
    expect(byLabel('Last snapshot')).toHaveTextContent('Aug 2026');
  });

  it('makes net worth the single key figure', () => {
    const { container } = render(<NetWorthPage />);
    const keyTiles = container.querySelectorAll('.jf-stat-tile--key');
    expect(keyTiles).toHaveLength(1);
    expect(keyTiles[0]).toHaveTextContent('Net worth');
  });

  it('says plainly that the figures are samples', () => {
    render(<NetWorthPage />);
    expect(
      screen.getByText('Sample figures. The live dashboard arrives in Stage 5.'),
    ).toBeInTheDocument();
  });
});
