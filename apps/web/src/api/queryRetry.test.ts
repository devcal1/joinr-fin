import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { shouldRetryQuery } from './queryRetry';

describe('shouldRetryQuery', () => {
  it('never retries a 4xx answer (a missing run will not appear on a second try)', () => {
    expect(shouldRetryQuery(0, new ApiError(404, 'NOT_FOUND', 'Import run 9 not found'))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new ApiError(400, 'VALIDATION_ERROR', 'Bad'))).toBe(false);
  });

  it('retries server and network errors once', () => {
    const serverError = new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
    expect(shouldRetryQuery(0, serverError)).toBe(true);
    expect(shouldRetryQuery(1, serverError)).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});
