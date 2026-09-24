import type { JSX, ReactNode } from 'react';
import { cx } from '../core';
import { BrandBlock } from './BrandBlock';
import { HERO_NODE_TONES, HeroBackground } from './HeroBackground';

export type BrandScreenVariant = 'loading' | 'empty' | 'error' | 'login';

export interface BrandScreenProps {
  variant: BrandScreenVariant;
  /** Defaults per variant: Loading · Nothing here yet · Something went wrong · Sign in. */
  title?: string;
  message?: ReactNode;
  /** Buttons or links, below the message. */
  actions?: ReactNode;
  /** Extra content inside the card (e.g. a sign-in form), between the message and the actions. */
  children?: ReactNode;
  /**
   * true (default): a full-viewport page (100dvh) rendered as the `main` landmark with an h1.
   * false: a contained block (min 360px tall) for previews and in-page empty states.
   */
  fullViewport?: boolean;
  /** Heading level; default 1 when full-viewport, otherwise 2. */
  headingLevel?: 1 | 2 | 3;
}

export const BRAND_SCREEN_VARIANTS = ['loading', 'empty', 'error', 'login'] as const;

export const BRAND_SCREEN_TITLES: Readonly<Record<BrandScreenVariant, string>> = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
  login: 'Sign in',
};

/** Four spectrum nodes on a hairline, pulsing in order; static under reduced motion. */
function NodeLoader(): JSX.Element {
  return (
    <span className="jf-brand-loader" aria-hidden="true">
      <span className="jf-brand-loader__line" />
      {HERO_NODE_TONES.map((tone) => (
        <span key={tone} className={`jf-brand-loader__node jf-brand-loader__node--${tone}`} />
      ))}
    </span>
  );
}

/**
 * Loading, empty, error and sign-in screens on the banner artwork (STYLE_GUIDE §7.2). The copy sits
 * on a `--surface` card below the node line, never on the glow; the brand block sits bottom-right.
 * The loading card is a `status` live region.
 */
export function BrandScreen({
  variant,
  title,
  message,
  actions,
  children,
  fullViewport = true,
  headingLevel,
}: BrandScreenProps): JSX.Element {
  const Root = fullViewport ? 'main' : 'div';
  const level = headingLevel ?? (fullViewport ? 1 : 2);
  const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  const isLoading = variant === 'loading';
  return (
    <Root
      className={cx(
        'jf-brand-screen',
        `jf-brand-screen--${variant}`,
        fullViewport ? 'jf-brand-screen--full' : 'jf-brand-screen--embedded',
      )}
      data-variant={variant}
    >
      <HeroBackground className="jf-brand-screen__bg">
        <div className="jf-brand-screen__layout">
          <div className="jf-brand-screen__card" role={isLoading ? 'status' : undefined}>
            {isLoading ? <NodeLoader /> : null}
            <Heading className="jf-brand-screen__title">
              {title ?? BRAND_SCREEN_TITLES[variant]}
            </Heading>
            {message ? <div className="jf-brand-screen__message">{message}</div> : null}
            {children ? <div className="jf-brand-screen__body">{children}</div> : null}
            {actions ? <div className="jf-brand-screen__actions">{actions}</div> : null}
          </div>
          <div className="jf-brand-screen__foot">
            <BrandBlock size={fullViewport ? 'lg' : 'sm'} />
          </div>
        </div>
      </HeroBackground>
    </Root>
  );
}
