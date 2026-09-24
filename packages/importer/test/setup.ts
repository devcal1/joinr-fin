// Vitest setup (importer): no network in unit tests. Any fetch() fails loudly.
globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.reject(new Error(`Network access is not allowed in unit tests (fetch ${url})`));
};
