import type { JSX, ReactNode } from 'react';
import { cx } from '../core';

export interface HeroBackgroundProps {
  /** Content drawn above the artwork. Text must sit on a `--surface` card, never on the glow. */
  children?: ReactNode;
  className?: string;
}

/**
 * The four banner nodes, left to right, in the fixed spectrum order (STYLE_GUIDE §7.1). Their x
 * positions (25 / 50 / 69 / 87.5%) live in brand.css, keyed by tone.
 */
export const HERO_NODE_TONES = ['teal', 'violet', 'fuchsia', 'orange'] as const;
export type HeroNodeTone = (typeof HERO_NODE_TONES)[number];

/**
 * The Joinr banner rebuilt in CSS (no raster): ground gradient, a dot grid fading at the edges, the
 * node line at ~39% height with faint vertical guides, four glowing nodes and a broad bottom glow.
 * The artwork is decorative (`aria-hidden`); children render above it. Set `--jf-hero-line-y` on
 * the element (or an ancestor) to move the node line (default 39%).
 */
export function HeroBackground({ children, className }: HeroBackgroundProps): JSX.Element {
  return (
    <div className={cx('jf-brand-hero-bg', className)}>
      <div className="jf-brand-hero-bg__art" aria-hidden="true">
        <div className="jf-brand-hero-bg__glow" data-layer="glow" />
        <div className="jf-brand-hero-bg__grid" data-layer="grid" />
        <div className="jf-brand-hero-bg__guides" data-layer="guides">
          {HERO_NODE_TONES.map((tone) => (
            <span
              key={tone}
              className={`jf-brand-hero-bg__guide jf-brand-hero-bg__guide--${tone}`}
            />
          ))}
          <span className="jf-brand-hero-bg__guide jf-brand-hero-bg__guide--minor-a" />
          <span className="jf-brand-hero-bg__guide jf-brand-hero-bg__guide--minor-b" />
        </div>
        <div className="jf-brand-hero-bg__line" data-layer="line" />
        <div className="jf-brand-hero-bg__nodes" data-layer="nodes">
          {HERO_NODE_TONES.map((tone) => (
            <span
              key={tone}
              className={`jf-brand-hero-bg__node jf-brand-hero-bg__node--${tone}`}
              data-node={tone}
            />
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
