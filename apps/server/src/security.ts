// The cross-site write guard (stage-7.md §5.8): an `onRequest` hook on `/api/*` for POST, PUT,
// PATCH and DELETE, registered first in buildApp.
//
//   1. `Sec-Fetch-Site` present → allowed only when `same-origin` or `none`.
//   2. `Sec-Fetch-Site` absent (the production case: browsers send Fetch Metadata only to HTTPS or
//      localhost origins, and the app is served over plain HTTP) and an `Origin` present
//      (`Origin: null` is always refused) → allowed only when the Origin's host:port (default port
//      filled in) equals the request's `Host`, or its `X-Forwarded-Host` (with `X-Forwarded-Port`
//      when given), or, when `PUBLIC_PORT` is set, the Origin's port equals it AND its host is the
//      host the browser used (see `publicPortAllows`); outside production a loopback Origin (any
//      port) is also allowed (the Vite proxy rewrites `Host`).
//   3. Neither header (curl, `app.inject`, the CLIs) → allowed.
//
// "Under /api" is decided on the route that will actually run (Fastify's matched route pattern)
// and on the percent-decoded path, never on the raw URL: the router decodes `/%61pi/backups` to
// the `/api/backups` route, so a raw-URL test could be bypassed (Fixer SPEC-1/F1).
//
// A refusal logs the method and the three header values, never a path or a query.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import { errorBody } from './errors';
import { isApiPath as isApiPathname, pathnameOf } from './web';

export const CROSS_SITE_MESSAGE = 'Requests from another site are refused';

const GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A host and an effective port, lower case. */
interface HostPort {
  host: string;
  port: string;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? undefined : first.split(',')[0]?.trim();
}

/** An Origin header → its host and effective port; null when it is not an http(s) origin. */
export function parseOrigin(origin: string): (HostPort & { scheme: string }) | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const fallback = DEFAULT_PORTS[url.protocol];
  if (fallback === undefined || url.hostname === '') return null;
  return { host: url.hostname.toLowerCase(), port: url.port || fallback, scheme: url.protocol };
}

/** A `Host`-style value (`name[:port]`) → its host and port, the port defaulting to `defaultPort`. */
export function parseHostHeader(value: string, defaultPort: string): HostPort | null {
  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    return null;
  }
  if (url.hostname === '' || url.pathname !== '/' || url.username !== '' || url.search !== '') {
    return null;
  }
  // `new URL` drops the default port 80 of http: keep it only when it was written.
  const written = /:(\d+)$/.exec(value)?.[1];
  return { host: url.hostname.toLowerCase(), port: written ?? (url.port || defaultPort) };
}

const same = (a: HostPort | null, b: HostPort): boolean =>
  a !== null && a.host === b.host && Number(a.port) === Number(b.port);

/** The servers that logged the port-only form of the `PUBLIC_PORT` rule (once each, §12). */
const portOnlyLogged = new WeakSet<object>();

/**
 * The `PUBLIC_PORT` form of rule 2 (Umbrel's app_proxy may rewrite `Host` to the container's
 * name and port). The Origin's port must equal `publicPort`, and its host must be the host the
 * browser used, whatever the port:
 * - `X-Forwarded-Host` present → the Origin's host must equal its host;
 * - else `Host` still on `publicPort` (not rewritten) → the Origin's host must equal its host
 *   (the exact host:port rule above has then already decided a matching Origin);
 * - else (`Host` rewritten and no `X-Forwarded-Host`) the proxy passes nothing that names the
 *   browser's host, and the port alone decides: the accepted residual risk of §12, logged once.
 */
function publicPortAllows(
  request: FastifyRequest,
  o: HostPort,
  forwardedHost: string | undefined,
  config: Pick<Config, 'publicPort'>,
): boolean {
  if (config.publicPort === null || Number(o.port) !== config.publicPort) return false;
  if (forwardedHost !== undefined) {
    return parseHostHeader(forwardedHost, o.port)?.host === o.host;
  }
  const hostValue = header(request, 'host');
  const host = hostValue === undefined ? null : parseHostHeader(hostValue, '80');
  if (host !== null && Number(host.port) === config.publicPort) return host.host === o.host;
  if (!portOnlyLogged.has(request.server)) {
    portOnlyLogged.add(request.server);
    request.log.info(
      { host: hostValue ?? null, forwardedHost: null },
      'write guard: the proxy rewrote Host and sent no X-Forwarded-Host; the public port alone decides',
    );
  }
  return true;
}

/** Rule 2: whether an `Origin` (no `Sec-Fetch-Site`) may write. */
export function originAllowed(
  request: FastifyRequest,
  origin: string,
  config: Pick<Config, 'nodeEnv' | 'publicPort'>,
): boolean {
  if (origin === 'null') return false;
  const o = parseOrigin(origin);
  if (o === null) return false;
  const fallback = DEFAULT_PORTS[o.scheme] ?? '80';
  const host = header(request, 'host');
  if (host !== undefined && same(parseHostHeader(host, fallback), o)) return true;
  const forwardedHost = header(request, 'x-forwarded-host');
  if (forwardedHost !== undefined) {
    const forwarded = parseHostHeader(forwardedHost, fallback);
    const forwardedPort = header(request, 'x-forwarded-port');
    if (forwarded !== null && forwardedPort !== undefined && /^\d{1,5}$/.test(forwardedPort)) {
      forwarded.port = forwardedPort;
    }
    if (same(forwarded, o)) return true;
  }
  if (publicPortAllows(request, o, forwardedHost, config)) return true;
  if (config.nodeEnv !== 'production' && LOOPBACK_HOSTS.has(o.host)) return true;
  return false;
}

/**
 * True when the request is for `/api` or below: the matched route's pattern is, or the path,
 * percent-decoded (repeatedly, so `%2561` counts too) and without its query, is. A path that
 * cannot be decoded counts as API (refused rather than let through).
 */
export function isApiRequest(request: Pick<FastifyRequest, 'url' | 'routeOptions'>): boolean {
  const route = request.routeOptions?.url;
  if (typeof route === 'string' && isApiPathname(route)) return true;
  let path = pathnameOf(request.url);
  for (let i = 0; i < 4; i += 1) {
    if (isApiPathname(path)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return true;
    }
    if (decoded === path) return false;
    path = decoded;
  }
  return true;
}

/** Whether the guard lets this request through. */
export function writeAllowed(
  request: FastifyRequest,
  config: Pick<Config, 'nodeEnv' | 'publicPort'>,
): boolean {
  if (!GUARDED_METHODS.has(request.method) || !isApiRequest(request)) return true;
  const site = header(request, 'sec-fetch-site');
  if (site !== undefined) return ALLOWED_FETCH_SITES.has(site.toLowerCase());
  const origin = header(request, 'origin');
  if (origin !== undefined) return originAllowed(request, origin, config);
  return true;
}

/** Registers the guard (call it first in buildApp, before any route). */
export function registerWriteGuard(
  app: FastifyInstance,
  config: Pick<Config, 'nodeEnv' | 'publicPort'>,
): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (writeAllowed(request, config)) return;
    request.log.warn(
      {
        method: request.method,
        secFetchSite: header(request, 'sec-fetch-site') ?? null,
        origin: header(request, 'origin') ?? null,
        host: header(request, 'host') ?? null,
      },
      'cross-site write refused',
    );
    return reply
      .code(403)
      .type('application/json; charset=utf-8')
      .send(errorBody('CROSS_SITE_REQUEST', CROSS_SITE_MESSAGE));
  });
}
