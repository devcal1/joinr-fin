// The database schema lives in @joinr/schema (Stage 1); this module re-exports it for the server.
// Migrations stay append-only (apps/server/migrations).
export * from '@joinr/schema/db';
