// The record table route module (stage-6.md §6.1). beforeLoad has already rejected unknown ids;
// the guard here only narrows the type.
import { isRecordEntityId } from '@joinr/schema';
import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RecordsEntityPage } from '../pages/records/RecordsEntityPage';

const route = getRouteApi('/app/records/$entity');

export function RecordsEntityRoute(): JSX.Element {
  const { entity } = route.useParams();
  return isRecordEntityId(entity) ? <RecordsEntityPage entity={entity} /> : <NotFoundPage />;
}
