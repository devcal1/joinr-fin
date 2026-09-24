import { describe, expect, it } from 'vitest';
import {
  compactMoneyFormatter,
  escapeHtml,
  formatChartNumber,
  moneyFormatter,
  percentFormatter,
} from './format';

const MINUS = '−';

describe('formatChartNumber', () => {
  it('groups en-AU, keeps up to 2 dp and uses U+2212', () => {
    expect(formatChartNumber(12480)).toBe('12,480');
    expect(formatChartNumber(1234.567)).toBe('1,234.57');
    expect(formatChartNumber(-1234)).toBe(`${MINUS}1,234`);
    expect(formatChartNumber(-0)).toBe('0');
    expect(formatChartNumber(Number.NaN)).toBe('—');
  });
});

describe('moneyFormatter', () => {
  it('formats dollars through formatMoney', () => {
    expect(moneyFormatter()(12480)).toBe('$12,480');
    expect(moneyFormatter({ cents: true })(12480)).toBe('$12,480.00');
    expect(moneyFormatter({ cents: true })(-1234)).toBe(`${MINUS}$1,234.00`);
    expect(moneyFormatter({ signDisplay: 'always' })(12)).toBe('+$12');
    expect(moneyFormatter()(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('rounds float dollars to whole cents first', () => {
    expect(moneyFormatter({ cents: true })(0.1 + 0.2)).toBe('$0.30');
  });
});

describe('compactMoneyFormatter', () => {
  it.each([
    [0, '$0'],
    [950, '$950'],
    [999.6, '$1k'],
    [1500, '$1.5k'],
    [12480, '$12.5k'],
    [120000, '$120k'],
    [999950, '$1M'],
    [1250000, '$1.25M'],
    [2_500_000_000, '$2.5B'],
    [-3000, `${MINUS}$3k`],
    [-0.2, '$0'],
  ])('%d → %s', (value, expected) => {
    expect(compactMoneyFormatter(value)).toBe(expected);
  });
});

describe('percentFormatter', () => {
  it('formats a ratio to one decimal with U+2212', () => {
    expect(percentFormatter(0.074)).toBe('7.4%');
    expect(percentFormatter(-0.021)).toBe(`${MINUS}2.1%`);
    expect(percentFormatter(Number.NaN)).toBe('—');
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<b class="x">'A' & B</b>`)).toBe(
      '&lt;b class=&quot;x&quot;&gt;&#39;A&#39; &amp; B&lt;/b&gt;',
    );
  });
});
