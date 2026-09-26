// Shared request-field schemas (stage-5.md §3.2): moved from dto/assets.ts so the Stage 4 and
// Stage 5 request schemas share one definition (unchanged behaviour).
import { z } from 'zod';
import { CASHFLOW_MONEY_MAX } from './cashflow';

/** Trimmed text; `''` → null (so a blank field never fails or flips `origin`). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `must be at most ${max} characters` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** Integer cents, −CASHFLOW_MONEY_MAX … CASHFLOW_MONEY_MAX ($100m either way). */
export const signedCents = z
  .number()
  .int({ error: 'must be whole cents' })
  .min(-CASHFLOW_MONEY_MAX, { error: 'is too large' })
  .max(CASHFLOW_MONEY_MAX, { error: 'is too large' });
