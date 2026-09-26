import { defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      // user-event form tests can pass 5 s under the full suite's load (Fixer round 1, CODE-7).
      testTimeout: 15_000,
    },
  }),
);
