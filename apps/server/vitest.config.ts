import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // The first test in a file builds the app cold (migrations, plugins); under heavy machine load
    // that can pass the 5 s default, so the whole project gets more room (no test semantics change).
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
