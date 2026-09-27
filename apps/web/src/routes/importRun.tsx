// The import run route module (stage-6.md §6.1): beforeLoad accepts a positive integer only.
import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';
import { ImportRunPage } from '../pages/import/ImportRunPage';

const route = getRouteApi('/app/import/runs/$runId');

export function ImportRunRoute(): JSX.Element {
  const { runId } = route.useParams();
  return <ImportRunPage key={runId} runId={Number(runId)} />;
}
