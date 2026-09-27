// The shared entry-log editor (stage-4.md §6.3–6.5, D58/D66/D69/D72): one `<form>` around a
// table whose cells become fields, with a shared As of date (default today, max tomorrow) and an
// optional shared Note under the section bar. Save sends the changed rows only; the workbook
// callout or the new-app-data note (one or the other, §6.7) and the form error sit above the
// buttons. The state lives in `useSharedEntry` (sharedEntry.ts) so the tables can read the date.
import { Button, Cluster, DateField, Grid, GridItem, TextField } from '@joinr/ui';
import { Save } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type JSX, type ReactNode } from 'react';
import { tomorrowOf } from '../cashflow/display';
import { FormError, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import type { SharedEntryState } from './sharedEntry';
import { escapeCancels } from '../../components/keyboard';

export interface SharedEntryFormProps {
  /** The form's accessible name: "Update prices". */
  label: string;
  saveLabel: string;
  state: SharedEntryState;
  /** No row changed: Save is disabled. */
  pristine: boolean;
  /** The line under the date: what to type, or how many rows changed. */
  statusLine: string;
  /** A changed row came from the workbook: the workbook callout instead of the app-data note. */
  workbook: boolean;
  pending: boolean;
  /** Called after the date and note pass; returns false when nothing was sent. */
  onSubmit: () => boolean;
  onCancel: () => void;
  noteHint?: string;
  /** Extra notes above the buttons (e.g. "Balances saved with a transfer in"). */
  notes?: ReactNode;
  /** The table(s) whose cells are the fields. */
  children: ReactNode;
}

export function SharedEntryForm({
  label,
  saveLabel,
  state,
  pristine,
  statusLine,
  workbook,
  pending,
  onSubmit,
  onCancel,
  noteHint = 'Optional: saved with every changed row',
  notes,
  children,
}: SharedEntryFormProps): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    // The first row field (the date is prefilled with today).
    const fields = form?.querySelectorAll<HTMLElement>(
      'tbody input:not([disabled]):not([tabindex="-1"])',
    );
    (fields?.[0] ?? form?.querySelector<HTMLElement>('input'))?.focus();
  }, []);

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current || pending || pristine) return;
    if (!event.currentTarget.checkValidity()) return;
    if (!state.validate()) return;
    submitting.current = true;
    if (!onSubmit()) submitting.current = false;
  };

  return (
    <form
      ref={formRef}
      className="jf-app-form jf-app-balances-form"
      onSubmit={submit}
      onKeyDown={escapeCancels(onCancel, pending)}
      noValidate
      aria-label={label}
      aria-busy={pending || undefined}
    >
      <Grid>
        <GridItem span={6}>
          <DateField
            label="As of"
            value={state.asOf}
            onChange={state.setAsOf}
            max={tomorrowOf(state.today)}
            required
            error={state.errors.asOf}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={state.note}
            onChange={state.setNote}
            maxLength={200}
            hint={noteHint}
            error={state.errors.note}
            disabled={pending}
          />
        </GridItem>
      </Grid>
      <p className="jf-app-meta">{statusLine}</p>
      {/* One or the other (§6.7): the workbook callout already says a re-import is blocked. */}
      {workbook ? <WorkbookCallout /> : <NewAppDataNote />}
      {notes}
      <FormError message={state.formError} />
      <Cluster gap={3} className="jf-app-form-actions">
        <Button
          type="submit"
          variant="primary"
          icon={Save}
          disabled={pristine || pending}
          aria-busy={pending || undefined}
        >
          {saveLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </Cluster>
      {children}
    </form>
  );
}

/** "Older than the latest <what> (dd/mm/yyyy): added to the history only." */
export function OlderNote({ text }: { text: string }): JSX.Element {
  return <span className="jf-app-meta jf-app-older-note">{text}</span>;
}
