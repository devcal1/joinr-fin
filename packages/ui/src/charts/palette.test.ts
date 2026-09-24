// Guards the validated palette (STYLE_GUIDE §6). The maths mirrors the dataviz validator:
// WCAG contrast, OKLCH lightness/chroma, and OKLab ΔE×100 under Machado 2009 (severity 1.0)
// protanopia/deuteranopia simulation. If a slot changes, these checks must still pass.
import { describe, expect, it } from 'vitest';
import { COLORS } from '../core';
import {
  CHART_GAIN,
  CHART_LOSS,
  CHART_OTHER,
  CHART_PALETTE,
  DONUT_MAX_SEGMENTS,
  isSafeColor,
  resolveSeriesColor,
  seriesColor,
  withAlpha,
} from './palette';

type Rgb = [number, number, number];

const toLinear = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
};
const luminance = (hex: string): number => {
  const [r, g, b] = toLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const oklab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;
const simulate = (hex: string, kind: keyof typeof MACHADO): Rgb => {
  const [r, g, b] = toLinear(hex);
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return MACHADO[kind].map(([x, y, z]) => clamp(x * r + y * g + z * b)) as Rgb;
};
const deltaE = (a: Rgb, b: Rgb): number => {
  const [p, q] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const normalDelta = (a: string, b: string): number => deltaE(toLinear(a), toLinear(b));
const cvdDelta = (a: string, b: string): number =>
  Math.min(
    deltaE(simulate(a, 'protan'), simulate(b, 'protan')),
    deltaE(simulate(a, 'deutan'), simulate(b, 'deutan')),
  );
const lightness = (hex: string): number => oklab(toLinear(hex))[0];
const chroma = (hex: string): number => {
  const [, a, b] = oklab(toLinear(hex));
  return Math.hypot(a, b);
};

const slots = [...CHART_PALETTE];
const pairs = (list: readonly string[]): [string, string][] =>
  list.slice(1).map((c, i) => [list[i] ?? '', c]);

describe('CHART_PALETTE (validated order)', () => {
  it('has eight distinct hex slots in the documented order', () => {
    expect(slots).toEqual([
      '#07AE8B',
      '#7744DD',
      '#EB6903',
      '#D946EF',
      '#C56703',
      '#B268FF',
      '#07B25A',
      '#007E68',
    ]);
    expect(new Set(slots).size).toBe(8);
    expect(Object.isFrozen(CHART_PALETTE)).toBe(true);
  });

  it('keeps every slot at 3:1 or better on --surface and --ink', () => {
    for (const c of slots) {
      expect(contrast(c, COLORS.surface), c).toBeGreaterThanOrEqual(3);
      expect(contrast(c, COLORS.ink), c).toBeGreaterThanOrEqual(3);
    }
  });

  it('sits in the dark-mode lightness band with enough chroma to read as a hue', () => {
    for (const c of slots) {
      expect(lightness(c), c).toBeGreaterThanOrEqual(0.48);
      expect(lightness(c), c).toBeLessThanOrEqual(0.67 + 0.0005);
      expect(chroma(c), c).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('separates every adjacent pair (CVD ΔE ≥ 8, normal vision ΔE ≥ 15)', () => {
    for (const [a, b] of pairs(slots)) {
      expect(cvdDelta(a, b), `${a}↔${b}`).toBeGreaterThanOrEqual(8);
      expect(normalDelta(a, b), `${a}↔${b}`).toBeGreaterThanOrEqual(15);
    }
  });

  it('separates the donut wrap pair (slot n next to slot 1) for 3..6 slices', () => {
    const first = slots[0] ?? '';
    for (let n = 3; n <= DONUT_MAX_SEGMENTS; n++) {
      const last = slots[n - 1] ?? '';
      expect(cvdDelta(first, last), `slot ${n}`).toBeGreaterThanOrEqual(8);
      expect(normalDelta(first, last), `slot ${n}`).toBeGreaterThanOrEqual(15);
    }
  });

  it('keeps the first three slots apart as all pairs (lines that cross)', () => {
    const three = slots.slice(0, 3);
    for (let i = 0; i < three.length; i++) {
      for (let j = i + 1; j < three.length; j++) {
        expect(cvdDelta(three[i] ?? '', three[j] ?? '')).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('uses status colours only for gain/loss and muted grey for Other', () => {
    expect(CHART_GAIN).toBe(COLORS.go);
    expect(CHART_LOSS).toBe(COLORS.stop);
    expect(CHART_OTHER).toBe(COLORS.textMuted);
    expect(slots).not.toContain(CHART_GAIN);
    expect(slots).not.toContain(CHART_LOSS);
    expect(contrast(CHART_OTHER, COLORS.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('seriesColor', () => {
  it('assigns slots in order and never cycles past the eighth', () => {
    expect(seriesColor(0)).toBe(CHART_PALETTE[0]);
    expect(seriesColor(7)).toBe(CHART_PALETTE[7]);
    expect(seriesColor(8)).toBe(CHART_OTHER);
    expect(seriesColor(20)).toBe(CHART_OTHER);
  });

  it('accepts only hex or rgb overrides', () => {
    expect(resolveSeriesColor(1, '#123456')).toBe('#123456');
    expect(resolveSeriesColor(1, 'rgba(1, 2, 3, 0.5)')).toBe('rgba(1, 2, 3, 0.5)');
    expect(resolveSeriesColor(1, 'red;background:url(x)')).toBe(CHART_PALETTE[1]);
    expect(isSafeColor('"><script>')).toBe(false);
  });
});

describe('withAlpha', () => {
  it('converts #RRGGBB to rgba', () => {
    expect(withAlpha('#07AE8B', 0.16)).toBe('rgba(7, 174, 139, 0.16)');
    expect(withAlpha('transparent', 0.5)).toBe('transparent');
  });
});
