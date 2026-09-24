// drizzle-kit is used only to generate SQL migrations (`pnpm --filter @joinr/server db:generate`).
// The server applies them at start-up with drizzle-orm's migrator.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
