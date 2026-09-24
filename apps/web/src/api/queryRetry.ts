// The app's query retry rule: one retry for network and server errors, none for 4xx answers
// (a missing run or a bad request will not change on a second try).
import { isApiError } from './client';

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}
