import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /** Monospaced, tabular, right-aligned value. */
  numeric?: boolean;
}

export interface KeyValueTableProps {
  items: KeyValueItem[];
  /** Accessible name for the table (not shown). */
  caption?: string;
}

/**
 * A record of facts: `--raised` label column at 38% (small uppercase), `--surface` values,
 * hairlines between rows only, rounded outer corners.
 */
export function KeyValueTable({ items, caption }: KeyValueTableProps): JSX.Element {
  return (
    <div className="jf-kv">
      <table className="jf-kv__table">
        {caption ? <caption className="jf-visually-hidden">{caption}</caption> : null}
        <tbody>
          {items.map((item, index) => (
            <tr key={`${index}-${item.label}`} className="jf-kv__row">
              <th scope="row" className="jf-kv__label">
                {item.label}
              </th>
              <td className={cx('jf-kv__value', item.numeric && 'jf-kv__value--num')}>
                {item.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
