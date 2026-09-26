// The Budget page's editor state, action keys and table lines (stage-3.md §6.5). No components.
import type {
  BudgetPageResponse,
  BudgetRowDto,
  DecimalString,
  YearlyExpenseDto,
} from '@joinr/schema';
import { percentWords } from '../investments/display';
import { AGGRESSIVENESS_WORDS } from '../cashflow/display';

export type BudgetEditor =
  | { form: 'item'; row?: BudgetRowDto; opener: string }
  | { form: 'auto'; row: BudgetRowDto; opener: string }
  | { form: 'yearly'; expense?: YearlyExpenseDto; opener: string }
  | { form: 'settings'; opener: string };

export function rowKey(row: Pick<BudgetRowDto, 'id' | 'kind'>): string {
  return row.id === null ? row.kind : String(row.id);
}

export function budgetActionKey(action: 'edit' | 'delete' | 'up' | 'down', key: string): string {
  return `budget-${action}-${key}`;
}

export function yearlyActionKey(action: 'edit' | 'delete', id: number): string {
  return `yearly-${action}-${id}`;
}

/** One line of the spending or leftover-split table (`row` null = the unallocated line). */
export interface BudgetLine {
  key: string;
  row: BudgetRowDto | null;
  label: string;
  monthlyCents: number;
  incomeShareRatio: DecimalString | null;
  weeklyCents: number | null;
  yearlyCents: number | null;
}

/** The page's name for a row: auto rows get plain words, items keep their name. */
export function rowLabel(row: BudgetRowDto): string {
  switch (row.kind) {
    case 'auto_yearly':
      return 'Yearly expenses (automatic)';
    case 'auto_invest':
      return row.manual ? 'Investment savings (manual)' : 'Investment savings (automatic)';
    case 'auto_cash':
      return 'Cash savings (automatic)';
    default:
      return row.name ?? 'Unnamed item';
  }
}

function lineOf(row: BudgetRowDto): BudgetLine {
  return {
    key: rowKey(row),
    row,
    label: rowLabel(row),
    monthlyCents: row.monthlyCents,
    incomeShareRatio: row.incomeShareRatio,
    weeklyCents: row.weeklyCents,
    yearlyCents: row.yearlyCents,
  };
}

/** The spending table: the items and the yearly-expenses row, in display order. */
export function spendingLines(page: BudgetPageResponse): BudgetLine[] {
  return page.rows.filter((r) => r.kind === 'item' || r.kind === 'auto_yearly').map(lineOf);
}

/** The leftover split: the investment row, the cash row and (when non-zero) the rounding line. */
export function splitLines(page: BudgetPageResponse): BudgetLine[] {
  const lines = page.rows
    .filter((r) => r.kind === 'auto_invest' || r.kind === 'auto_cash')
    .map(lineOf);
  const unallocated = page.summary.unallocatedCents;
  if (unallocated !== null && unallocated !== 0) {
    lines.push({
      key: 'unallocated',
      row: null,
      label: 'Unallocated (rounding)',
      monthlyCents: unallocated,
      incomeShareRatio: null,
      weeklyCents: null,
      yearlyCents: unallocated * 12,
    });
  }
  return lines;
}

/** The ids the reorder route needs: every item and the yearly row, in the new order. */
export function reorderIds(
  lines: readonly BudgetLine[],
  index: number,
  direction: -1 | 1,
): number[] | null {
  const ids = lines.map((line) => line.row?.id ?? null);
  const other = index + direction;
  const a = ids[index];
  const b = ids[other];
  if (a === undefined || b === undefined || a === null || b === null) return null;
  ids[index] = b;
  ids[other] = a;
  return ids.filter((id): id is number => id !== null);
}

/** "Split: 60% investments / 40% cash (target cash 15%, normal)"; null when not known. */
export function splitText(summary: BudgetPageResponse['summary']): string | null {
  if (
    summary.investManual ||
    summary.investShareRatio === null ||
    summary.cashShareRatio === null
  ) {
    return null;
  }
  const extras: string[] = [];
  if (summary.cashTargetRatio !== null)
    extras.push(`target cash ${percentWords(summary.cashTargetRatio)}`);
  if (summary.aggressiveness !== null) extras.push(AGGRESSIVENESS_WORDS[summary.aggressiveness]);
  const tail = extras.length ? ` (${extras.join(', ')})` : '';
  return `Split: ${percentWords(summary.investShareRatio)} investments / ${percentWords(summary.cashShareRatio)} cash${tail}`;
}

/** An item's account in words: the linked name, a stale typed name, or none. */
export function isStaleAccount(row: Pick<BudgetRowDto, 'accountLinked' | 'accountName'>): boolean {
  return !row.accountLinked && row.accountName !== null;
}

export const STALE_ACCOUNT = 'Account not found: choose one';
