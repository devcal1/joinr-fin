// Serving the built React SPA in production (stage-0.md §6.7 step 4).
import { existsSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendNotFoundJson } from './errors';

/** Vite puts content-hashed files under `assets/`, so they can be cached forever. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Everything else (index.html, favicon) must be revalidated so new deploys show up at once. */
export const REVALIDATE_CACHE = 'no-cache';

/** Throws a clear start-up error when the SPA build is missing. */
export function assertWebDist(webDistDir: string): void {
  if (!existsSync(join(webDistDir, 'index.html'))) {
    throw new Error(
      `The web app build is missing: no index.html in ${webDistDir}. ` +
        'Run "pnpm build", set WEB_DIST_DIR, or set SERVE_WEB=false.',
    );
  }
}

/** Cache-Control for a file path relative to the dist folder (either slash style). */
export function cacheControlFor(relativePath: string): string {
  const normalised = relativePath.split(sep).join('/').replace(/^\/+/, '');
  return normalised.startsWith('assets/') ? IMMUTABLE_CACHE : REVALIDATE_CACHE;
}

/** The path part of a request URL, without the query string or fragment. */
export function pathnameOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * `/api` and `/api/*`, also when written non-canonically (`//api/x`, `/API/x`, `/api%2Fx`), so a
 * client or proxy that builds such a path gets a JSON 404 rather than the SPA's index.html.
 */
export function isApiPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: check the raw path.
  }
  return /^\/+api(?:\/|$)/i.test(decoded.replace(/\\/g, '/'));
}

/** File types the web build (or a browser asking for one) serves as static files. */
const STATIC_FILE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'css', 'map', 'wasm', 'json', 'txt', 'xml', 'html', 'webmanifest',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf',
  'csv', 'pdf', 'zip',
]); // prettier-ignore

/**
 * True for a request that can only be for a static file: anything under `/assets/`, or a last
 * segment with a known file extension ("app.js", "logo.svg"). A dotted route parameter such as
 * a market symbol ("/stocks/ABC.AX") is not a file and still gets the SPA.
 */
export function isStaticFilePath(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true;
  const extension = posix.extname(posix.basename(pathname)).slice(1).toLowerCase();
  return extension !== '' && STATIC_FILE_EXTENSIONS.has(extension);
}

/**
 * Registers one static route per file in `webDistDir` (`wildcard: false`: the build is fixed
 * once the server starts) with per-file Cache-Control.
 */
export async function registerWebApp(app: FastifyInstance, webDistDir: string): Promise<void> {
  assertWebDist(webDistDir);
  await app.register(fastifyStatic, {
    root: webDistDir,
    wildcard: false,
    cacheControl: false, // set per file below
    setHeaders(reply, filePath) {
      reply.header('cache-control', cacheControlFor(relative(webDistDir, filePath)));
    },
  });
}

/**
 * The not-found handler.
 * - `/api` and `/api/*`, and any method other than GET/HEAD → JSON 404.
 * - With the SPA on: a static-file path (`/assets/*` or a known file extension) → plain-text 404
 *   (a missing asset must never receive index.html); any other path, including a dotted route
 *   parameter, → index.html, and the client router takes over.
 */
export function createNotFoundHandler(serveWeb: boolean) {
  return function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    const pathname = pathnameOf(request.url);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (!serveWeb || !isRead || isApiPath(pathname)) {
      return sendNotFoundJson(request, reply);
    }
    if (isStaticFilePath(pathname)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    }
    return reply.sendFile('index.html');
  };
}
