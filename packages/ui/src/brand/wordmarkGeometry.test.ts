// The inline geometry must stay identical to the committed master SVG, and its path data must follow
// the stage-0 rules (absolute commands, ≤ 2 dp, no compact `.5.5` sequences that read like IPv4).
import { describe, expect, it } from 'vitest';
import masterSvg from '../../../../reference/brand/joinr_wordmark.svg?raw';
import {
  WORDMARK_ASPECT,
  WORDMARK_DOT,
  WORDMARK_DOT_GRADIENT,
  WORDMARK_GLYPHS,
  WORDMARK_METRICS,
  WORDMARK_VIEWBOX,
} from './wordmarkGeometry';

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

describe('wordmark geometry', () => {
  it('matches the master SVG viewBox', () => {
    const svgTag = /<svg[^>]*>/.exec(masterSvg)?.[0] ?? '';
    expect(attr(svgTag, 'viewBox')).toBe(
      `0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`,
    );
    expect(WORDMARK_ASPECT).toBeCloseTo(213.55 / 87.46, 10);
  });

  it('matches the master SVG letter paths, in order', () => {
    const paths = [...masterSvg.matchAll(/<path\s+d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toEqual(WORDMARK_GLYPHS.map((glyph) => glyph.d));
    expect(WORDMARK_GLYPHS.map((glyph) => glyph.id)).toEqual(['j', 'o', 'i', 'n', 'r']);
    expect(masterSvg).toMatch(/<g fill="#FFFFFF">/);
  });

  it('matches the master SVG full stop and its gradient', () => {
    const circle = /<circle[^>]*>/.exec(masterSvg)?.[0] ?? '';
    expect(Number(attr(circle, 'cx'))).toBe(WORDMARK_DOT.cx);
    expect(Number(attr(circle, 'cy'))).toBe(WORDMARK_DOT.cy);
    expect(Number(attr(circle, 'r'))).toBe(WORDMARK_DOT.r);
    const gradient = /<linearGradient[^>]*>/.exec(masterSvg)?.[0] ?? '';
    const g = WORDMARK_DOT_GRADIENT;
    expect([
      attr(gradient, 'x1'),
      attr(gradient, 'y1'),
      attr(gradient, 'x2'),
      attr(gradient, 'y2'),
    ]).toEqual([g.x1, g.y1, g.x2, g.y2].map(String));
    const stops = [...masterSvg.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual([g.from, g.to]);
  });

  it('holds the master to its rules: no raster, no fonts, no transforms', () => {
    expect(masterSvg).not.toMatch(/<image|<text|font-family|data:|transform=/);
  });

  it.each(WORDMARK_GLYPHS.map((glyph) => [glyph.id, glyph.d] as const))(
    'path %s uses absolute commands and short, space-separated numbers',
    (_id, d) => {
      expect(d).not.toMatch(/[a-y]/); // absolute commands only (lowercase = relative)
      expect(d).not.toMatch(/\d\.\d{3}/); // at most 2 decimal places
      expect(d).not.toMatch(/\.\d+\./); // no compact ".5.5" sequences
      expect(d).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // nothing that reads as IPv4
      const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
      for (const n of numbers) {
        const value = Number(n);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(WORDMARK_VIEWBOX.width);
      }
    },
  );

  it('places the letters between the x-height and the baseline', () => {
    expect(WORDMARK_METRICS.xHeightTop).toBeGreaterThan(0.2);
    expect(WORDMARK_METRICS.baseline).toBeGreaterThan(WORDMARK_METRICS.xHeightTop);
    expect(WORDMARK_METRICS.baseline).toBeLessThan(1);
    // The i stem runs exactly from the x-height to the baseline.
    const iStem = WORDMARK_GLYPHS.find((glyph) => glyph.id === 'i')?.d ?? '';
    expect(iStem).toContain('L111.86 71.35');
    expect(iStem).toContain('M94.73 23.93');
  });
});
