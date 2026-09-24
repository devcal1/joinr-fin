import { render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Grid, GridItem } from './Grid';
import { Icon } from './Icon';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders an h1 with the teal sub-line and actions', () => {
    render(<PageHeader title="Stocks" subtitle="Investments" actions={<button>Add</button>} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Stocks' });
    expect(heading).toHaveClass('jf-page-header__title');
    expect(screen.getByText('Investments')).toHaveClass('jf-page-header__subtitle');
    expect(screen.getByRole('button', { name: 'Add' }).parentElement).toHaveClass(
      'jf-page-header__actions',
    );
  });

  it('omits the sub-line and actions when not given', () => {
    const { container } = render(<PageHeader title="Stocks" />);
    expect(container.querySelector('.jf-page-header__subtitle')).toBeNull();
    expect(container.querySelector('.jf-page-header__actions')).toBeNull();
  });

  it('can render an h2 for demos inside another page', () => {
    render(<PageHeader title="Demo" level={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Demo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('Grid', () => {
  it('maps desktop spans to classes with tablet defaults', () => {
    const { container } = render(
      <Grid className="extra">
        <GridItem>full</GridItem>
        <GridItem span={6}>half</GridItem>
        <GridItem span={4}>third</GridItem>
        <GridItem span={3}>quarter</GridItem>
        <GridItem span={2}>sixth</GridItem>
        <GridItem span={3} spanTablet={6}>
          custom
        </GridItem>
      </Grid>,
    );
    const grid = container.firstElementChild;
    expect(grid).toHaveClass('jf-grid', 'extra');
    const classes = [...(grid?.children ?? [])].map((child) => child.className);
    expect(classes).toEqual([
      'jf-grid__item jf-grid__item--12 jf-grid__item--t6',
      'jf-grid__item jf-grid__item--6 jf-grid__item--t3',
      'jf-grid__item jf-grid__item--4 jf-grid__item--t2',
      'jf-grid__item jf-grid__item--3 jf-grid__item--t3',
      'jf-grid__item jf-grid__item--2 jf-grid__item--t2',
      'jf-grid__item jf-grid__item--3 jf-grid__item--t6',
    ]);
  });
});

describe('Icon', () => {
  it('is decorative by default, 16px, stroke 1.75', () => {
    const { container } = render(<Icon icon={Wallet} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveClass('jf-icon');
  });

  it('becomes an image with a name when labelled', () => {
    render(<Icon icon={Wallet} size={20} label="Cash" className="x" />);
    const icon = screen.getByRole('img', { name: 'Cash' });
    expect(icon).toHaveAttribute('width', '20');
    expect(icon).not.toHaveAttribute('aria-hidden');
    expect(icon).toHaveClass('jf-icon', 'x');
  });
});
