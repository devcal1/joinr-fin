// The deploy scripts' tests (stage-7.md §8.4): Vitest project `deploy`, picked up by the root
// `tools/*` glob. A `.mjs` config so this folder needs no package.json or tsconfig.
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'deploy',
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
});
