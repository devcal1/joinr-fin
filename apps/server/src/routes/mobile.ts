// The phone API (stage-9.md §4.1–§4.2, §6.3, FROZEN endpoints), one plugin under `/api`:
//   GET  /api/mobile/today   the device key → everything the app and widgets show
//   GET  /api/mobile/device  the device key → the paired device
//   GET  /api/mobile/periods the device key → the seven period figures (stage-10.md §4.1, §6.1)
//   POST /api/mobile/pair    no key (the one-time code) → 201 with the key, once
//   POST/PUT/PATCH/DELETE/OPTIONS /api/mobile/* (anything else) → 405 MOBILE_READ_ONLY, no key
// needed and nothing runs. Fastify adds HEAD for the GETs. Every path is one segment below
// `/api/mobile/` and nothing takes a query string. `GET /api/mobile/<anything else>` is the
// ordinary JSON 404 (the root not-found handler; no key check).
//
// The plugin's `onRequest` hook checks the key for the keyed GETs (and their HEADs); the plugin
// declares every route it adds in `declared`, which the root `onRoute` guard in app.ts checks so a
// route under `/api/mobile` from any other plugin fails at start-up (deny by default, §6.3).
//
// Never logged: a key, a key hash, a code or the pair body (§6.8).
import {
  MOBILE_API_VERSION,
  PAIR_BODY_LIMIT_BYTES,
  type MobileDeviceResponse,
  type MobilePeriodsResponse,
  type MobileTodayResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { FinanceDeps } from '../cashflow/context';
import { errorBody } from '../errors';
import type { KeyCheck } from '../mobile/auth';
import type { DeviceRecord } from '../mobile/devices';
import type { PairingService } from '../mobile/pairing';
import { buildMobilePeriods } from '../mobile/periods';
import { MobileError } from '../mobile/sentences';
import { buildMobileToday } from '../mobile/today';

declare module 'fastify' {
  interface FastifyRequest {
    /** Stage 9 (stage-9.md §6.3): the device whose key the mobile hook accepted. */
    mobileDevice: DeviceRecord | null;
  }
}

/** The methods the read-only catch-all answers with 405. */
export const MOBILE_CATCH_ALL_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** The routes (after the `/api` prefix) that need a device key. */
const KEYED_URLS = new Set(['/api/mobile/today', '/api/mobile/device', '/api/mobile/periods']);

export interface MobileRoutesOptions {
  deps: FinanceDeps;
  keyCheck: KeyCheck;
  pairing: PairingService;
  /** The server's IANA zone. */
  timeZone: string;
  version: string;
  yahooCooling: (now: Date) => boolean;
  /** `METHOD /full/path` of every route this plugin adds (the root onRoute guard reads it). */
  declared: Set<string>;
}

/** Sends a §4.5 error (with `Retry-After` on a 429 and `Allow` on the 405). */
export function sendMobileError(reply: FastifyReply, err: MobileError): FastifyReply {
  if (err.retryAfterSeconds !== null) reply.header('retry-after', String(err.retryAfterSeconds));
  if (err.statusCode === 405) reply.header('allow', 'GET, HEAD');
  return reply
    .code(err.statusCode)
    .type('application/json; charset=utf-8')
    .send(errorBody(err.code, err.message));
}

export const mobileRoutes: FastifyPluginAsync<MobileRoutesOptions> = async (app, opts) => {
  const declare = (methods: readonly string[], url: string): void => {
    for (const m of methods) opts.declared.add(`${m} /api${url}`);
  };

  app.decorateRequest('mobileDevice', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!KEYED_URLS.has(request.routeOptions.url ?? '')) return;
    try {
      request.mobileDevice = opts.keyCheck.check(request.headers);
    } catch (err) {
      if (err instanceof MobileError) return sendMobileError(reply, err);
      throw err;
    }
  });

  declare(['GET', 'HEAD'], '/mobile/today');
  app.get('/mobile/today', async (request): Promise<MobileTodayResponse> =>
    buildMobileToday({
      deps: opts.deps,
      timeZone: opts.timeZone,
      serverVersion: opts.version,
      yahooCooling: opts.yahooCooling,
      log: request.log,
    }),
  );

  // Stage 10 (stage-10.md §6.1): the seven periods, read-only, under the same key.
  declare(['GET', 'HEAD'], '/mobile/periods');
  app.get('/mobile/periods', async (request): Promise<MobilePeriodsResponse> =>
    buildMobilePeriods({
      deps: opts.deps,
      timeZone: opts.timeZone,
      serverVersion: opts.version,
      yahooCooling: opts.yahooCooling,
      log: request.log,
    }),
  );

  declare(['GET', 'HEAD'], '/mobile/device');
  app.get('/mobile/device', async (request): Promise<MobileDeviceResponse> => {
    const device = request.mobileDevice!;
    return {
      apiVersion: MOBILE_API_VERSION,
      serverVersion: opts.version,
      deviceId: device.id,
      label: device.label,
      pairedAt: device.pairedAt,
      timeZone: opts.timeZone,
    };
  });

  declare(['POST'], '/mobile/pair');
  app.post('/mobile/pair', { bodyLimit: PAIR_BODY_LIMIT_BYTES }, async (request, reply) => {
    try {
      const body = opts.pairing.exchange(request.body);
      return reply.code(201).send(body);
    } catch (err) {
      if (err instanceof MobileError) return sendMobileError(reply, err);
      throw err;
    }
  });

  declare(MOBILE_CATCH_ALL_METHODS, '/mobile/*');
  app.route({
    method: [...MOBILE_CATCH_ALL_METHODS],
    url: '/mobile/*',
    handler: async (_request, reply) => sendMobileError(reply, new MobileError('MOBILE_READ_ONLY')),
  });
};

/**
 * A route path as the deny-by-default guard compares it: percent-decoded (repeatedly), `\` as
 * `/`, repeated slashes collapsed, lower case.
 */
export function guardPath(url: string): string {
  let path = url;
  for (let i = 0; i < 4; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break;
    }
    if (decoded === path) break;
    path = decoded;
  }
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

/**
 * The root `onRoute` guard (§6.3): throws when a route under `/api/mobile` is not one the mobile
 * plugin declared (a HEAD route is allowed when its GET was declared).
 */
export function assertDeclaredMobileRoute(
  declared: ReadonlySet<string>,
  route: { method: string | string[]; url: string },
): void {
  if (!guardPath(route.url).startsWith('/api/mobile')) return;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    const m = method.toUpperCase();
    if (declared.has(`${m} ${route.url}`)) continue;
    if (m === 'HEAD' && declared.has(`GET ${route.url}`)) continue;
    throw new Error(
      `Route ${m} ${route.url} is under /api/mobile but not declared by the mobile plugin ` +
        '(stage-9.md §6.3: deny by default)',
    );
  }
}
