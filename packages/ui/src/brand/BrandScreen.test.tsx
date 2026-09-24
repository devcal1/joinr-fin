import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BRAND_SCREEN_TITLES,
  BRAND_SCREEN_VARIANTS,
  BrandScreen,
  type BrandScreenVariant,
} from './BrandScreen';

describe('BrandScreen', () => {
  it.each([
    ['loading', 'Loading'],
    ['empty', 'Nothing here yet'],
    ['error', 'Something went wrong'],
    ['login', 'Sign in'],
  ] as const)('%s defaults to the title "%s"', (variant, title) => {
    render(<BrandScreen variant={variant} />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(BRAND_SCREEN_TITLES[variant]).toBe(title);
  });

  it('lists the four variants', () => {
    expect(BRAND_SCREEN_VARIANTS).toEqual(['loading', 'empty', 'error', 'login']);
  });

  it('is the main landmark at full viewport, on the banner artwork, with the brand block', () => {
    render(<BrandScreen variant="empty" />);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('jf-brand-screen', 'jf-brand-screen--full', 'jf-brand-screen--empty');
    expect(main.querySelector('.jf-brand-hero-bg__art')).not.toBeNull();
    expect(within(main).getByRole('img', { name: 'joinr' })).toHaveAttribute('height', '48');
    expect(within(main).getByText('FINANCE')).toBeInTheDocument();
  });

  it('is a contained block with an h2 (or the given level) when not full viewport', () => {
    const { rerender } = render(<BrandScreen variant="empty" fullViewport={false} />);
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here yet' })).toBeInTheDocument();
    expect(document.querySelector('.jf-brand-screen')).toHaveClass('jf-brand-screen--embedded');
    expect(screen.getByRole('img', { name: 'joinr' })).toHaveAttribute('height', '24');
    rerender(<BrandScreen variant="empty" fullViewport={false} headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('announces loading as a status with its animated node loader', () => {
    render(<BrandScreen variant="loading" message="Getting ready." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading');
    expect(status).toHaveTextContent('Getting ready.');
    const loader = status.querySelector('.jf-brand-loader');
    expect(loader).toHaveAttribute('aria-hidden', 'true');
    expect(loader?.querySelectorAll('.jf-brand-loader__node')).toHaveLength(4);
  });

  it.each(['empty', 'error', 'login'] as BrandScreenVariant[])(
    '%s is not a live region and has no loader',
    (variant) => {
      const { container } = render(<BrandScreen variant={variant} />);
      expect(screen.queryByRole('status')).toBeNull();
      expect(container.querySelector('.jf-brand-loader')).toBeNull();
    },
  );

  it('renders the title, message, body and actions on the surface card', () => {
    render(
      <BrandScreen
        variant="login"
        title="Welcome back"
        message="Use your passphrase."
        actions={<button type="button">Continue</button>}
      >
        <p>Form goes here</p>
      </BrandScreen>,
    );
    const card = screen.getByRole('heading', { name: 'Welcome back' }).parentElement;
    expect(card).toHaveClass('jf-brand-screen__card');
    expect(card).toHaveTextContent('Use your passphrase.');
    expect(within(card as HTMLElement).getByText('Form goes here')).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByRole('button', { name: 'Continue' }),
    ).toBeInTheDocument();
  });
});
