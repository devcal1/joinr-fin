import type { JSX, ReactNode } from 'react';
import { cx } from '../core';
import { HeroBackground } from './HeroBackground';
import { Wordmark } from './Wordmark';

export interface HeroBandProps {
  /** KPI content (e.g. StatTiles, which sit on `--surface` cards). Laid out below the node line. */
  children?: ReactNode;
  /** Minimum height: compact 140px, regular 180px (default). The band grows to fit its content. */
  height?: 'compact' | 'regular';
  /** Show the wordmark bottom-right, as in the banner. Default false (the header already has it). */
  showWordmark?: boolean;
  /** Names the band as a region; without it the band is a plain container. */
  ariaLabel?: string;
  className?: string;
}

/**
 * The Net Worth hero (STYLE_GUIDE §7.2): the banner artwork as a 140–200px band, with the KPI cards
 * on top of it, below the node line.
 */
export function HeroBand({
  children,
  height = 'regular',
  showWordmark = false,
  ariaLabel,
  className,
}: HeroBandProps): JSX.Element {
  const hasContent = children !== undefined && children !== null && children !== false;
  const Tag = ariaLabel ? 'section' : 'div';
  return (
    <Tag
      className={cx(
        'jf-brand-hero',
        `jf-brand-hero--${height}`,
        hasContent && 'jf-brand-hero--has-content',
        className,
      )}
      aria-label={ariaLabel}
    >
      <HeroBackground className="jf-brand-hero__bg">
        <div className="jf-brand-hero__content">
          {hasContent ? <div className="jf-brand-hero__body">{children}</div> : null}
          {showWordmark ? (
            <Wordmark height={height === 'compact' ? 24 : 32} className="jf-brand-hero__mark" />
          ) : null}
        </div>
      </HeroBackground>
    </Tag>
  );
}
