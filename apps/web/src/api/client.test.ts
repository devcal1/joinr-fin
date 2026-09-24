import { apiErrors, appStatusPopulated } from '@joinr/schema/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import {
  ApiError,
  apiGet,
  apiSend,
  apiUpload,
  errorMessage,
  isApiError,
  withQuery,
} from './client';

describe('api client', () => {
  it('GETs JSON', async () => {
    const api = mockApi({ 'GET /api/status': { body: appStatusPopulated } });
    await expect(apiGet('/api/status')).resolves.toEqual(appStatusPopulated);
    expect(api.requests[0]?.headers.accept).toBe('application/json');
  });

  it('turns an error body into an ApiError with status, code and message', async () => {
    mockApi({ 'POST /api/import': apiError(409, apiErrors.confirmRequired) });
    const error: unknown = await apiSend('POST', '/api/import').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 409,
      code: 'IMPORT_CONFIRM_REQUIRED',
      message: 'Imported data exists; confirm to replace it',
    });
    expect(errorMessage(error)).toBe('Imported data exists; confirm to replace it');
  });

  it('copes with a non-JSON error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 502 }))),
    );
    await expect(apiGet('/api/prices')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
    });
  });

  it('rejects a 2xx response that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html></html>'))),
    );
    await expect(apiGet('/api/prices')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports an unreachable server as status 0', async () => {
    // The test setup's default fetch rejects like a network failure.
    const error = await apiGet('/api/status').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('sends JSON bodies with a content type, and none without a body', async () => {
    const api = mockApi({
      'PUT /api/prices/1/manual': { body: {} },
      'DELETE /api/prices/1/manual': { body: {} },
    });
    await apiSend('PUT', '/api/prices/1/manual', { price: '12.5', asOf: '2026-09-24' });
    await apiSend('DELETE', '/api/prices/1/manual');
    const [put, del] = api.requests;
    expect(put?.headers['content-type']).toBe('application/json');
    expect(put?.body).toEqual({ price: '12.5', asOf: '2026-09-24' });
    expect(del?.headers['content-type']).toBeUndefined();
    expect(del?.body).toBeUndefined();
  });

  it('uploads raw bytes with the encoded file name and the query', async () => {
    const api = mockApi({ 'POST /api/import': { status: 201, body: { id: 1 } } });
    const file = new File([new Uint8Array([1, 2, 3])], 'My Workbook.xlsx');
    await apiUpload('/api/import', file, { dryRun: 'true', confirmReplace: undefined });
    const [request] = api.requests;
    expect(request?.method).toBe('POST');
    expect(request?.query.get('dryRun')).toBe('true');
    expect(request?.query.has('confirmReplace')).toBe(false);
    expect(request?.headers['content-type']).toBe('application/octet-stream');
    expect(request?.headers['x-file-name']).toBe('My%20Workbook.xlsx');
    expect(request?.body).toBe(file);
  });

  it('builds query strings', () => {
    expect(withQuery('/api/import')).toBe('/api/import');
    expect(withQuery('/api/import', {})).toBe('/api/import');
    expect(withQuery('/api/import', { dryRun: true, n: 2, skip: undefined })).toBe(
      '/api/import?dryRun=true&n=2',
    );
  });

  it('has a fallback message for unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('x')).toBe('Something went wrong.');
  });
});
