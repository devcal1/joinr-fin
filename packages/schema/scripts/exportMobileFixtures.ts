// Writes the Android unit tests' JSON copies of the phone-API fixtures (stage-9.md §3.6):
// every entry of ANDROID_FIXTURE_FILES to apps/android/app/src/test/resources/fixtures/<name>,
// formatted with the repo's Prettier config (so `pnpm format:check` stays green). Files in that
// folder that are not in the map are removed, so the folder always mirrors the map. The schema
// drift test parses each copy and deep-equals it with the TS fixture.
// Run from anywhere: `pnpm exec tsx packages/schema/scripts/exportMobileFixtures.ts`
// (the root `android:fixtures` script runs the same).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { ANDROID_FIXTURE_FILES } from '../src/fixtures/mobile';

/** The Android test resources folder the copies live in. */
export const ANDROID_FIXTURES_DIR = fileURLToPath(
  new URL('../../../apps/android/app/src/test/resources/fixtures', import.meta.url),
);

export async function exportMobileFixtures(dir = ANDROID_FIXTURES_DIR): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const config = (await prettier.resolveConfig(join(dir, 'x.json'))) ?? {};
  const written: string[] = [];
  for (const [name, value] of Object.entries(ANDROID_FIXTURE_FILES)) {
    const text = await prettier.format(JSON.stringify(value), { ...config, parser: 'json' });
    writeFileSync(join(dir, name), text);
    written.push(name);
  }
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json') && !(name in ANDROID_FIXTURE_FILES)) rmSync(join(dir, name));
  }
  return written;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const names = await exportMobileFixtures();
  const where = relative(process.cwd(), ANDROID_FIXTURES_DIR);
  process.stdout.write(`Wrote ${names.length} fixture files to ${where}\n`);
}
