import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    'artifacts/',
    'data/',
    'reference/',
    'docs/private/',
    '**/coverage/',
    'playwright-report/',
    'test-results/',
    'apps/server/migrations/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Browser code: the UI library and the web app.
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactRefresh.configs.vite],
  },

  // Node code: server, tools, the non-UI packages, root and build configs, e2e.
  {
    files: [
      '**/*.{js,mjs,cjs}',
      '*.ts',
      'e2e/**/*.ts',
      'apps/server/**/*.ts',
      'tools/**/*.ts',
      'packages/{engine,schema,importer}/**/*.ts',
      '**/vite.config.ts',
      '**/vitest.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  {
    rules: {
      '@typescript-eslint/require-await': 'off', // Fastify handlers are async by convention
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TanStack Router's documented control flow: `throw notFound()` / `throw redirect()`.
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'package',
              package: '@tanstack/router-core',
              name: ['NotFoundError', 'Redirect'],
            },
          ],
        },
      ],
    },
  },

  prettier,
]);
