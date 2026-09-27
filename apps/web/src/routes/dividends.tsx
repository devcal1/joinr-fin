// The Dividends route module (stage-6.md §6.1): reads the validated `?holding=` filter.
import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';
import { DividendsPage } from '../pages/dividends/DividendsPage';

const route = getRouteApi('/app/dividends');

export function DividendsRoute(): JSX.Element {
  const { holding } = route.useSearch();
  return holding === undefined ? <DividendsPage /> : <DividendsPage holding={holding} />;
}
