// drizzle-kit is used only to generate SQL migrations (`pnpm --filter @joinr/server db:generate`).
// The server applies them at start-up with drizzle-orm's migrator. The tables live in
// @joinr/schema (packages/schema/src/db/tables); those files import only drizzle-orm, the enums
// module and each other, so drizzle-kit can load them directly.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: '../../packages/schema/src/db/tables/*.ts',
  out: './migrations',
});
