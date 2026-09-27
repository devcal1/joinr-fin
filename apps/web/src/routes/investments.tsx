// Route modules for the four investment pages (stage-6.md §6.1): the router calls a lazy route
// component with no props, so each kind has its own no-props component here.
import type { JSX } from 'react';
import { InvestmentPage } from '../pages/investments/InvestmentPage';

export function StocksRoute(): JSX.Element {
  return <InvestmentPage kind="stock" />;
}

export function EtfsRoute(): JSX.Element {
  return <InvestmentPage kind="etf" />;
}

export function ManagedFundsRoute(): JSX.Element {
  return <InvestmentPage kind="managed_fund" />;
}

export function CryptoRoute(): JSX.Element {
  return <InvestmentPage kind="crypto" />;
}
