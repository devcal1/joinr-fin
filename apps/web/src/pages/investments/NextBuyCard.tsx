// The "Next buy" card (stage-2.md §6.3 item 5, D39/D40; Stage 3 §6.7, D54). The hint line shows
// on every page; the countdown, the amount to invest and the parcel show on the ETFs page only
// (the sheet's timing lived on ETFs). The timing reads the live budget (a link to /budget); the
// parcel says when the cash-deficit wait stretches it. Missing inputs are listed in words.
import type { InvestmentPageResponse } from '@joinr/schema';
import {
  Callout,
  Card,
  Icon,
  KeyValueTable,
  formatDate,
  formatMoney,
  type KeyValueItem,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import {
  IMPORTED_BUDGET_TEXT,
  LIVE_BUDGET_LINK,
  SPLIT_OFF_LINK,
  assetClassText,
  countdownText,
  hintText,
  missingInputLabel,
  monthlyAmountText,
  parcelText,
} from './display';

export function NextBuyCard({ page }: { page: InvestmentPageResponse }): JSX.Element {
  const { timing, kind } = page;
  const full = kind === 'etf';
  const splitOff = timing.countdown.state === 'split_off';
  const classText = assetClassText(timing);
  const classItem: KeyValueItem = {
    label: 'Asset class',
    value: classText ?? <span className="jf-app-muted">No suggestion</span>,
  };

  const items: KeyValueItem[] = [];
  if (full) {
    const amount = monthlyAmountText(timing);
    items.push(
      {
        label: 'Monthly amount to invest',
        value: amount ? (
          <span className="jf-app-kv-stack">
            <span className="jf-app-num jf-app-num--inline">{formatMoney(amount.totalCents)}</span>
            <span className="jf-app-meta">{amount.breakdown}</span>
          </span>
        ) : (
          <span className="jf-app-muted">Not available</span>
        ),
      },
      {
        label: 'Parcel',
        value: (
          <span data-testid="next-buy-parcel">
            {parcelText(timing.plan, timing.cashDeficitMonths) ?? (
              <span className="jf-app-muted">Not available</span>
            )}
          </span>
        ),
      },
      {
        label: 'Last ETF or stock buy',
        value: timing.lastPurchaseDate ? (
          <span className="jf-app-num jf-app-num--inline">
            {formatDate(timing.lastPurchaseDate)}
          </span>
        ) : (
          <Missing />
        ),
      },
    );
  }
  items.push(classItem);

  return (
    <Card as="section" title="Next buy" className="jf-app-next-buy">
      <div className="jf-app-block">
        <p className="jf-app-next-buy__hint" data-testid="next-buy-hint">
          {hintText(timing, kind)}
        </p>
        {full ? (
          <p className="jf-app-next-buy__countdown" data-testid="next-buy-countdown">
            {splitOff ? (
              // D46: a status line (icon + words, the check tone), not a bare "Cash first".
              <span className="jf-app-tile-flag" data-status="check">
                <Icon icon={CircleAlert} className="jf-app-tile-flag__icon" />
                <span>{countdownText(timing.countdown, timing.lastPurchaseDate, page.asOf)}</span>
              </span>
            ) : (
              countdownText(timing.countdown, timing.lastPurchaseDate, page.asOf)
            )}
          </p>
        ) : null}
        {full && splitOff ? (
          <p className="jf-app-meta" data-testid="next-buy-split-off">
            <Link to="/budget">{SPLIT_OFF_LINK}</Link>
          </p>
        ) : null}
        <KeyValueTable caption="Next buy details" items={items} />
        {full ? null : (
          <p>
            <Link to="/etfs">See the timing on the ETFs page</Link>
          </p>
        )}
        {timing.missing.length > 0 ? (
          <Callout kind="note" title="Inputs missing">
            <p>The timing needs:</p>
            <ul>
              {timing.missing.map((key) => (
                <li key={key}>{missingInputLabel(key)}</li>
              ))}
            </ul>
            <p data-testid="next-buy-missing-footer">
              Pay and budget settings and budget items are set on the{' '}
              <Link to="/budget">Budget page</Link>; everything else in the workbook, or on the
              Settings page in Stage 5.
            </p>
          </Callout>
        ) : null}
        <p className="jf-app-meta" data-testid="next-buy-budget-source">
          {timing.budget.source === 'live_budget' ? (
            <Link to="/budget">{LIVE_BUDGET_LINK}</Link>
          ) : (
            IMPORTED_BUDGET_TEXT
          )}
        </p>
      </div>
    </Card>
  );
}
