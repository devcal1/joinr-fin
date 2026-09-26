// The correction form (stage-5.md §4.3, §6.4 item 5, UX-5, UX-6): one money field per correctable
// column in the History groups, prefilled; "Mortgage owed" and "Accounts in debit (owed)" entered
// as positive amounts and negated before sending; a changed field shows its old value ("was $X");
// on an imported month the offset extras are read-only; the derived columns are named as
// recalculated; a required reason. An imported month shows the workbook callout (saving is an app
// edit), a recorded month the audit note. Save sends only the changed columns.
import type { CorrectableSnapshotColumn, CorrectionResponse, SnapshotDto } from '@joinr/schema';
import { Callout, Grid, GridItem, MoneyField, TextField, formatMoney } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useCorrectSnapshot } from '../../api/hooks';
import { splitFormErrors } from '../investments/apiErrors';
import { InlineForm } from '../cashflow/forms';
import {
  CORRECT_GROUPS,
  SIGNED_COLUMNS,
  correctLabel,
  diffCorrection,
  displayCents,
  fieldOfPath,
  initialDrafts,
  isReadOnly,
  owedMessage,
  type CorrectDrafts,
} from './correctDraft';
import { monthWords } from './display';
import {
  CORRECT_AUDIT_NOTE,
  CORRECT_DERIVED,
  CORRECT_REPLACES,
  CORRECT_WORKBOOK,
  NOT_RECORDED_IMPORTED,
} from './historyText';

const REASON_MAX = 200;

type Field = CorrectableSnapshotColumn | 'note';

export function CorrectForm({
  snapshot,
  onDone,
  onCancel,
}: {
  snapshot: SnapshotDto;
  onDone: (result: CorrectionResponse) => void;
  onCancel: () => void;
}): JSX.Element {
  const [drafts, setDrafts] = useState<CorrectDrafts>(() => initialDrafts(snapshot));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const correct = useCorrectSnapshot();
  const diff = diffCorrection(snapshot, drafts);
  const changed = Object.keys(diff.values) as CorrectableSnapshotColumn[];
  const pristine = changed.length === 0 && Object.keys(diff.errors).length === 0;
  const migrated = snapshot.source === 'migrated';

  const submit = (): boolean => {
    setFormError(null);
    const next: Partial<Record<Field, string>> = { ...diff.errors };
    if (reason.trim() === '') next.note = 'Say why you are correcting it';
    setErrors(next);
    if (Object.keys(next).length > 0 || changed.length === 0) return false;
    correct.mutate(
      { periodMonth: snapshot.periodMonth, body: { values: diff.values, note: reason.trim() } },
      {
        onSuccess: onDone,
        onError: (error) => {
          const split = splitFormErrors<Field>(error, fieldOfPath, (path, message) =>
            owedMessage(path.replace(/^values\./, ''), message),
          );
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Correct ${monthWords(snapshot.periodMonth)}`}
      subtitle={CORRECT_REPLACES}
      onSubmit={submit}
      onCancel={onCancel}
      pending={correct.isPending}
      pristine={pristine}
      formError={formError}
      notes={
        migrated ? (
          <Callout kind="important" title="From the workbook">
            <p>{CORRECT_WORKBOOK}</p>
          </Callout>
        ) : (
          <Callout kind="note" title="Audit trail">
            <p>{CORRECT_AUDIT_NOTE}</p>
          </Callout>
        )
      }
    >
      {CORRECT_GROUPS.map((group) => (
        <fieldset key={group.title} className="jf-app-fieldset">
          <legend className="jf-app-fieldset__legend">{group.title}</legend>
          <Grid>
            {group.columns.map((column) => {
              const label = correctLabel(column);
              if (isReadOnly(snapshot, column)) {
                return (
                  <GridItem key={column} span={4} spanTablet={3}>
                    <div className="jf-field" data-testid={`readonly-${column}`}>
                      <p className="jf-field__label">{label}</p>
                      <p className="jf-app-muted">{NOT_RECORDED_IMPORTED}</p>
                    </div>
                  </GridItem>
                );
              }
              const stored = displayCents(column, snapshot.figures[column]);
              const value = drafts[column] ?? null;
              const was =
                column in diff.values
                  ? `was ${stored === null ? 'empty' : formatMoney(stored)}`
                  : undefined;
              return (
                <GridItem key={column} span={4} spanTablet={3}>
                  <MoneyField
                    label={label}
                    value={value}
                    onChange={(cents) => setDrafts((d) => ({ ...d, [column]: cents }))}
                    allowNegative={SIGNED_COLUMNS.has(column)}
                    hint={was}
                    error={errors[column]}
                    disabled={correct.isPending}
                  />
                </GridItem>
              );
            })}
          </Grid>
        </fieldset>
      ))}
      <p className="jf-app-meta">{CORRECT_DERIVED}</p>
      <TextField
        label="Reason"
        value={reason}
        onChange={setReason}
        required
        maxLength={REASON_MAX}
        error={errors.note}
        hint="Required: why the stored figures change"
        disabled={correct.isPending}
      />
    </InlineForm>
  );
}
