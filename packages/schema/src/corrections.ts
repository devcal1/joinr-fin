// Owner corrections to imported rows (D27; stage-1.md §4.5) and where they come from (§3.4).
// Pure: no node imports (the web imports the schema root).
import { z } from 'zod';
import { IsoDateSchema } from './primitives';

/** A signed plain decimal as typed in a corrections file (`"0.5"`, `"-12"`); compared numerically. */
const LooseDecimalSchema = z
  .string()
  .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/, { error: 'must be a plain decimal number' });

const PositiveLooseDecimalSchema = LooseDecimalSchema.refine((v) => Number(v) > 0, {
  error: 'must be greater than zero',
});

export const LEDGER_SHEETS = ['Stocks', 'ETFs', 'Managed Funds', 'Crypto'] as const;
export type LedgerSheet = (typeof LEDGER_SHEETS)[number];

const common = {
  id: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1, { error: 'reason is required' }).max(500),
  approvedOn: IsoDateSchema.optional(),
};

const nonEmptySet = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length > 0, {
    error: 'set must change at least one field',
  });

const tradeMatch = z.strictObject({
  sheet: z.enum(LEDGER_SHEETS),
  row: z.number().int().positive().optional(),
  symbol: z.string().trim().min(1),
  date: IsoDateSchema,
  units: LooseDecimalSchema.optional(),
  price: LooseDecimalSchema.optional(),
});

const tradeSet = nonEmptySet({
  date: IsoDateSchema.optional(),
  units: LooseDecimalSchema.optional(),
  price: PositiveLooseDecimalSchema.optional(),
  feeCents: z.number().int().min(0).optional(),
});

const dividendMatch = z.strictObject({
  row: z.number().int().positive().optional(),
  ticker: z.string().trim().min(1),
  paymentDate: IsoDateSchema,
  netAmountCents: z.number().int().optional(),
});

const dividendSet = nonEmptySet({
  paymentDate: IsoDateSchema.optional(),
  ticker: z.string().trim().min(1).optional(),
  exDate: IsoDateSchema.nullable().optional(),
  netAmountCents: z.number().int().optional(),
  reinvested: z.boolean().nullable().optional(),
});

const SKIP = z.literal('skip');

export const TradeCorrectionSchema = z.union([
  z.strictObject({ ...common, target: z.literal('trade'), match: tradeMatch, set: tradeSet }),
  z.strictObject({ ...common, target: z.literal('trade'), match: tradeMatch, action: SKIP }),
]);

export const DividendCorrectionSchema = z.union([
  z.strictObject({
    ...common,
    target: z.literal('dividend'),
    match: dividendMatch,
    set: dividendSet,
  }),
  z.strictObject({ ...common, target: z.literal('dividend'), match: dividendMatch, action: SKIP }),
]);

export const CorrectionSchema = z.union([TradeCorrectionSchema, DividendCorrectionSchema]);

export const CorrectionsFileSchema = z
  .strictObject({
    version: z.literal(1),
    corrections: z.array(CorrectionSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.corrections.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['corrections', i, 'id'],
          message: `duplicate correction id "${c.id}"`,
        });
      }
      seen.add(c.id);
    });
  });

export type TradeCorrection = z.output<typeof TradeCorrectionSchema>;
export type DividendCorrection = z.output<typeof DividendCorrectionSchema>;
export type Correction = z.output<typeof CorrectionSchema>;
export type CorrectionsFile = z.output<typeof CorrectionsFileSchema>;

/**
 * Where the importer's corrections come from: `auto` (DATA_DIR, then the dev checkout's
 * reference/ folder, then none), `off`, or an explicit file.
 */
export type CorrectionsSetting =
  { kind: 'auto' } | { kind: 'off' } | { kind: 'file'; path: string };

/**
 * `IMPORT_CORRECTIONS_FILE` → a CorrectionsSetting: unset/blank → auto · `none` → off · anything
 * else → `{ kind: 'file', path }` (the caller resolves a relative path against the repo root).
 */
export function correctionsSettingFromEnv(value: string | undefined): CorrectionsSetting {
  const v = value?.trim() ?? '';
  if (v === '') return { kind: 'auto' };
  if (v.toLowerCase() === 'none') return { kind: 'off' };
  return { kind: 'file', path: v };
}
