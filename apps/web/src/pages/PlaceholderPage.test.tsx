import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAGES, STAGE_TITLES, type PageDef } from '../pages';
import { PlaceholderPage } from './PlaceholderPage';

const stocks = PAGES.find((page) => page.id === 'stocks') as PageDef;

describe('PlaceholderPage', () => {
  it('shows the page title as the h1 with its nav group as the sub-line', () => {
    render(<PlaceholderPage page={stocks} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Stocks' })).toBeInTheDocument();
    expect(screen.getByText('Investments')).toHaveClass('jf-page-header__subtitle');
  });

  it('says which stage delivers the page, in a note callout', () => {
    render(<PlaceholderPage page={stocks} />);
    const note = screen.getByRole('note', { name: 'Note' });
    expect(note).toHaveClass('jf-callout--note');
    expect(note).toHaveTextContent(`Stocks arrives in Stage 2 — ${STAGE_TITLES[2]}.`);
  });

  it('works for every placeholder page', () => {
    for (const page of PAGES) {
      const { unmount } = render(<PlaceholderPage page={page} />);
      expect(screen.getByRole('heading', { level: 1, name: page.title })).toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent(`arrives in Stage ${page.stage}`);
      unmount();
    }
  });

  it('copes with a stage that has no title', () => {
    render(<PlaceholderPage page={{ ...stocks, stage: 99 }} />);
    expect(screen.getByRole('note')).toHaveTextContent('Stocks arrives in Stage 99.');
  });
});
