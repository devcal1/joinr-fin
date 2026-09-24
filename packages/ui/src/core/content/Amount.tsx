import type { JSX } from 'react';
import { cx } from '../cx';
import { MINUS, formatMoney, type MoneyFormatOptions } from '../format';

export interface AmountProps extends MoneyFormatOptions {
  /** Integer cents. */
  cents: number;
  /** Negatives in the `--stop` colour (default true). The U+2212 sign is always shown. */
  colorNegative?: boolean;
  className?: string;
}

/** A money figure: `$12,480.00`, monospaced; negatives `−$1,234.00` in the stop colour. */
export function Amount({
  cents,
  colorNegative = true,
  className,
  ...format
}: AmountProps): JSX.Element {
  const text = formatMoney(cents, format);
  const negative = colorNegative && text.startsWith(MINUS);
  return (
    <span className={cx('jf-amount', negative && 'jf-amount--negative', className)}>{text}</span>
  );
}
