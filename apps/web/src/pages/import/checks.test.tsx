import { REPORT_SECTIONS } from '@joinr/schema';
import { sampleReport } from '@joinr/schema/fixtures';
import { MINUS } from '@joinr/ui';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  SECTION_LABELS,
  filterChecks,
  formatCheckValue,
  isNumericUnit,
  orderSections,
  runTitle,
  sectionLabel,
  sectionStartsOpen,
  statusBreakdown,
  totalChecks,
} from './checks';

function text(node: ReactNode): string {
  const { container, unmount } = render(<>{node}</>);
  const result = container.textContent ?? '';
  unmount();
  return result;
}

describe('check values', () => {
  it('formats by unit', () => {
    expect(text(formatCheckValue('cents', 315000))).toBe('$3,150.00');
    expect(text(formatCheckValue('cents', -1))).toBe(`${MINUS}$0.01`);
    expect(text(formatCheckValue('cents', '2500'))).toBe('$25.00');
    expect(text(formatCheckValue('units', '29.5'))).toBe('29.5');
    expect(text(formatCheckValue('units', '-0.5'))).toBe(`${MINUS}0.5`);
    expect(text(formatCheckValue('ratio', '0.07'))).toBe('7.00%');
    expect(text(formatCheckValue('date', '2026-08-31'))).toBe('31/08/2026');
    expect(text(formatCheckValue('count', 1234))).toBe('1,234');
    // Negative counts use U+2212, like every other negative figure.
    expect(text(formatCheckValue('count', -4))).toBe(`${MINUS}4`);
    expect(text(formatCheckValue('count', -1200))).toBe(`${MINUS}1,200`);
    expect(text(formatCheckValue('text', 'ASX:XYZ'))).toBe('ASX:XYZ');
    expect(text(formatCheckValue('none', 'x'))).toBe('x');
  });

  it('shows null as a muted dash and odd values as sent', () => {
    expect(text(formatCheckValue('cents', null))).toBe('—');
    expect(text(formatCheckValue('date', 'not-a-date'))).toBe('not-a-date');
    expect(text(formatCheckValue('units', 'abc'))).toBe('abc');
    expect(text(formatCheckValue('cents', '12.5'))).toBe('12.5');
  });

  it('treats figure units as numeric', () => {
    expect(isNumericUnit('cents')).toBe(true);
    expect(isNumericUnit('count')).toBe(true);
    expect(isNumericUnit('text')).toBe(false);
  });
});

describe('report helpers', () => {
  it('has a label for every section', () => {
    for (const section of REPORT_SECTIONS) expect(SECTION_LABELS[section]).toBeTruthy();
    expect(sectionLabel('net_worth')).toBe('Net worth');
    expect(sectionLabel('unknown')).toBe('unknown');
  });

  it('orders sections as the report does, unknown ones last', () => {
    expect(orderSections(['suspects', 'workbook', 'zzz', 'holdings', 'workbook'])).toEqual([
      'workbook',
      'holdings',
      'suspects',
      'zzz',
    ]);
  });

  it('filters checks by status and section', () => {
    const checks = sampleReport.checks;
    expect(filterChecks(checks, 'all', '')).toHaveLength(checks.length);
    const suspect = filterChecks(checks, 'suspect', '');
    expect(suspect.length).toBe(sampleReport.totals.suspect);
    expect(suspect.every((c) => c.status === 'suspect')).toBe(true);
    const holdings = filterChecks(checks, 'all', 'holdings');
    expect(holdings.every((c) => c.section === 'holdings')).toBe(true);
    expect(filterChecks(checks, 'unexplained', 'holdings')).toHaveLength(1);
    expect(filterChecks(checks, 'info', 'cash')).toEqual([]);
  });

  it('filters "Needs attention" to the unexplained and suspect checks', () => {
    const checks = sampleReport.checks;
    const attention = filterChecks(checks, 'attention', '');
    expect(attention).toHaveLength(sampleReport.totals.unexplained + sampleReport.totals.suspect);
    expect(attention.every((c) => c.status === 'unexplained' || c.status === 'suspect')).toBe(true);
    expect(filterChecks(checks, 'attention', 'dividends').map((c) => c.status)).toEqual([
      'suspect',
    ]);
    expect(filterChecks(checks, 'attention', 'cash')).toEqual([]);
  });

  it('under "All", opens a section with an explained, suspect or unexplained line, and counts its lines', () => {
    const of = (section: string) => sampleReport.checks.filter((c) => c.section === section);
    expect(sectionStartsOpen(of('workbook'), 'all')).toBe(false);
    expect(sectionStartsOpen(of('budget'), 'all')).toBe(false);
    expect(sectionStartsOpen(of('counts'), 'all')).toBe(true);
    expect(sectionStartsOpen(of('dividends'), 'all')).toBe(true);
    expect(sectionStartsOpen(of('snapshots'), 'all')).toBe(true);
    expect(sectionStartsOpen([], 'all')).toBe(false);
    expect(statusBreakdown(of('workbook'))).toBe('2 match');
    expect(statusBreakdown(of('settings'))).toBe('1 explained · 1 match · 1 info');
    expect(statusBreakdown([])).toBe('');
  });

  it('opens every section under any filter but "All" (D32)', () => {
    const workbook = sampleReport.checks.filter((c) => c.section === 'workbook');
    expect(workbook.every((c) => c.status === 'match')).toBe(true);
    for (const filter of ['attention', 'match', 'info', 'explained'] as const) {
      expect(sectionStartsOpen(filterChecks(workbook, filter, ''), filter)).toBe(true);
    }
  });

  it('counts every check and titles a run', () => {
    expect(totalChecks(sampleReport.totals)).toBe(sampleReport.checks.length);
    expect(runTitle({ id: 7, fileName: 'example-workbook.xlsx' })).toBe(
      'Run #7 · example-workbook.xlsx',
    );
  });
});
