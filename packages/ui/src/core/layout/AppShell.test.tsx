import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Coins, Palette, Wallet } from 'lucide-react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type AppLinkProps, type AppShellProps, type NavGroup } from './AppShell';

const NAV: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'home', label: 'Home', href: '/', icon: Wallet },
      { id: 'history', label: 'History', href: '/history', icon: Coins },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ id: 'settings', label: 'Settings', href: '/settings' }],
  },
];

function renderShell(props: Partial<AppShellProps> = {}) {
  return render(
    <AppShell
      brand={<span>Brand</span>}
      nav={NAV}
      secondaryNav={[{ id: 'guide', label: 'Style guide', href: '/styleguide', icon: Palette }]}
      activeHref="/history"
      pageTitle="History"
      freshness="No prices yet"
      footer={{ version: '1.2.3', right: 'Last snapshot —' }}
      {...props}
    >
      <p>Page body</p>
    </AppShell>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove('jf-scroll-locked');
});

describe('AppShell landmarks and furniture', () => {
  it('renders header, nav, main and footer landmarks with a skip link', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveTextContent('Page body');
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Joinr Finance v1.2.3');
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Last snapshot —');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  });

  it('shows the page name and freshness in the running header, and no ABN line', () => {
    renderShell();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('History')).toHaveClass('jf-shell__title');
    expect(within(header).getByText('No prices yet')).toHaveClass('jf-shell__freshness');
    expect(document.body).not.toHaveTextContent(/ABN/);
  });

  it('draws the spectrum rule at the top and at the bottom of the footer', () => {
    const { container } = renderShell();
    const rules = container.querySelectorAll('.jf-shell__rule');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toHaveClass('jf-shell__rule--top');
    expect(screen.getByRole('contentinfo').lastElementChild).toHaveClass('jf-shell__rule');
  });
});

describe('AppShell nav', () => {
  it('marks only the active item with aria-current', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const current = within(nav).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('History');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('matches the active item with or without a trailing slash', () => {
    renderShell({ activeHref: '/history/' });
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('History');
  });

  it('labels the lists by group, skipping a label that repeats a single item', () => {
    renderShell();
    expect(screen.getByRole('list', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Overview')).toHaveClass('jf-shell__nav-label');
    // "Settings" group holds one "Settings" item: no visible label, still a named list.
    expect(screen.getByRole('list', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByText('Settings')).toHaveLength(1);
    // The unlabelled group is set off by a hairline instead.
    const plain = screen.getByRole('list', { name: 'Settings' }).parentElement;
    expect(plain).toHaveClass('jf-shell__nav-group--plain');
    const labelled = screen.getByRole('list', { name: 'Overview' }).parentElement;
    expect(labelled).not.toHaveClass('jf-shell__nav-group--plain');
  });

  it('letter-spaces a label written in capitals (e.g. FIRE), and only that', () => {
    renderShell({
      nav: [
        {
          id: 'planning',
          label: 'Planning',
          items: [
            { id: 'fire', label: 'FIRE', href: '/fire' },
            { id: 'etfs', label: 'ETFs', href: '/etfs' },
          ],
        },
      ],
    });
    expect(screen.getByText('FIRE')).toHaveClass('jf-shell__nav-text--caps');
    expect(screen.getByText('ETFs')).not.toHaveClass('jf-shell__nav-text--caps');
  });

  it('wraps the groups and the secondary nav in one scrolling body', () => {
    const { container } = renderShell();
    const body = container.querySelector('.jf-shell__nav-body');
    expect(body?.parentElement).toHaveRole('navigation');
    expect(body?.querySelector('.jf-shell__nav-groups')).not.toBeNull();
    expect(body?.lastElementChild).toHaveClass('jf-shell__nav-secondary');
  });

  it('renders nav icons at 20px, decorative', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Home' });
    const svg = link.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('puts the secondary nav at the bottom of the sidebar', () => {
    renderShell();
    const guide = screen.getByRole('link', { name: 'Style guide' });
    expect(guide.closest('ul')).toHaveClass('jf-shell__nav-secondary');
  });

  it('uses the supplied link component', () => {
    function TestLink({ href, children, ...rest }: AppLinkProps): JSX.Element {
      return (
        <a href={href} data-router="yes" {...rest}>
          {children}
        </a>
      );
    }
    renderShell({ linkComponent: TestLink });
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('data-router', 'yes');
  });
});

describe('AppShell drawer (below 1024px; jsdom matches no media query)', () => {
  it('opens from the menu button and moves focus into the drawer', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', screen.getByRole('navigation').id);

    await user.click(menu);

    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(container.firstChild).toHaveClass('jf-shell--nav-open');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    expect(document.documentElement).toHaveClass('jf-scroll-locked');
    // The page behind the drawer is inert.
    expect(container.querySelector('main')).toHaveAttribute('inert');
    expect(container.querySelector('footer')).toHaveAttribute('inert');
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menu);
    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
    expect(document.documentElement).not.toHaveClass('jf-scroll-locked');
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  });

  it('closes on a click outside (the scrim)', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menu);
    const scrim = container.querySelector('.jf-shell__scrim');
    expect(scrim).not.toHaveAttribute('hidden');
    await user.click(scrim as Element);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(scrim).toHaveAttribute('hidden');
    expect(menu).toHaveFocus();
  });

  it('closes with the close button', async () => {
    const user = userEvent.setup();
    renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menu);
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });

  it('closes when a nav link is followed, and when the route changes', async () => {
    const user = userEvent.setup();
    function Harness(): JSX.Element {
      const [href, setHref] = useState('/history');
      function Link({ href: to, children, onClick, ...rest }: AppLinkProps): JSX.Element {
        return (
          <a
            href={to}
            {...rest}
            onClick={(event) => {
              event.preventDefault();
              onClick?.();
              setHref(to);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <AppShell
          brand="Brand"
          nav={NAV}
          activeHref={href}
          pageTitle="Page"
          footer={{ version: '1' }}
          linkComponent={Link}
        >
          <button type="button" onClick={() => setHref('/settings')}>
            Go elsewhere
          </button>
        </AppShell>
      );
    }
    render(<Harness />);
    const menu = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(menu);
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Home');

    // A route change from elsewhere (e.g. history back) also closes the drawer.
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const goElsewhere = screen.getByRole('button', { name: 'Go elsewhere', hidden: true });
    act(() => goElsewhere.click());
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays closed while the sidebar is on screen (≥ 1024px)', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    try {
      renderShell();
      const menu = screen.getByRole('button', { name: 'Open navigation' });
      await user.click(menu);
      expect(menu).toHaveAttribute('aria-expanded', 'false');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('AppShell embedded', () => {
  it('renders no landmarks, skip link or fixed furniture', () => {
    const { container } = renderShell({ embedded: true });
    expect(container.firstChild).toHaveClass('jf-shell--embedded');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Skip to content' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Example navigation' })).toBeInTheDocument();
    expect(container.querySelector('#main')).toBeNull();
  });

  it('does not lock the page scroll when its drawer opens', async () => {
    const user = userEvent.setup();
    renderShell({ embedded: true });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(document.documentElement).not.toHaveClass('jf-scroll-locked');
  });
});
