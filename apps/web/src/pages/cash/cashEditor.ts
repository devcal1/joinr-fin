// The Cash page's one open editor (stage-3.md §6.8: one inline form at a time).
import type { CashAccountDto, IsoMonth, SavingsGoalDto } from '@joinr/schema';

export type CashEditor =
  | { form: 'account'; account?: CashAccountDto; opener: string }
  | { form: 'balances'; opener: string }
  | { form: 'details'; periodMonth: IsoMonth; opener: string }
  | { form: 'adjust'; periodMonth: IsoMonth; opener: string }
  | { form: 'note'; periodMonth: IsoMonth; opener: string }
  | { form: 'goal'; goal?: SavingsGoalDto; opener: string }
  | { form: 'settings'; opener: string };

/** Adjusted (the app's figures, D51) or Raw (as the sheet computes them). */
export type SavingsView = 'adjusted' | 'raw';

/**
 * True while an inline form is open (§6.8: one at a time). The read-only Details card is not a
 * form: it locks no other action, and opening a form simply replaces it.
 */
export const isFormOpen = (e: CashEditor | null): boolean => e !== null && e.form !== 'details';
