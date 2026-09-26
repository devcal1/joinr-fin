// The callouts under the Net Worth hero (stage-5.md §6.3 item 3): no recorded month yet; an ended
// month not recorded while auto-record is off (a Note before any app data, D84; Important after);
// auto-record waiting for an earlier month (D94); prices missing or stale; market data off.
import type { NetWorthPageResponse } from '@joinr/schema';
import { Callout } from '@joinr/ui';
import type { JSX } from 'react';
import { HistoryLinkText } from '../history/HistoryLinkText';
import {
  MARKET_OFF_NOTE,
  NO_MONTHS_NOTE,
  blockedCallout,
  pricesCallout,
  unrecordedCallout,
} from './netWorthText';

export function NetWorthCallouts({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const noMonths = page.lastRun === null;
  const unrecorded = unrecordedCallout(page);
  const blocked = blockedCallout(page.recorder.blocked);
  const prices = pricesCallout(page.prices);
  return (
    <>
      {noMonths ? (
        <Callout kind="note" title="No recorded months">
          <p>
            <HistoryLinkText text={NO_MONTHS_NOTE} />
          </p>
        </Callout>
      ) : null}
      {unrecorded ? (
        <Callout
          kind={unrecorded.kind}
          title={unrecorded.kind === 'note' ? 'Not recorded in the app' : 'Month not recorded'}
        >
          <p>
            <HistoryLinkText text={unrecorded.text} />
          </p>
        </Callout>
      ) : null}
      {blocked ? (
        <Callout kind="important" title="Auto-record is waiting">
          <p>
            <HistoryLinkText text={blocked} />
          </p>
        </Callout>
      ) : null}
      {prices ? (
        <Callout kind="important" title="Prices">
          <p>{prices}</p>
        </Callout>
      ) : null}
      {page.prices.mode === 'off' ? (
        <Callout kind="note" title="Market data off">
          <p>{MARKET_OFF_NOTE}</p>
        </Callout>
      ) : null}
    </>
  );
}
