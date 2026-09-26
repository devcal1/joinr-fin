// The Side Income page's one open editor (stage-3.md §6.8) and its action keys.
import type { IncomeStreamDto, IsoMonth, SideIncomeDepositDto } from '@joinr/schema';

export type SideIncomeEditor =
  | { form: 'deposit'; deposit?: SideIncomeDepositDto; opener: string }
  | { form: 'stream'; stream?: IncomeStreamDto; opener: string }
  | { form: 'note'; periodMonth: IsoMonth; opener: string };

export function depositActionKey(action: 'edit' | 'delete', id: number): string {
  return `deposit-${action}-${id}`;
}

export function streamActionKey(action: 'rename' | 'archive' | 'delete', id: number): string {
  return `stream-${action}-${id}`;
}

export function sideNoteActionKey(periodMonth: IsoMonth): string {
  return `side-note-${periodMonth}`;
}
