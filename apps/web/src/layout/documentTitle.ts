// The browser tab title: "<Page> · Joinr Finance", or the app name alone.
import { useEffect } from 'react';

export const APP_NAME = 'Joinr Finance';

export function documentTitle(page?: string): string {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

/** Sets `document.title` for a screen. `null` leaves it to an enclosing layout (e.g. the shell). */
export function useDocumentTitle(page: string | null): void {
  useEffect(() => {
    if (page !== null) document.title = documentTitle(page);
  }, [page]);
}
