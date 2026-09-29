import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /**
   * A figure: monospaced, tabular. Left-aligned like every KV value (Stage 6, STYLE-7), so phrase
   * rows and number rows share one edge.
   */
  numeric?: boolean;
}

export interface KeyValueTableProps {
  items: KeyValueItem[];
  /** Accessible name for the table (not shown). */
  caption?: string;
}

/**
 * A record of facts: `--raised` label column (small uppercase), `--surface` values, hairlines
 * between rows only, rounded outer corners. Both columns size to their content (owner 2026-09-29),
 * so a value sits next to its label rather than across a wide card.
 *
 * Stage 6 (stage-6.md §6.9 D, E): labels wrap between words only (STYLE-6); below 480 px of the
 * table's own width each row stacks, label above value (a container query, so a half-width card
 * stacks on a desktop too); values are left-aligned, figures monospaced (STYLE-7).
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
