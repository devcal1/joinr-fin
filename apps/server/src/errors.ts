// The API's JSON error shape: `{ error: { code, message } }`.
import { STATUS_CODES } from 'node:http';
import type { ApiErrorBody } from '@joinr/schema';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export type { ApiErrorBody } from '@joinr/schema';

/**
 * An error a route throws on purpose; its message is safe to show to the client. A 5xx is answered
 * with a generic message unless it is created with `expose: true` (a message written for clients,
 * e.g. the recorder's 503 on shutdown, §4.6 item 8), which is then logged at warn level.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** A 5xx whose code and message reach the client as they are. */
  readonly expose: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: string = codeForStatus(statusCode),
    options: { expose?: boolean } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? false;
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

/** One line per issue: `path: message` (the path is omitted for the root). */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Validates a request body, query or params with a Zod schema and returns the parsed value;
 * throws `HttpError(400, <issues>, 'VALIDATION_ERROR')` when it does not match.
 */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, formatIssues(result.error.issues), 'VALIDATION_ERROR');
  return result.data;
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
 * Fastify's `frameworkErrors` option: errors the router raises before any route or hook runs
 * (a path parameter over `maxParamLength`, a malformed URL) are answered in the Stage 0 shape
 * instead of Fastify's own body, and never echo the URL. A too-long parameter is a 400
 * `VALIDATION_ERROR`: under `/api/backups/` it is "Not a backup file name" (stage-7.md §4.1: a
 * name over 64 characters), elsewhere a generic message.
 */
export function frameworkErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal server error';
  if (error.code === 'FST_ERR_MAX_PARAM_LENGTH') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = (request.raw.url ?? '').startsWith('/api/backups/')
      ? 'Not a backup file name'
      : 'A path parameter is too long';
  } else if (error.code === 'FST_ERR_BAD_URL') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Not a valid URL';
  } else {
    request.log.error({ code: error.code }, 'request failed in the router');
  }
  void reply
    .code(status)
    // The app's onSend hook does not run for the router's own errors: its headers are set here.
    .headers({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
    })
    .type('application/json; charset=utf-8')
    .send(errorBody(code, message));
}

/**
 * Installs the JSON error handler. 4xx errors keep their message (Fastify's own messages, e.g.
 * body validation, are written for clients); 5xx errors are logged in full and answered with a
 * generic message so no internals (paths, SQL, stack) leak, except an `HttpError` created with
 * `expose: true` (its code and message, logged at warn with no figures).
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const status = err instanceof HttpError ? err.statusCode : statusOf(err);
    if (status >= 500 && err instanceof HttpError && err.expose) {
      request.log.warn({ code: err.code }, err.message);
      return reply.code(status).send(errorBody(err.code, err.message));
    }
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      return reply.code(status).send(errorBody(codeForStatus(status), 'Internal server error'));
    }
    const code = err instanceof HttpError ? err.code : codeForStatus(status);
    return reply.code(status).send(errorBody(code, err.message || STATUS_CODES[status] || 'Error'));
  });
}
