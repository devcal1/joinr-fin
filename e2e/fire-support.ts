// Shared e2e helpers for the FIRE page (stage-6.md §7.5 step 4). Drafted by web-fire (phase A); the
// Integrator owns and finishes them. `mockFirePage` answers `GET /api/fire` from a fixture (every
// query too, or per query through a handler), so fixture states never touch data. The mutating
// spec writes only the two app-only FIRE keys and sets them back to null (`resetFireAppOnlyKeys`).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { FirePageResponse } from '../packages/schema/src/dto/fire';
import type { SettingsPageResponse } from '../packages/schema/src/dto/settings';

export const FIRE_PATH = '/fire';
export const FIRE_API = '/api/fire';

/** The two app-only FIRE keys the mutating spec may write (both reset to null afterwards). */
export const FIRE_APP_ONLY_KEYS = ['fire.marketReturn', 'fire.extraSavingsPerYearCents'] as const;

/** The viewports the fixture states are shot at (the project's own, plus 1024 on desktop). */
export const FIRE_WIDTHS = { desktop: [1440, 1024], phone: [375] } as const;

/**
 * Renders a fixture-only FIRE state in a real browser: `GET /api/fire` answers `fixture` (for any
 * query), or `handler(query)` when given a function. The rest of the API stays live.
 */
export async function mockFirePage(
  page: Page,
  fixture: FirePageResponse | ((query: URLSearchParams) => FirePageResponse),
): Promise<void> {
  await page.route(
    (url) => url.pathname === FIRE_API,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const query = new URL(route.request().url()).searchParams;
      const body = typeof fixture === 'function' ? fixture(query) : fixture;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    },
  );
}

async function mustGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

/** `GET /api/fire` (the saved plan); fails the run on the scaffold's 501 (never skips). */
export function firePage(request: APIRequestContext, query = ''): Promise<FirePageResponse> {
  return mustGet<FirePageResponse>(request, query ? `${FIRE_API}?${query}` : FIRE_API);
}

/** Every stored `fire.*` value, by key (the what-if must leave these unchanged). */
export async function fireSettings(request: APIRequestContext): Promise<Record<string, unknown>> {
  const page = await mustGet<SettingsPageResponse>(request, '/api/settings');
  const values: Record<string, unknown> = {};
  for (const setting of page.settings) {
    if (setting.key.startsWith('fire.')) values[setting.key] = setting.value;
  }
  return values;
}

/** Sets the two app-only FIRE keys back to null (safe to repeat). */
export async function resetFireAppOnlyKeys(request: APIRequestContext): Promise<void> {
  const values = Object.fromEntries(FIRE_APP_ONLY_KEYS.map((key) => [key, null]));
  const response = await request.patch('/api/settings', { data: { values } });
  expect(response.status(), await response.text()).toBe(200);
}

/** The first tile's words for a response (what the page should show). */
export function yearsToFireText(page: FirePageResponse): RegExp {
  const { projection } = page;
  switch (projection.status) {
    case 'on_track': {
      const years = projection.fire?.yearsToGo ?? 0;
      return new RegExp(`${years} ${years === 1 ? 'year' : 'years'}`);
    }
    case 'fire':
      return /You’re FIRE/;
    case 'not_reachable':
      return /Not by 100/;
    default:
      return /—/;
  }
}

/** The result strip's leading words for a response. */
export function stripText(page: FirePageResponse): RegExp {
  const fire = page.projection.fire;
  if (page.projection.status === 'on_track' && fire) {
    return new RegExp(`^FIRE in ${fire.year} · age ${fire.age}`);
  }
  return /./;
}
