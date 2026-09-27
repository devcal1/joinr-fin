// Route modules for a holding's detail page under each investment path (stage-6.md §6.1). The
// route's beforeLoad accepts a positive integer only; the guard here only narrows the type.
import type { InstrumentKind } from '@joinr/schema';
import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';
import { HoldingDetailPage } from '../pages/investments/HoldingDetailPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { POSITIVE_INT_RE } from './params';

function detail(kind: InstrumentKind, instrumentId: string): JSX.Element {
  return POSITIVE_INT_RE.test(instrumentId) ? (
    <HoldingDetailPage key={instrumentId} kind={kind} instrumentId={Number(instrumentId)} />
  ) : (
    <NotFoundPage />
  );
}

const stockDetail = getRouteApi('/app/stocks/$instrumentId');
const etfDetail = getRouteApi('/app/etfs/$instrumentId');
const managedFundDetail = getRouteApi('/app/managed-funds/$instrumentId');
const cryptoDetail = getRouteApi('/app/crypto/$instrumentId');

export function StockDetailRoute(): JSX.Element {
  return detail('stock', stockDetail.useParams().instrumentId);
}

export function EtfDetailRoute(): JSX.Element {
  return detail('etf', etfDetail.useParams().instrumentId);
}

export function ManagedFundDetailRoute(): JSX.Element {
  return detail('managed_fund', managedFundDetail.useParams().instrumentId);
}

export function CryptoDetailRoute(): JSX.Element {
  return detail('crypto', cryptoDetail.useParams().instrumentId);
}
