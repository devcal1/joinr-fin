import { describe, expect, it } from 'vitest';
import {
  CAP_STATUS_BADGES,
  MARKERS,
  annualisedHidden,
  compoundingLabel,
  compoundingWords,
  durationText,
  fxLine,
  fxQuoteCurrency,
  formatRate,
  interestRateText,
  isUrlName,
  payoffMissingText,
  payoffText,
  quotedFxRate,
  repaymentText,
  shortName,
  storedFxRate,
  unitCostText,
  unitsText,
  wholeMonthsBetween,
} from './display';

describe('formatRate (UX-15): up to 2 dp, trailing zeros dropped', () => {
  it.each([
    ['0.0589', '5.89%'],
    ['0.12', '12%'],
    ['0.15', '15%'],
    ['0.115', '11.5%'],
    ['0.3', '30%'],
    ['0.06', '6%'],
    ['0.065', '6.5%'],
    ['0', '0%'],
  ])('%s → %s', (ratio, text) => {
    expect(formatRate(ratio)).toBe(text);
  });

  it('null and a non-number give null', () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate('abc')).toBeNull();
  });
});

describe('status markers (§6.1 UX-12): defined once', () => {
  it('Assumed and Estimate are pending badges; Statement is recorded; No price yet is an n/a pill', () => {
    expect(MARKERS.assumed).toEqual({ kind: 'badge', status: 'pending', label: 'Assumed' });
    expect(MARKERS.estimate).toEqual({ kind: 'badge', status: 'pending', label: 'Estimate' });
    expect(MARKERS.statement).toEqual({ kind: 'badge', status: 'recorded', label: 'Statement' });
    expect(MARKERS.noPriceYet).toEqual({ kind: 'pill', tone: 'na', label: 'No price yet' });
    expect(MARKERS.check).toMatchObject({ status: 'check', label: 'Check' });
    expect(MARKERS.loanStart).toMatchObject({ kind: 'pill', label: 'Loan start' });
  });

  it('never a "Manual" marker', () => {
    expect(Object.values(MARKERS).map((m) => m.label)).not.toContain('Manual');
  });

  it('cap statuses: Under / Near / Over with go / check / stop', () => {
    expect(CAP_STATUS_BADGES.under).toMatchObject({ status: 'go', label: 'Under' });
    expect(CAP_STATUS_BADGES.near).toMatchObject({ status: 'check', label: 'Near' });
    expect(CAP_STATUS_BADGES.over).toMatchObject({ status: 'stop', label: 'Over' });
  });
});

describe('frequencies and loan words', () => {
  it('compounding choices and a stored other value', () => {
    expect(compoundingLabel(12)).toBe('Monthly');
    expect(compoundingLabel(26)).toBe('Fortnightly');
    expect(compoundingLabel(52)).toBe('Weekly');
    expect(compoundingLabel(365)).toBe('Daily');
    expect(compoundingLabel(4)).toBe('4 times a year');
    expect(compoundingWords(12)).toBe('compounding monthly');
    expect(compoundingWords(4)).toBe('compounding 4 times a year');
  });

  it('the interest rate and repayment in words', () => {
    expect(interestRateText('0.06', 12)).toBe('6% a year, compounding monthly');
    expect(interestRateText('0.0589', null)).toBe('5.89% a year');
    expect(interestRateText(null, 12)).toBeNull();
    expect(repaymentText(280000, 'fortnightly')).toBe('$2,800.00 fortnightly');
    expect(repaymentText(null, 'monthly')).toBeNull();
  });

  it('payoff text and whole months (DATEDIF "M")', () => {
    expect(wholeMonthsBetween('2026-09-24', '2051-03-24')).toBe(294);
    expect(wholeMonthsBetween('2026-09-24', '2051-03-23')).toBe(293);
    expect(durationText(294)).toBe('24 years 6 months');
    expect(durationText(12)).toBe('1 year');
    expect(durationText(5)).toBe('5 months');
    expect(payoffText('2051-03-24', '2026-09-24')).toEqual({
      month: 'Mar 2051',
      inText: 'In 24 years 6 months',
    });
  });

  it('the reason a loan has no payoff date', () => {
    expect(payoffMissingText(['no_rate'])).toBe('No interest rate');
    expect(payoffMissingText(['no_payment', 'payment_below_interest'])).toBe(
      'The repayment does not cover the interest',
    );
    expect(payoffMissingText([])).toBeNull();
  });
});

describe('other assets: names, units, prices and FX', () => {
  it('a URL-named item shows its host and path without the scheme or www., ellipsised at 48', () => {
    expect(isUrlName('https://example.com/items/1')).toBe(true);
    expect(isUrlName('Example watch')).toBe(false);
    expect(shortName('https://www.example.com/items/1')).toBe('example.com/items/1');
    expect(shortName('http://example.com/items/1/')).toBe('example.com/items/1');
    const long = shortName(
      'https://example.com/collectibles/items/1234567890/a-very-long-generic-item-name',
    );
    expect(long).toHaveLength(48);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('example.com/collectibles/')).toBe(true);
    expect(shortName('  Example watch ')).toBe('Example watch');
  });

  it('units carry the unit of measure; a unit cost its currency', () => {
    expect(unitsText('10', 'oz')).toBe('10 oz');
    expect(unitsText('1', 'each')).toBe('1');
    expect(unitCostText('400', 'AUD')).toBe('$400.00');
    expect(unitCostText('400', 'USD')).toBe('400.00 USD');
  });

  it('the FX line: a GBX (pence) rate is quoted per pound (× 100)', () => {
    expect(fxLine('USD', '1.5381', '2024-05-10')).toBe('1 USD = A$1.5381 on 10/05/2024');
    expect(fxLine('GBX', '0.019012', null)).toBe('1 GBP = A$1.9012');
    expect(fxQuoteCurrency('GBX')).toBe('GBP');
    expect(fxQuoteCurrency('EUR')).toBe('EUR');
  });

  it('GBX quotes ÷ 100 on the way back, exactly on the string', () => {
    expect(quotedFxRate('GBX', '0.019012')).toBe('1.9012');
    expect(storedFxRate('GBX', '1.9012')).toBe('0.019012');
    expect(storedFxRate('USD', '1.52')).toBe('1.52');
    expect(quotedFxRate('USD', '1.52')).toBe('1.52');
  });

  it('annualised figures hide under 90 days held', () => {
    expect(annualisedHidden(89)).toBe(true);
    expect(annualisedHidden(90)).toBe(false);
    expect(annualisedHidden(null)).toBe(false);
  });
});
