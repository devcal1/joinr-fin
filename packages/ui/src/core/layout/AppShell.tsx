import { Menu, X, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';
import { cx } from '../cx';
import { useMediaQuery } from '../hooks';
import { BREAKPOINTS } from '../tokens';
import { Icon } from './Icon';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export interface AppLinkProps {
  href: string;
  className?: string;
  'aria-current'?: 'page';
  onClick?: () => void;
  children: ReactNode;
}

export interface AppShellProps {
  /** The brand block (core never imports brand; the app passes `<BrandBlock/>`). */
  brand: ReactNode;
  nav: NavGroup[];
  /** Sidebar bottom, in muted text (e.g. the style guide). */
  secondaryNav?: NavItem[];
  activeHref: string;
  /** The running header's page name. */
  pageTitle: string;
  /** Data freshness under the page name, e.g. "Prices 14:32 · Snapshot Aug 2026". */
  freshness?: ReactNode;
  footer: { version: string; right?: ReactNode };
  /** Router link adapter. Default: a plain `<a>`. */
  linkComponent?: ComponentType<AppLinkProps>;
  /** Gallery demo: contained, with no fixed/sticky positioning, no 100vh and no landmarks. */
  embedded?: boolean;
  children: ReactNode;
}

const WIDE_QUERY = `(min-width: ${BREAKPOINTS.sidebar}px)`;

function DefaultLink({ href, children, ...rest }: AppLinkProps): JSX.Element {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function normalisePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

/** A label written in capitals (an acronym such as "FIRE"); uppercase is always letter-spaced (§2). */
function isAllCaps(label: string): boolean {
  return /[A-Z]/.test(label) && label === label.toUpperCase();
}

/**
 * The app frame (STYLE_GUIDE §4): spectrum rules top and bottom, the running header (brand left,
 * page name and freshness right), the sidebar nav (a drawer below 1024px) and the footer.
 */
export function AppShell({
  brand,
  nav,
  secondaryNav,
  activeHref,
  pageTitle,
  freshness,
  footer,
  linkComponent: LinkComponent = DefaultLink,
  embedded = false,
  children,
}: AppShellProps): JSX.Element {
  const uid = useId();
  const navId = `${uid}nav`;
  const mainId = embedded ? `${uid}main` : 'main';
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isWide = useMediaQuery(WIDE_QUERY);
  const current = normalisePath(activeHref);

  // The drawer belongs to the page it was opened on, so navigating closes it; it never shows
  // while the sidebar is on screen (≥ 1024px).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const drawerOpen = !isWide && openFor === current;

  const closeDrawer = useCallback(() => {
    setOpenFor(null);
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (drawerOpen) closeButtonRef.current?.focus();
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    if (!drawerOpen || embedded) return undefined;
    const root = document.documentElement;
    root.classList.add('jf-scroll-locked');
    return () => root.classList.remove('jf-scroll-locked');
  }, [drawerOpen, embedded]);

  const onNavigate = (): void => {
    if (drawerOpen) closeDrawer();
  };

  const renderItem = (item: NavItem): JSX.Element => {
    const active = normalisePath(item.href) === current;
    return (
      <li key={item.id}>
        <LinkComponent
          href={item.href}
          className="jf-shell__nav-link"
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
        >
          {item.icon ? <Icon icon={item.icon} size={20} className="jf-shell__nav-icon" /> : null}
          <span
            className={cx(
              'jf-shell__nav-text',
              isAllCaps(item.label) && 'jf-shell__nav-text--caps',
            )}
          >
            {item.label}
          </span>
        </LinkComponent>
      </li>
    );
  };

  const HeaderTag = embedded ? 'div' : 'header';
  const MainTag = embedded ? 'div' : 'main';
  const FooterTag = embedded ? 'div' : 'footer';
  const inert = drawerOpen || undefined;

  return (
    <div
      className={cx(
        'jf-shell',
        embedded && 'jf-shell--embedded',
        drawerOpen && 'jf-shell--nav-open',
      )}
    >
      {embedded ? null : (
        <a className="jf-skip-link" href={`#${mainId}`}>
          Skip to content
        </a>
      )}
      <div className="jf-shell__rule jf-shell__rule--top" aria-hidden="true" />

      <HeaderTag className={cx('jf-shell__header', !freshness && 'jf-shell__header--plain')}>
        <button
          ref={menuButtonRef}
          type="button"
          className="jf-shell__icon-button jf-shell__menu"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls={navId}
          onClick={() => (drawerOpen ? closeDrawer() : setOpenFor(current))}
        >
          <Icon icon={Menu} size={20} />
        </button>
        <div className="jf-shell__brand">{brand}</div>
        {pageTitle ? <p className="jf-shell__title">{pageTitle}</p> : null}
        {freshness ? <p className="jf-shell__freshness">{freshness}</p> : null}
      </HeaderTag>

      <div
        className="jf-shell__scrim"
        hidden={!drawerOpen}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <nav
        id={navId}
        className="jf-shell__nav"
        aria-label={embedded ? 'Example navigation' : 'Main'}
      >
        <div className="jf-shell__nav-head">
          <span className="jf-shell__nav-heading">Menu</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="jf-shell__icon-button"
            aria-label="Close navigation"
            onClick={closeDrawer}
          >
            <Icon icon={X} size={20} />
          </button>
        </div>
        {/* The body scrolls on its own: sticky beside the page at ≥ 1024px, inside the drawer below. */}
        <div className="jf-shell__nav-body">
          <div className="jf-shell__nav-groups">
            {nav.map((group) => {
              // A group holding one item of the same name (Settings) needs no label of its own;
              // a hairline above it keeps it from reading as part of the group before.
              const only = group.items.length === 1 ? group.items[0] : undefined;
              const showLabel = only?.label !== group.label;
              const labelId = `${uid}group-${group.id}`;
              return (
                <div
                  key={group.id}
                  className={cx('jf-shell__nav-group', !showLabel && 'jf-shell__nav-group--plain')}
                >
                  {showLabel ? (
                    <p id={labelId} className="jf-shell__nav-label">
                      {group.label}
                    </p>
                  ) : null}
                  <ul
                    className="jf-shell__nav-list"
                    aria-labelledby={showLabel ? labelId : undefined}
                    aria-label={showLabel ? undefined : group.label}
                  >
                    {group.items.map(renderItem)}
                  </ul>
                </div>
              );
            })}
          </div>
          {secondaryNav?.length ? (
            <ul className="jf-shell__nav-list jf-shell__nav-secondary">
              {secondaryNav.map(renderItem)}
            </ul>
          ) : null}
        </div>
      </nav>

      <MainTag
        id={mainId}
        className="jf-shell__main"
        tabIndex={embedded ? undefined : -1}
        inert={inert}
      >
        <div className="jf-shell__content">{children}</div>
      </MainTag>

      <FooterTag className="jf-shell__footer" inert={inert}>
        <div className="jf-shell__footer-row">
          <span>Joinr Finance v{footer.version}</span>
          {footer.right ? <span className="jf-shell__footer-right">{footer.right}</span> : null}
        </div>
        <div className="jf-shell__rule" aria-hidden="true" />
      </FooterTag>
    </div>
  );
}
