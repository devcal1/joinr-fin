// Entry point: `tsx tools/privacy-guard/src/cli.ts --staged | --all` (see main.ts).
// Run by .githooks/pre-commit and the root `guard` / `guard:all` scripts.
import { main } from './main';

process.exitCode = await main(process.argv.slice(2));
