// The full-viewport brand screen preview's route module (stage-6.md §6.1). beforeLoad has already
// rejected unknown variants; the guard here only narrows the type. pages.ts keeps its own copy of
// the variant union (it stays dependency-free); the typed `variant` prop of ScreenPreviewPage
// (BrandScreenVariant) keeps the two in sync.
import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';
import { isScreenVariant } from '../pages';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ScreenPreviewPage } from '../pages/ScreenPreviewPage';

const route = getRouteApi('/preview/screen/$variant');

export function ScreenPreviewRoute(): JSX.Element {
  const { variant } = route.useParams();
  return isScreenVariant(variant) ? <ScreenPreviewPage variant={variant} /> : <NotFoundPage />;
}
