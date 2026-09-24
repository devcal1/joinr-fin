// Shared jsdom setup for the web project (Scaffolder).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout: stub the browser APIs that components and ECharts touch.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

// No canvas in jsdom: getContext returns null (charts use the SVG renderer anyway).
HTMLCanvasElement.prototype.getContext = () => null;

// The router's scroll restoration calls window.scrollTo, which jsdom does not implement.
window.scrollTo = () => undefined;

// No network in unit tests: any fetch a test has not mocked (see mockApi.ts) fails like an
// unreachable server. Tests that talk to the API stub `fetch` themselves.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Network access is disabled in unit tests'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
