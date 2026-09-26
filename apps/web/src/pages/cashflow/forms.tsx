// Shared form components for the cash-flow pages (stage-3.md §6.8): the inline form card (focus on
// open, Save disabled while pristine or pending), the workbook, import-safe and new-app-data
// callouts, the form error, and the in-cell delete confirm. The state hooks are in formState.ts.
import { Button, Callout, Card, Cluster } from '@joinr/ui';
import { Save } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useImportRuns } from '../../api/hooks';

export const WORKBOOK_NOTE =
  'This came from the workbook. Saving (or deleting) it counts as an app edit: re-importing the workbook will then be blocked.';
export const KEPT_NOTE = 'Kept when you re-import the workbook.';
export const NEW_APP_DATA_NOTE =
  'Saving adds app data: re-importing the workbook will then be blocked.';

/** `Callout important` for a workbook row or setting (§6.8). */
export function WorkbookCallout(): JSX.Element {
  return (
    <Callout kind="important" title="From the workbook">
      <p>{WORKBOOK_NOTE}</p>
    </Callout>
  );
}

/** A note for the import-safe edits: adjustments, goals, dismissals, the year basis (§6.8). */
export function KeptCallout({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <Callout kind="note" title="Import-safe">
      <p>{children ?? KEPT_NOTE}</p>
    </Callout>
  );
}

/**
 * The one-line note on create forms that write an import-owned row while no app data exists yet
 * (§6.8). Hidden until the import runs have loaded, and once app data exists.
 */
export function NewAppDataNote(): JSX.Element | null {
  const runs = useImportRuns();
  if (runs.data?.hasAppData !== false) return null;
  return (
    <Callout kind="note" title="App data">
      <p>{NEW_APP_DATA_NOTE}</p>
    </Callout>
  );
}

/** A form-level error (a 409's message, an import running, anything not tied to a field). */
export function FormError({
  message,
  title = 'Not saved',
}: {
  message: string | null;
  title?: string;
}) {
  if (!message) return null;
  return (
    <Callout kind="do-not" title={title}>
      <p>{message}</p>
    </Callout>
  );
}

export interface InlineFormProps {
  title: string;
  subtitle?: string;
  /** Validates and starts the save; returns false when nothing was sent (a client-side error). */
  onSubmit: () => boolean;
  onCancel: () => void;
  pending: boolean;
  pristine: boolean;
  saveLabel?: string;
  /** Extra buttons beside Save / Cancel (e.g. Remove). */
  extraActions?: ReactNode;
  /** Callouts shown above the buttons. */
  notes?: ReactNode;
  formError?: string | null;
  children: ReactNode;
}

/**
 * An inline `Card` form (Stage 2 §6.6 pattern): it scrolls into view and focuses its first field
 * on open; Save is disabled while pristine or pending (`aria-busy`), so a double click sends one
 * request and an unchanged row is never saved.
 */
export function InlineForm({
  title,
  subtitle,
  onSubmit,
  onCancel,
  pending,
  pristine,
  saveLabel = 'Save',
  extraActions,
  notes,
  formError,
  children,
}: InlineFormProps): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    form
      ?.querySelector<HTMLElement>(
        'select:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), textarea:not([disabled])',
      )
      ?.focus();
  }, []);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current || pending || pristine) return;
    // A field whose text does not parse (a draft money or date) marks itself invalid: never send
    // the last valid value its parent still holds.
    if (!event.currentTarget.checkValidity()) return;
    submitting.current = true;
    if (!onSubmit()) submitting.current = false;
  };
  return (
    <Card as="section" title={title} subtitle={subtitle}>
      <form
        ref={formRef}
        className="jf-app-form"
        onSubmit={submit}
        noValidate
        aria-label={title}
        aria-busy={pending || undefined}
      >
        {children}
        {notes}
        <FormError message={formError ?? null} />
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
          {extraActions}
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </Cluster>
      </form>
    </Card>
  );
}

// ─── Delete confirm inside a row's Actions cell (Stage 2 pattern) ───────────────────────────────

/**
 * Scrolls a table that scrolls sideways so the cell holding `element` starts just right of the
 * sticky first column (a phone table).
 */
function revealRightOfStickyColumn(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>('.jf-table__scroll');
  const cell = element.closest<HTMLElement>('td');
  if (!scroller || !cell) return;
  const sticky = scroller.querySelector<HTMLElement>('.jf-table__cell--first');
  const left = cell.offsetLeft - (sticky?.offsetWidth ?? 0);
  const inView =
    left >= scroller.scrollLeft &&
    cell.offsetLeft + cell.offsetWidth <= scroller.scrollLeft + scroller.clientWidth;
  if (!inView) scroller.scrollLeft = Math.max(0, left);
}

export interface DeleteConfirmProps {
  /** The question, naming the row: "Delete the deposit of 10/09/2026?". */
  question: string;
  /** Names the row in the buttons' accessible names: "deposit of 10/09/2026". */
  label: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

/** "Delete …? [Delete] [Cancel]": focus starts on Cancel, Escape cancels. */
export function DeleteConfirm({
  question,
  label,
  busy,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
}: DeleteConfirmProps): JSX.Element {
  const groupRef = useRef<HTMLSpanElement>(null);
  const questionId = useId();
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    revealRightOfStickyColumn(group);
    group.querySelector<HTMLElement>('[data-confirm="cancel"]')?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <span
      ref={groupRef}
      className="jf-app-row-actions jf-app-confirm"
      role="group"
      aria-labelledby={questionId}
      onKeyDown={onKeyDown}
    >
      <span id={questionId} className="jf-app-confirm__question">
        {question}
      </span>
      <Button
        variant="danger"
        size="sm"
        onClick={onConfirm}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={`${confirmLabel} the ${label}`}
      >
        {confirmLabel}
      </Button>
      <Button
        data-confirm="cancel"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={busy}
        aria-label={`Cancel: keep the ${label}`}
      >
        Cancel
      </Button>
    </span>
  );
}
