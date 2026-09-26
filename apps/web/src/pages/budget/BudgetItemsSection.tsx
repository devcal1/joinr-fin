// The Budget page's items (stage-3.md §6.5 item 4, D54, D61): the spending table (items and the
// yearly-expenses row; total "Planned spend", no teal) and the leftover-split table (the
// investment and cash rows and the rounding line; total "Left over", the page's one teal table
// cell), so each total equals its visible rows. Automatic rows carry a muted pill; savings lines a
// "Savings" pill; a stale account name a check badge. Items and the yearly row can be reordered.
import type { BudgetPageResponse } from '@joinr/schema';
import {
  Amount,
  Button,
  Callout,
  ColumnTable,
  MEDIA,
  Pill,
  StatusBadge,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useDeleteBudgetItem, useReorderBudgetItems } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { ReviewFlagBadges } from '../investments/cells';
import { FlowCell, RatioCell } from '../cashflow/cells';
import { sumCents } from '../cashflow/display';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import {
  actionErrorText,
  actionSelector,
  orderColumns,
  useRowDelete,
  type EditorState,
} from '../cashflow/formState';
import {
  STALE_ACCOUNT,
  budgetActionKey,
  isStaleAccount,
  reorderIds,
  spendingLines,
  splitLines,
  splitText,
  type BudgetEditor,
  type BudgetLine,
} from './budgetModel';
import { NEGATIVE_CASH_ROW } from './ItemForm';

/**
 * The emergency-fund test compares the cash that counts toward the fund (available cash, D59; plus
 * offsets when D56 is on), not Total cash, so the words name that basis without reading the flags.
 */
export const BELOW_FUND_NOTE =
  "The cash that counts toward the emergency fund is below it, so the whole leftover goes to cash. Loans you've made don't count; the Cash page shows what does.";
export const NO_ITEMS = 'No budget items yet.';

const DESKTOP_ORDER = [
  'item',
  'category',
  'account',
  'monthly',
  'share',
  'weekly',
  'yearly',
  'actions',
] as const;
const PHONE_ORDER = [
  'item',
  'monthly',
  'account',
  'category',
  'share',
  'weekly',
  'yearly',
  'actions',
] as const;

const deleteSelector = (key: string): string => actionSelector(budgetActionKey('delete', key));

export interface BudgetItemsSectionProps {
  page: BudgetPageResponse;
  editor: EditorState<BudgetEditor>;
}

