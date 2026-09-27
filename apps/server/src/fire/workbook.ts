// "Use the workbook's figure" (stage-6.md §3.3, §4.2, §4.5; owner question 1, D105): one IMMEDIATE
// transaction that flips an import-origin `fire.superContributionPerYearCents` row to origin 'app'
// (value unchanged, updated_at = now), so the FIRE page uses it as your setting. A PATCH cannot do
// this (it skips an unchanged value and keeps its origin, by design). Idempotent: no import row (no
// row, or already an app row) → nothing written. The key is a preference (D103), so `hasAppData`
// never changes. Answers the settings slice and `hasAppData` as a settings PATCH does; refused
// (409) while an upload import runs, as every mutation.
import type { SettingsPatchResponse } from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FinanceDeps } from '../cashflow/context';
import { assertNoImportRunning } from '../cashflow/mutations/common';
import { settingsResponse } from '../cashflow/responses';

const KEY = 'fire.superContributionPerYearCents';

/** Flips the import row's origin; true when a row was written. */
export function adoptWorkbookContribution(deps: Pick<FinanceDeps, 'database' | 'now'>): boolean {
  assertNoImportRunning();
  const updatedAt = deps.now().toISOString();
  return deps.database.db.transaction(
    (tx) =>
      tx
        .update(settings)
        .set({ origin: 'app', updatedAt })
        .where(and(eq(settings.key, KEY), eq(settings.origin, 'import')))
        .run().changes > 0,
    { behavior: 'immediate' },
  );
}

export function useWorkbookContribution(
  deps: FinanceDeps,
  log?: FastifyBaseLogger,
): SettingsPatchResponse {
  adoptWorkbookContribution(deps);
  return settingsResponse(deps, [KEY], log);
}
