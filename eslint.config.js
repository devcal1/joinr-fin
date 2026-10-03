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
    // Kotlin and Gradle (stage-9.md §7.4): nothing for ESLint there.
    'apps/android/',
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

  // The engine is pure (stage-2.md §2.1): no clock, no I/O, the @joinr/schema root only.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'The engine has no clock: take "today" from the asOf input (stage-2.md §2.1).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'The engine has no clock: take "today" from the asOf input (stage-2.md §2.1).',
        },
        {
          selector: 'ImportDeclaration[source.value=/^node:/]',
          message:
            'The engine is pure and bundles for the browser: no node modules (stage-2.md §2.1).',
        },
        {
          selector: 'ImportDeclaration[source.value=/^drizzle-orm(\\/|$)/]',
          message: 'The engine never touches the database: no drizzle-orm (stage-2.md §2.1).',
        },
        {
          selector:
            "ImportDeclaration[source.value='@joinr/schema/db'], ImportDeclaration[source.value='@joinr/schema/testing']",
          message: 'The engine imports the @joinr/schema root entry only (stage-2.md §2.1).',
        },
        // Purity hardening (stage-3.md §2.1): no timers, dynamic loading, randomness, host time
        // zone or locale.
        {
          selector:
            'CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate|queueMicrotask|require)$/]',
          message: 'The engine is pure: no timers and no require (stage-3.md §2.1).',
        },
        {
          selector: 'ImportExpression',
          message: 'The engine is pure: no dynamic import() (stage-3.md §2.1).',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'The engine is pure: no randomness (stage-3.md §2.1).',
        },
        {
          selector: "MemberExpression[object.name='crypto']",
          message: 'The engine is pure: no crypto API (stage-3.md §2.1).',
        },
        {
          selector: "MemberExpression[object.name='performance']",
          message: 'The engine has no clock: no performance timers (stage-3.md §2.1).',
        },
        {
          selector: "Identifier[name='globalThis']",
          message: 'The engine is pure: no globalThis (stage-3.md §2.1).',
        },
        {
          selector: "MemberExpression[object.name='Intl']",
          message: 'The engine reads no host time zone or locale: no Intl (stage-3.md §2.1).',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='parse']",
          message:
            'The engine parses dates as ISO strings, never with Date.parse (stage-3.md §2.1).',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds|toLocaleString|toLocaleDateString|toLocaleTimeString|localeCompare|toDateString|toTimeString)$/]',
          message:
            'The engine uses no local-time or locale API: use the getUTC*/setUTC* forms (stage-3.md §2.1).',
        },
        {
          // new Date(y, m, d) reads the host time zone; new Date(0) and new Date(ms) do not.
          selector: "NewExpression[callee.name='Date'][arguments.length>1]",
          message:
            'The engine uses no local-time Date constructor: build dates from UTC day numbers (stage-3.md §2.1).',
        },
        {
          // A date-time string without a zone parses as local time ('2026-01-01' alone is UTC).
          selector:
            "NewExpression[callee.name='Date'] > Literal[value=/T\\d/], NewExpression[callee.name='Date'] > TemplateLiteral",
          message: 'The engine parses no date-time strings (stage-3.md §2.1).',
        },
      ],
    },
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
