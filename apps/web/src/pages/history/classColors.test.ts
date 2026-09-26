// The class colours (stage-5.md §5, §7.7, D93): each class has its fixed CHART_PALETTE slot on every
// chart and the donut, and the validator maths (the dataviz method of ui's palette.test.ts: OKLab
// ΔE×100, normal vision and Machado 2009 protanopia/deuteranopia) holds on the stack order, on
// every order with one class empty, and on the eight-slice donut's ring (the wrap included), where
// the two documented near misses are held to their floors (CVD 7, normal 13.5).
import {
  NET_WORTH_CLASS_SLOTS,
  NET_WORTH_STACK_ORDER,
  type NetWorthStackClass,
} from '@joinr/schema';
import { CHART_OTHER, CHART_PALETTE } from '@joinr/ui';
import { describe, expect, it } from 'vitest';
import { OTHER_DEBTS_COLOR, TREND_COLOR, classColor } from './display';

type Rgb = [number, number, number];

const toLinear = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
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

/** The stack order, and every order with one class empty (it is not drawn). */
const ORDERS: NetWorthStackClass[][] = [
  [...NET_WORTH_STACK_ORDER],
  ...NET_WORTH_STACK_ORDER.map((gone) => NET_WORTH_STACK_ORDER.filter((k) => k !== gone)),
];

const neighbours = (
  list: readonly NetWorthStackClass[],
): [NetWorthStackClass, NetWorthStackClass][] =>
  list.slice(1).map((k, i) => [list[i] as NetWorthStackClass, k]);
const ring = (list: readonly NetWorthStackClass[]): [NetWorthStackClass, NetWorthStackClass][] =>
  list.map((k, i) => [k, list[(i + 1) % list.length] as NetWorthStackClass]);

/** The two one-empty ring pairs no arrangement of the eight slots avoids (§5, D93). */
const DOCUMENTED = new Set(['property|etf', 'etf|property', 'super|stock', 'stock|super']);

describe('class colours (NET_WORTH_CLASS_SLOTS)', () => {
  it('maps each drawable class to its palette slot, a bijection onto slots 1–8', () => {
    const colors = NET_WORTH_STACK_ORDER.map(classColor);
    expect(new Set(colors).size).toBe(8);
    for (const key of NET_WORTH_STACK_ORDER) {
      expect(classColor(key)).toBe(CHART_PALETTE[NET_WORTH_CLASS_SLOTS[key] - 1]);
    }
    expect(OTHER_DEBTS_COLOR).toBe(CHART_OTHER);
    expect(TREND_COLOR).toBe(CHART_OTHER);
  });

  it('separates every neighbour in the stack order, with any one class empty (CVD ≥ 10.4, normal ≥ 16.7)', () => {
    for (const order of ORDERS) {
      for (const [a, b] of neighbours(order)) {
        expect(cvdDelta(classColor(a), classColor(b)), `${a}↔${b}`).toBeGreaterThanOrEqual(10.4);
        expect(normalDelta(classColor(a), classColor(b)), `${a}↔${b}`).toBeGreaterThanOrEqual(16.7);
      }
    }
  });

  it('separates the grey "Other debts" from the property equity it sits next to', () => {
    expect(cvdDelta(CHART_OTHER, classColor('property'))).toBeGreaterThanOrEqual(8);
    expect(normalDelta(CHART_OTHER, classColor('property'))).toBeGreaterThanOrEqual(15);
  });

  it('the donut ring (the wrap included, any one class empty) meets the targets but for the two documented pairs, which keep their floors', () => {
    for (const order of ORDERS) {
      for (const [a, b] of ring(order)) {
        const cvd = cvdDelta(classColor(a), classColor(b));
        const normal = normalDelta(classColor(a), classColor(b));
        if (order.length === 7 && DOCUMENTED.has(`${a}|${b}`)) {
          expect(cvd, `${a}↔${b}`).toBeGreaterThanOrEqual(7);
          expect(normal, `${a}↔${b}`).toBeGreaterThanOrEqual(13.5);
        } else {
          expect(cvd, `${a}↔${b}`).toBeGreaterThanOrEqual(8);
          expect(normal, `${a}↔${b}`).toBeGreaterThanOrEqual(15);
        }
      }
    }
    // The full ring's wrap pair (Property equity next to Stocks) is well clear.
    expect(cvdDelta(classColor('property'), classColor('stock'))).toBeGreaterThanOrEqual(10.4);
  });
});
