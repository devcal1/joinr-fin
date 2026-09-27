// FIRE constants (stage-6.md §3.2, frozen): the statuses, missing inputs, phases, milestone kinds,
// growth-weight keys and input sources of the FIRE planner, the page's shared words, and the D98
// access-age constants. Generic, dependency-free (root export).
import type { EditableSettingKey } from './settings';

/** `projectFire`'s status (§2.5). */
export const FIRE_STATUSES = [
  'needs_input',
  'spend_needed',
  'fire',
  'on_track',
  'not_reachable',
] as const;
export type FireStatus = (typeof FIRE_STATUSES)[number];

/** The inputs `projectFire` lists as missing, in this order (§2.5 step 1). */
export const FIRE_MISSING_INPUTS = [
  'birthYear',
  'accessAge',
  'inflationRate',
  'withdrawalRate',
  'marketReturn',
  'cashInterestRate',
  'rates',
] as const;
export type FireMissingInput = (typeof FIRE_MISSING_INPUTS)[number];

/** A projection row's phase (§2.5 step 6). */
export const FIRE_PHASES = ['accumulation', 'top_up', 'drawdown', 'access', 'retired'] as const;
export type FirePhase = (typeof FIRE_PHASES)[number];

/** The milestones on the node line, in kind order (ties keep this order, §2.5 step 8). */
export const FIRE_MILESTONE_KINDS = ['today', 'fire_start', 'top_ups_end', 'access'] as const;
export type FireMilestoneKind = (typeof FIRE_MILESTONE_KINDS)[number];

/** The growth-blend weights (D102, §2.4 step 5). */
export const FIRE_GROWTH_WEIGHT_KEYS = [
  'cash',
  'offsets',
  'etf',
  'stock',
  'managed_fund',
  'crypto',
  'other_assets',
  'investment_property',
  'super',
] as const;
export type FireGrowthWeightKey = (typeof FIRE_GROWTH_WEIGHT_KEYS)[number];

/** Where a FIRE input's value in use comes from (§4.5). */
export const FIRE_INPUT_SOURCES = ['setting', 'derived', 'what_if', 'default', 'missing'] as const;
export type FireInputSource = (typeof FIRE_INPUT_SOURCES)[number];

/** Node colours by position along the line, not by kind (D101, §2.5 step 8). */
export const FIRE_MILESTONE_TONE_ORDER = ['teal', 'violet', 'fuchsia', 'orange'] as const;
export type FireMilestoneTone = (typeof FIRE_MILESTONE_TONE_ORDER)[number];

/** One map of phase words for the milestone line and the year-by-year table (UX-24). */
export const FIRE_PHASE_WORDS = {
  accumulation: 'Saving',
  top_up: 'Drawing down, topping up super',
  drawdown: 'Drawing down',
  access: 'Living on super',
  retired: 'Living on super',
} as const satisfies Record<FirePhase, string>;

/** The what-if labels; the Settings labels (settings.ts) start with the same words (§3.3). */
export const FIRE_FIELD_LABELS = {
  spend: 'Yearly spend',
  withdrawalRate: 'Withdrawal rate',
  inflationRate: 'Inflation rate',
  marketReturn: 'Market return',
  accessAge: 'Access age',
  extraSavings: 'Extra savings a year',
} as const;
export type FireWhatIfField = keyof typeof FIRE_FIELD_LABELS;

/** The months-used window ending this many days before asOf shows a note (§6.3). */
export const FIRE_WINDOW_STALE_DAYS = 45;
/** The projection's last age (`FireProjectionInput.horizonAge`'s default). */
export const FIRE_HORIZON_AGE = 100;
/** D98: the access age by default (the preservation age for anyone born after 30 June 1964). */
export const FIRE_DEFAULT_ACCESS_AGE = 60;
/** D98: the imported access age replaced once. */
export const FIRE_REPLACED_ACCESS_AGE = 65;
/** D98: the `app_meta` key marking the one-off replacement (§3.4). */
export const FIRE_ACCESS_AGE_META_KEY = 'fire.accessAgeReplaced';
/** ± bound of `fire.extraSavingsPerYearCents` (the write bound and the query's). */
export const FIRE_EXTRA_SAVINGS_MAX_CENTS = 1_000_000_000;

/** The what-if query field → the setting key "Save as my settings" writes (§4.2). */
export const FIRE_WHAT_IF_FIELDS = {
  spend: 'fire.yearlySpendOverrideCents',
  withdrawalRate: 'fire.withdrawalRate',
  inflationRate: 'fire.inflationRate',
  marketReturn: 'fire.marketReturn',
  accessAge: 'fire.preservationAge',
  extraSavings: 'fire.extraSavingsPerYearCents',
} as const satisfies Record<FireWhatIfField, EditableSettingKey>;
