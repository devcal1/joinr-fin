import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installUiCss } from '../testing/cssHarness';
import { METER_TONE_WORDS, Meter, meterFill, meterStatus, meterStatusText } from './Meter';

const M = '−';

describe('Meter', () => {
  it('is a labelled meter with the value and target in money', () => {
    render(<Meter label="Available cash" valueCents={2_790_000} targetCents={5_000_000} />);
    const meter = screen.getByRole('meter', { name: 'Available cash' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '50000');
    expect(meter).toHaveAttribute('aria-valuenow', '27900');
    expect(meter).toHaveAttribute('aria-valuetext', '$27,900.00 of $50,000.00');
    expect(screen.getByText('Short by $22,100.00')).toBeVisible();
    expect(meter.querySelector('.jf-meter__fill')).toHaveStyle({ width: '55.80%' });
  });

  it('clamps the fill and aria-valuenow at the target but keeps the true figure over it', () => {
    const { container } = render(
      <Meter label="Goal" valueCents={1_200_000} targetCents={1_000_000} wholeDollars />,
    );
    const meter = screen.getByRole('meter', { name: 'Goal' });
    expect(meter).toHaveAttribute('aria-valuenow', '10000');
    expect(meter).toHaveAttribute('aria-valuetext', '$12,000 of $10,000. Over by $2,000');
    expect(meter.querySelector('.jf-meter__fill')).toHaveStyle({ width: '100.00%' });
    expect(screen.getByText('Over by $2,000')).toBeVisible();
    expect(container.querySelector('.jf-meter__value')).toHaveTextContent('$12,000');
    expect(container.firstChild).toHaveAttribute('data-status', 'over');
  });

  it('says Reached at the target', () => {
    render(<Meter label="Holiday" valueCents={800_000} targetCents={800_000} />);
    expect(screen.getByText('Reached')).toBeVisible();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '$8,000.00 of $8,000.00');
  });

  it('clamps a negative value at zero while the text shows it', () => {
    const { container } = render(<Meter label="Cash" valueCents={-50_000} targetCents={100_000} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(meter.querySelector('.jf-meter__fill')).toHaveStyle({ width: '0.00%' });
    expect(container.querySelector('.jf-meter__value')).toHaveTextContent(`${M}$500.00`);
    expect(screen.getByText('Short by $1,500.00')).toBeVisible();
  });

  it('marks a negative value in the --stop tint, and only a negative one (triage STYLE-5)', () => {
    const removeCss = installUiCss(['tokens', 'base', 'meter']);
    try {
      const { container, rerender } = render(
        <Meter label="Pre-super" valueCents={-5_000_000} targetCents={100_000} />,
      );
      const value = () => container.querySelector('.jf-meter__value')!;
      expect(value()).toHaveClass('jf-meter__value--negative');
      expect(getComputedStyle(value()).color).toBe('var(--stop-tint)');
      rerender(<Meter label="Pre-super" valueCents={0} targetCents={100_000} />);
      expect(value()).not.toHaveClass('jf-meter__value--negative');
      rerender(<Meter label="Pre-super" valueCents={5_000_000} targetCents={100_000} />);
      expect(value()).not.toHaveClass('jf-meter__value--negative');
      expect(getComputedStyle(value()).color).toBe('var(--text-bright)');
    } finally {
      removeCss();
    }
  });

  it('renders a hint', () => {
    render(<Meter label="Car" valueCents={1} targetCents={2} hint={<span>About Mar 2027</span>} />);
    expect(screen.getByText('About Mar 2027')).toBeVisible();
  });

  it('computes the status and the fill', () => {
    expect(meterStatus(5, 10)).toBe('short');
    expect(meterStatus(10, 10)).toBe('reached');
    expect(meterStatus(11, 10)).toBe('over');
    expect(meterStatus(0, 0)).toBe('reached');
    expect(meterFill(5, 10)).toBe(0.5);
    expect(meterFill(20, 10)).toBe(1);
    expect(meterFill(-1, 10)).toBe(0);
    expect(meterFill(3, 0)).toBe(1);
  });
});

// Stage 4 (stage-4.md §6.1, UX-1): the additive cap props.
describe('Meter: cap kind, projection tick and tones', () => {
  it('under the cap: "$X left under the cap" with the Under word and the go fill', () => {
    const { container } = render(
      <Meter
        label="Concessional contributions FY2026–27"
        kind="cap"
        valueCents={1_000_000}
        targetCents={3_000_000}
        tone="go"
      />,
    );
    const meter = screen.getByRole('meter', { name: 'Concessional contributions FY2026–27' });
    expect(screen.getByText('$20,000.00 left under the cap')).toBeVisible();
    expect(screen.getByText('Under')).toBeVisible();
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      'Under. $10,000.00 of $30,000.00. $20,000.00 left under the cap',
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-kind', 'cap');
    expect(root).toHaveAttribute('data-tone', 'go');
    expect(root.querySelector('.jf-badge--go')).not.toBeNull();
  });

  it('near the cap: the Near word and the check fill', () => {
    const { container } = render(
      <Meter label="Cap" kind="cap" valueCents={2_800_000} targetCents={3_000_000} tone="check" />,
    );
    expect(screen.getByText('Near')).toBeVisible();
    expect(screen.getByText('$2,000.00 left under the cap')).toBeVisible();
    expect(container.querySelector('.jf-badge--check')).not.toBeNull();
    expect(container.firstChild).toHaveAttribute('data-tone', 'check');
  });

  it('over the cap: "Over the cap by $X" with the Over word, the fill clamped at 100 %', () => {
    const { container } = render(
      <Meter label="Cap" kind="cap" valueCents={3_250_000} targetCents={3_000_000} tone="stop" />,
    );
    expect(screen.getByText('Over the cap by $2,500.00')).toBeVisible();
    expect(screen.getByText('Over')).toBeVisible();
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '30000');
    expect(meter.querySelector('.jf-meter__fill')).toHaveStyle({ width: '100.00%' });
    expect(container.querySelector('.jf-badge--stop')).not.toBeNull();
  });

  it('at the cap: "At the cap"', () => {
    render(<Meter label="Cap" kind="cap" valueCents={100} targetCents={100} />);
    expect(screen.getByText('At the cap')).toBeVisible();
    // No tone: no status word badge.
    expect(screen.queryByText('Under')).toBeNull();
  });

  it('the projection tick sits across the track and its figure is in the text line', () => {
    const { container } = render(
      <Meter
        label="Cap"
        kind="cap"
        valueCents={1_000_000}
        targetCents={4_000_000}
        markerCents={3_000_000}
        markerLabel="Projected by 30 June"
        valueLabel="so far"
        tone="go"
      />,
    );
    const tick = screen.getByTestId('meter-marker');
    expect(tick).toHaveStyle({ left: '75.00%' });
    expect(tick).toHaveAttribute('aria-hidden', 'true');
    const figures = container.querySelector('.jf-meter__figures');
    expect(figures).toHaveTextContent(
      '$10,000.00 so far of $40,000.00 · Projected by 30 June $30,000.00',
    );
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      'Under. $10,000.00 of $40,000.00. $30,000.00 left under the cap. Projected by 30 June $30,000.00',
    );
  });

  it('under the cap so far but projected over it: the text follows the projection (Fixer round 1)', () => {
    const { container } = render(
      <Meter
        label="Cap"
        kind="cap"
        valueCents={1_000_000}
        targetCents={3_000_000}
        markerCents={3_400_000}
        markerLabel="Projected by 30 June"
        valueLabel="so far"
        tone="stop"
      />,
    );
    expect(screen.getByText('Projected over the cap by $4,000.00')).toBeVisible();
    expect(screen.queryByText(/left under the cap/)).toBeNull();
    expect(screen.getByText('Over')).toBeVisible();
    expect(container.querySelector('.jf-badge--stop')).not.toBeNull();
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe(
      'Over. $10,000.00 of $30,000.00. Projected over the cap by $4,000.00. Projected by 30 June $34,000.00',
    );
  });

  it('a projection exactly at the cap: "Projected to reach the cap"', () => {
    render(
      <Meter
        label="Cap"
        kind="cap"
        valueCents={1_000_000}
        targetCents={3_000_000}
        markerCents={3_000_000}
        tone="check"
      />,
    );
    expect(screen.getByText('Projected to reach the cap')).toBeVisible();
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toMatch(/^Near. /);
  });

  it('a projection past the cap clamps the tick at the end of the track', () => {
    render(<Meter label="Cap" kind="cap" valueCents={1} targetCents={100} markerCents={250} />);
    expect(screen.getByTestId('meter-marker')).toHaveStyle({ left: '100.00%' });
  });

  it('the target kind keeps the Stage 3 texts, with or without a tone', () => {
    const { container } = render(
      <Meter label="Goal" valueCents={500} targetCents={1_000} tone="check" />,
    );
    expect(screen.getByText('Short by $5.00')).toBeVisible();
    expect(screen.queryByText('Near')).toBeNull();
    expect(screen.queryByTestId('meter-marker')).toBeNull();
    expect(container.firstChild).toHaveAttribute('data-kind', 'target');
  });

  it('words the statuses', () => {
    const money = (c: number) => String(c);
    expect(meterStatusText('cap', 1, 3, money)).toBe('2 left under the cap');
    expect(meterStatusText('cap', 3, 3, money)).toBe('At the cap');
    expect(meterStatusText('cap', 5, 3, money)).toBe('Over the cap by 2');
    expect(meterStatusText('target', 1, 3, money)).toBe('Short by 2');
    // The projection (marker) words a cap that is still under its limit so far.
    expect(meterStatusText('cap', 1, 3, money, 5)).toBe('Projected over the cap by 2');
    expect(meterStatusText('cap', 1, 3, money, 3)).toBe('Projected to reach the cap');
    expect(meterStatusText('cap', 1, 3, money, 2)).toBe('2 left under the cap');
    expect(meterStatusText('cap', 3, 3, money, 5)).toBe('At the cap');
    expect(meterStatusText('cap', 5, 3, money, 9)).toBe('Over the cap by 2');
    // The target kind ignores the marker.
    expect(meterStatusText('target', 1, 3, money, 5)).toBe('Short by 2');
    expect(METER_TONE_WORDS).toEqual({ go: 'Under', check: 'Near', stop: 'Over' });
  });
});
