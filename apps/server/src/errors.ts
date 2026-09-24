// The API's JSON error shape: `{ error: { code, message } }`.
import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** An error a route throws on purpose; its message is safe to show to the client. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, message: string, code: string = codeForStatus(statusCode)) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** 404 → "NOT_FOUND", 500 → "INTERNAL_SERVER_ERROR", unknown → "ERROR". */
export function codeForStatus(statusCode: number): string {
  const text = STATUS_CODES[statusCode];
  if (!text) return 'ERROR';
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function sendNotFoundJson(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .type('application/json; charset=utf-8')
    .send(errorBody('NOT_FOUND', `No route for ${request.method} ${request.url.split('?')[0]}`));
}

function statusOf(err: FastifyError): number {
  const status = err.statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
}

/**
 * Installs the JSON error handler. 4xx errors keep their message (Fastify's own messages, e.g.
 * body validation, are written for clients); 5xx errors are logged in full and answered with a
 * generic message so no internals (paths, SQL, stack) leak.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const status = err instanceof HttpError ? err.statusCode : statusOf(err);
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      return reply.code(status).send(errorBody(codeForStatus(status), 'Internal server error'));
    }
    const code = err instanceof HttpError ? err.code : codeForStatus(status);
    return reply.code(status).send(errorBody(code, err.message || STATUS_CODES[status] || 'Error'));
  });
}