export function BudgetItemsSection({ page, editor }: BudgetItemsSectionProps): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const remove = useDeleteBudgetItem();
  const reorder = useReorderBudgetItems();
  const rowDelete = useRowDelete<string>(deleteSelector);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const { summary } = page;
  const spending = spendingLines(page);
  const split = splitLines(page);
  const locked = editor.editor !== null;
  const hasItems = page.rows.some((r) => r.kind === 'item');
  const confirming = spending.find((line) => line.key === rowDelete.confirming)?.row;

  const move = (index: number, direction: -1 | 1): void => {
    const ids = reorderIds(spending, index, direction);
    if (!ids) return;
    setReorderError(null);
    reorder.mutate(ids, {
      onSuccess: () => editor.announce('Budget item moved'),
      onError: (error) => setReorderError(actionErrorText(error)),
    });
  };

  const columns = (lines: readonly BudgetLine[], table: 'spending' | 'split') => {
    const all: Record<string, ColumnTableColumn<BudgetLine>> = {
      item: {
        id: 'item',
        header: 'Item',
        value: (line) => line.label,
        cell: (line) => (
          <span className="jf-app-item-cell">
            <span>{line.label}</span>
            {line.row?.derived ? (
              <Pill tone="na">{line.row.manual ? 'Manual' : 'Automatic'}</Pill>
            ) : null}
            {line.row?.savingsLine ? <Pill>Savings</Pill> : null}
          </span>
        ),
        minWidth: phone ? 140 : 180,
      },
      category: {
        id: 'category',
        header: 'Category',
        value: (line) => line.row?.category ?? null,
        cell: (line) => line.row?.category ?? <Missing />,
      },
      account: {
        id: 'account',
        header: 'Account',
        value: (line) => line.row?.accountName ?? null,
        cell: (line) => {
          const row = line.row;
          if (!row) return <Missing />;
          const flags = row.flags.filter((flag) => flag !== 'unmatched_account');
          return (
            <span className="jf-app-item-cell">
              {row.accountName ? <span>{row.accountName}</span> : <Missing />}
              {isStaleAccount(row) ? <StatusBadge status="check" label={STALE_ACCOUNT} /> : null}
              <ReviewFlagBadges flags={flags} />
            </span>
          );
        },
      },
      monthly: {
        id: 'monthly',
        header: 'Monthly',
        value: (line) => line.monthlyCents,
        cell: (line) => <FlowCell cents={line.monthlyCents} />,
        numeric: true,
      },
      share: {
        id: 'share',
        header: '% of income',
        value: (line) => line.incomeShareRatio,
        cell: (line) => <RatioCell ratio={line.incomeShareRatio} />,
        numeric: true,
      },
      weekly: {
        id: 'weekly',
        header: 'Weekly',
        value: (line) => line.weeklyCents,
        cell: (line) => <FlowCell cents={line.weeklyCents} />,
        numeric: true,
      },
      yearly: {
        id: 'yearly',
        header: 'Yearly',
        value: (line) => line.yearlyCents,
        cell: (line) => <FlowCell cents={line.yearlyCents} />,
        numeric: true,
      },
      actions: {
        id: 'actions',
        header: 'Actions',
        value: () => null,
        cell: (line) => {
          const row = line.row;
          if (!row) return null;
          const label = `budget row ${line.label}`;
          if (rowDelete.confirming === line.key) {
            return (
              <DeleteConfirm
                question={`Delete the ${label}?`}
                label={label}
                busy={remove.isPending}
                onConfirm={() => {
                  if (row.id === null) return;
                  remove.mutate(row.id, {
                    onSuccess: () => {
                      rowDelete.finish();
                      editor.announce('Budget item deleted');
                    },
                    onError: rowDelete.fail,
                  });
                }}
                onCancel={rowDelete.cancel}
              />
            );
          }
          const index = lines.indexOf(line);
          const busy = locked || rowDelete.confirming !== null || reorder.isPending;
          const reorderable = table === 'spending' && row.id !== null;
          return (
            <span className="jf-app-row-actions jf-app-row-actions--pairs">
              <span className="jf-app-row-actions__pair">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  aria-label={`Edit ${label}`}
                  data-cf-action={budgetActionKey('edit', line.key)}
                  onClick={() =>
                    editor.open(
                      row.kind === 'item'
                        ? {
                            form: 'item',
                            row,
                            opener: actionSelector(budgetActionKey('edit', line.key)),
                          }
                        : {
                            form: 'auto',
                            row,
                            opener: actionSelector(budgetActionKey('edit', line.key)),
                          },
                    )
                  }
                  disabled={busy}
                >
                  Edit
                </Button>
                {row.kind === 'item' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    aria-label={`Delete ${label}`}
                    data-cf-action={budgetActionKey('delete', line.key)}
                    onClick={() => rowDelete.ask(line.key)}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                ) : null}
              </span>
              {reorderable ? (
                <span className="jf-app-row-actions__pair">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={ArrowUp}
                    aria-label={`Move ${label} up`}
                    data-cf-action={budgetActionKey('up', line.key)}
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={ArrowDown}
                    aria-label={`Move ${label} down`}
                    data-cf-action={budgetActionKey('down', line.key)}
                    onClick={() => move(index, 1)}
                    disabled={busy || index === lines.length - 1}
                  >
                    Move down
                  </Button>
                </span>
              ) : null}
            </span>
          );
        },
      },
    };
    return orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER);
  };

  const splitLine = splitText(summary);
  const spendTotal = sumCents(spending.map((line) => line.monthlyCents));
  const splitTotal = sumCents(split.map((line) => line.monthlyCents));
  const negativeCash = summary.cashRowCents !== null && summary.cashRowCents < 0;
  // The engine sends the whole leftover to cash only with the automatic split on and the budget
  // used for the invest amount (budgetInvestment steps 6–10, SheetOptions H42); the bare
  // emergency-fund test (belowEmergencyFund) is true in the other cases too.
  const cashFirst =
    summary.belowEmergencyFund &&
    !summary.investManual &&
    page.settings.values['budget.useForInvestAmount'] === true;

  return (
    <>
      {cashFirst ? (
        <Callout kind="important" title="Cash first">
          <p>{BELOW_FUND_NOTE}</p>
        </Callout>
      ) : null}
      {negativeCash ? (
        <Callout kind="important" title="Check the investment amount">
          <p>
            {NEGATIVE_CASH_ROW}: the investment amount per month is more than is left over. Lower
            it, or turn the automatic split back on.
          </p>
        </Callout>
      ) : null}
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error ?? reorderError} title="Not saved" />
      {hasItems ? null : <p className="jf-app-meta">{NO_ITEMS}</p>}
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={columns(spending, 'spending')}
          rows={spending}
          getRowId={(line) => line.key}
          caption={`Spending: ${plural(spending.length, 'row')}`}
          showCaption
          emptyMessage={NO_ITEMS}
          total={{
            label: 'Planned spend',
            cells: {
              monthly: <Amount cents={spendTotal} colorNegative={false} />,
              yearly: <Amount cents={spendTotal * 12} colorNegative={false} />,
            },
          }}
        />
      </div>
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={columns(split, 'split')}
          rows={split}
          getRowId={(line) => line.key}
          caption="Leftover split"
          showCaption
          emptyMessage="Nothing is left over until pay is set."
          total={{
            label: 'Left over',
            keyColumnId: 'monthly',
            cells: {
              monthly:
                summary.leftoverCents === null ? (
                  <Missing />
                ) : (
                  <Amount cents={splitTotal} colorNegative={false} />
                ),
              yearly:
                summary.leftoverCents === null ? null : (
                  <Amount cents={splitTotal * 12} colorNegative={false} />
                ),
            },
          }}
        />
      </div>
      {splitLine ? (
        <p className="jf-app-meta" data-testid="budget-split">
          {splitLine}
        </p>
      ) : summary.investManual ? (
        <p className="jf-app-meta" data-testid="budget-split">
          The automatic investment split is off: the investment row is the amount you set, and the
          rest goes to cash savings.
        </p>
      ) : null}
    </>
  );
}
