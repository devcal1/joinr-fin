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
 * A record of facts: `--raised` label column at 38% (small uppercase), `--surface` values,
 * hairlines between rows only, rounded outer corners. The column widths are set on a `<colgroup>`:
 * with `table-layout: fixed`, a visually hidden (absolutely positioned) caption otherwise stops
 * the label cell's 38% from applying, and the columns split 50/50.
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
        <colgroup>
          <col className="jf-kv__col-label" />
          <col />
        </colgroup>
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
