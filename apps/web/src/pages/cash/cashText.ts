// Small text and key helpers for the Cash page (stage-3.md §6.3). No components (react-refresh).
import type { CashPageResponse, IsoDate } from '@joinr/schema';
import { formatDate, formatMoney } from '@joinr/ui';
import { plural } from '../../formatting';
import { percentWords } from '../investments/display';
import { periodLabel } from '../cashflow/display';

/** The data-cf-action key of an account row's buttons (focus returns there). */
export function accountActionKey(action: 'edit' | 'history', id: number): string {
  return `account-${action}-${id}`;
}

/** The data-cf-action key of a savings row's buttons. */
export function periodActionKey(
  action: 'details' | 'adjust' | 'note',
  periodMonth: string,
): string {
  return `period-${action}-${periodMonth}`;
}

/** The data-cf-action key of a goal card's buttons. */
export function goalActionKey(action: 'edit' | 'delete' | 'up' | 'down', id: number): string {
  return `goal-${action}-${id}`;
}

/** "Older than the latest balance (dd/mm/yyyy): added to the history only." */
export function olderNote(balanceAsOf: IsoDate): string {
  return `Older than the latest balance (${formatDate(balanceAsOf)}): added to the history only.`;
}

/** "Saved toward goals: $X = …" (from `goals.cashBasis`, D59) plus the stale / unpriced words. */
export function savedLine(page: CashPageResponse): string {
  const { goals } = page;
  const shareRatio = page.settings.values['goals.houseDepositInvestmentShare'];
  const share = percentWords(typeof shareRatio === 'string' ? shareRatio : '0');
  const saved = formatMoney(goals.savedCents);
  let line =
    goals.cashBasis === 'available'
      ? `Saved toward goals: ${saved} = cash above the emergency fund, excluding loans you've made, + ${share} of investments.`
      : `Saved toward goals: ${saved} = total cash above the emergency fund + ${share} of investments.`;
  if (goals.stalePriceCount > 0) line += ' Investments use stale prices.';
  if (goals.unpricedCount > 0) {
    line += ` ${plural(goals.unpricedCount, 'holding')} without a price ${goals.unpricedCount === 1 ? 'is' : 'are'} left out.`;
  }
  return line;
}

/**
 * The last recorded month when its year (the §2.6 anchor's year window) has already ended by the
 * page's as-of date, e.g. "Jun 2026"; null in the normal case (the anchor's year includes today).
 * The year figures and the end-of-year projection follow that anchor, so the page says so.
 */
export function endedAnchorMonth(page: Pick<CashPageResponse, 'asOf' | 'kpis'>): string | null {
  const { anchor, year } = page.kpis;
  if (anchor === null || page.asOf < year.end) return null;
  return periodLabel(anchor.slice(0, 7));
}

/** "Linked to <loan> (change it on the Property page)". */
export function linkedLoanText(name: string): string {
  return `Linked to ${name} (change it on the Property page)`;
}

/** "This also removes its link to <loan>". */
export function unlinkText(name: string): string {
  return `This also removes its link to ${name}.`;
}
