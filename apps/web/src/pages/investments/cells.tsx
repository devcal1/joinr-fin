// Cell renderers shared by the investment tables (stage-2.md §6.3 item 4): money, ratios, the
// XIRR display rule, the holding cell with its flag badges and the price cell.
import type {
  DecimalString,
  HoldingFlag,
  InstrumentKind,
  PriceInfoDto,
  ReviewFlag,
} from '@joinr/schema';
import { Amount, StatusBadge } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { flagLabel } from '../records/cells';
import {
  HELD_UNDER_90_DAYS,
  HOLDING_FLAG_BADGES,
  formatHoldingPrice,
  formatRatio,
  isNegative,
} from './display';
import { KIND_META } from './kinds';

/** Integer cents, or a dash. Negatives use the stop tint only when `loss` (D33). */
export function MoneyCell({
  cents,
  loss = true,
}: {
  cents: number | null;
  /** A negative figure is a loss (red). False for flows such as net purchases. */
  loss?: boolean;
}): JSX.Element {
  return cents === null ? <Missing /> : <Amount cents={cents} colorNegative={loss} />;
}

/** A ratio at one decimal (or `dp`), or a dash. Negative returns use the stop tint when `loss`. */
export function RatioCell({
  ratio,
  loss = false,
  dp,
  signed = false,
}: {
  ratio: DecimalString | null;
  loss?: boolean;
  dp?: number;
  signed?: boolean;
}): JSX.Element {
  const text = formatRatio(ratio, { dp, signDisplay: signed ? 'always' : 'auto' });
  if (text === null) return <Missing />;
  return (
    <span className={loss && isNegative(ratio) ? 'jf-app-negative' : undefined}>
      {signed && Number(ratio) === 0 ? formatRatio(ratio, { dp }) : text}
    </span>
  );
}

/**
 * A dash with a reason as its tooltip and for screen readers. The span anchors the absolutely
 * positioned hidden text (`jf-app-anchor`), so inside a table that scrolls in its container the
 * text stays in that container and cannot widen the page.
 */
export function DashWithReason({ reason }: { reason: string }): JSX.Element {
  return (
    <span className="jf-app-muted jf-app-anchor" title={reason}>
      <span aria-hidden="true">—</span>
      <span className="jf-visually-hidden">{reason}</span>
    </span>
  );
}

/** Est. return / yr: the XIRR, or "—" with "Held under 90 days" (§6.3 item 4). */
export function XirrCell({
  xirr,
  hidden,
}: {
  xirr: DecimalString | null;
  hidden: boolean;
}): JSX.Element {
  if (hidden) return <DashWithReason reason={HELD_UNDER_90_DAYS} />;
  return <RatioCell ratio={xirr} loss />;
}

/** Holding flags as status badges (never colour alone: an icon and a word). */
export function HoldingFlagBadges({
  flags,
}: {
  flags: readonly HoldingFlag[];
}): JSX.Element | null {
  if (flags.length === 0) return null;
  return (
    <span className="jf-app-flags">
      {flags.map((flag) => (
        <StatusBadge
          key={flag}
          status={HOLDING_FLAG_BADGES[flag].status}
          label={HOLDING_FLAG_BADGES[flag].label}
        />
      ))}
    </span>
  );
}

/** Review flags on a ledger row, with the records page's words. */
export function ReviewFlagBadges({ flags }: { flags: readonly ReviewFlag[] }): JSX.Element | null {
  if (flags.length === 0) return null;
  return (
    <span className="jf-app-flags">
      {flags.map((flag) => (
        <StatusBadge key={flag} status="check" label={flagLabel(flag)} />
      ))}
    </span>
  );
}

/** The symbol (mono, a link to the holding's page) over its muted name. */
export function HoldingName({
  kind,
  instrumentId,
  symbol,
  name,
  children,
}: {
  kind: InstrumentKind;
  instrumentId: number;
  symbol: string;
  name?: string | null;
  children?: JSX.Element | null;
}): JSX.Element {
  return (
    <span className="jf-app-instrument">
      <Link
        to={KIND_META[kind].detailPath}
        params={{ instrumentId: String(instrumentId) }}
        className="jf-app-instrument__symbol jf-app-holding-link"
      >
        {symbol}
      </Link>
      {name ? <span className="jf-app-instrument__name">{name}</span> : null}
      {children}
    </span>
  );
}

/** The effective price; a manual price carries a "Manual" badge that links to /prices (§6.4). */
export function PriceCell({
  price,
  kind,
}: {
  price: PriceInfoDto;
  kind: InstrumentKind;
}): JSX.Element {
  const figure = price.price === null ? <Missing /> : formatHoldingPrice(price.price, kind);
  if (price.status !== 'manual') return <>{figure}</>;
  return (
    <span className="jf-app-price-cell">
      <span>{figure}</span>
      <Link to="/prices" className="jf-app-badge-link" aria-label="Manual price: see Prices">
        <StatusBadge status="go" label="Manual" />
      </Link>
    </span>
  );
}
