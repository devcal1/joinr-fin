// `@joinr/schema` root export: enums, primitives, decimal and date helpers, pricing, the settings
// and record registries, Zod row schemas, corrections, limits and the API DTOs.
// The web imports this entry, so nothing here may import drizzle-orm or node modules
// (the Drizzle tables are `@joinr/schema/db`).
export const packageName = '@joinr/schema' as const;

export * from './enums';
export * from './primitives';
export * from './decimal';
export * from './dates';
export * from './pricing';
export * from './trading';
export * from './settings';
export * from './records';
export * from './rows';
export * from './corrections';
export * from './limits';
export * from './dto/errors';
export * from './dto/records';
export * from './dto/import';
export * from './dto/report';
export * from './dto/prices';
export * from './dto/status';
export * from './dto/investments';
