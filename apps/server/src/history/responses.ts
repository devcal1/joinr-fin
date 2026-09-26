// Mutation responses of the History API (stage-5.md §4.4): after the commit, the changed months'
// DTOs are rebuilt from a fresh finance context (every figure from the engine), with the audit row
// written and `hasAppData` after the write. A month that vanished in between (only a concurrent CLI
// import can do that) answers 404.
import type {
  CorrectionResponse,
  DeleteSnapshotResponse,
  IsoMonth,
  RecordResponse,
  SnapshotAuditDto,
} from '@joinr/schema';
import { snapshotAudit } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { createFinanceContext, type FinanceDeps } from '../cashflow/context';
import { hasAppData } from '../db/queries/domain';
import { HttpError } from '../errors';
import { snapshotAuditDto } from './audit';
import { snapshotNotFoundMessage } from './constants';
import type { CorrectionOutcome } from './mutations';
import type { RecordedMonth } from './record';
import { snapshotDtos } from './snapshots';

function auditOf(deps: FinanceDeps, id: number): SnapshotAuditDto {
  const row = deps.database.db.select().from(snapshotAudit).where(eq(snapshotAudit.id, id)).get();
  if (!row) throw new HttpError(404, `Audit entry ${id} not found`, 'NOT_FOUND');
  return snapshotAuditDto(row);
}

/** The recorded months (ascending) as SnapshotDtos, and `hasAppData` (true after a record). */
export function recordResponse(
  deps: FinanceDeps,
  recorded: readonly RecordedMonth[],
  log?: FastifyBaseLogger,
): RecordResponse {
  const dtos = new Map(
    snapshotDtos(createFinanceContext(deps, log)).map((d) => [d.periodMonth, d]),
  );
  const months = [...recorded].map((r) => r.periodMonth).sort();
  return {
    recorded: months.map((m) => {
      const dto = dtos.get(m);
      if (!dto) throw new HttpError(404, snapshotNotFoundMessage(m), 'NOT_FOUND');
      return dto;
    }),
    hasAppData: hasAppData(deps.database.db),
  };
}

/**
 * The corrected month, the next month (its cash change may have followed) and the audit row. A
 * correction that changed nothing wrote no audit row: `audit` is then an unsaved entry (id 0, no
 * changes) carrying the reason, so the client can say "Nothing changed".
 */
export function correctionResponse(
  deps: FinanceDeps,
  outcome: CorrectionOutcome,
  note: string,
  log?: FastifyBaseLogger,
): CorrectionResponse {
  const dtos = snapshotDtos(createFinanceContext(deps, log));
  const snapshot = dtos.find((d) => d.periodMonth === outcome.periodMonth);
  if (!snapshot)
    throw new HttpError(404, snapshotNotFoundMessage(outcome.periodMonth), 'NOT_FOUND');
  const next =
    outcome.nextMonth === null
      ? null
      : (dtos.find((d) => d.periodMonth === outcome.nextMonth) ?? null);
  const audit: SnapshotAuditDto =
    outcome.auditId === null
      ? {
          id: 0,
          periodMonth: outcome.periodMonth,
          action: 'correct',
          trigger: 'manual',
          at: deps.now().toISOString(),
          note,
          changes: [],
          detail: null,
        }
      : auditOf(deps, outcome.auditId);
  return { snapshot, next, audit };
}

export function deleteSnapshotResponse(
  deps: FinanceDeps,
  periodMonth: IsoMonth,
  auditId: number,
): DeleteSnapshotResponse {
  return {
    periodMonth,
    audit: auditOf(deps, auditId),
    hasAppData: hasAppData(deps.database.db),
  };
}
