import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter, meterFill, meterStatus } from './Meter';

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
