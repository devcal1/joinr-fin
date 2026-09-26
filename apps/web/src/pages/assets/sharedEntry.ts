// The shared entry-log editor's state (stage-4.md §6.3–6.5): the shared As of date (today by
// default, at most tomorrow) and Note, their checks, and the API error split onto them. No
// components (react-refresh); the form is SharedEntryForm.tsx.
import type { IsoDate } from '@joinr/schema';
import { formatDate, toIsoDate } from '@joinr/ui';
import { useState } from 'react';
import { tomorrowOf } from '../cashflow/display';
import { formErrorsOf } from '../cashflow/formState';

type SharedField = 'asOf' | 'note';

export interface SharedEntryState {
  today: IsoDate;
  asOf: IsoDate | null;
  setAsOf: (date: IsoDate | null) => void;
  note: string;
  setNote: (note: string) => void;
  /** The trimmed shared note, or undefined when empty (the field is then left out). */
  sharedNote: string | undefined;
  errors: Partial<Record<SharedField, string>>;
  formError: string | null;
  /** Checks the date and note; false (with messages) when either is wrong. */
  validate: () => boolean;
  /** Splits an API error onto the date, the note (`entries.N.note` too) or the form. */
  fail: (error: unknown) => void;
  setFormError: (message: string | null) => void;
}

export function useSharedEntry(): SharedEntryState {
  const [today] = useState(() => toIsoDate(new Date()));
  const [asOf, setAsOf] = useState<IsoDate | null>(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<SharedField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const trimmed = note.trim();
  return {
    today,
    asOf,
    setAsOf,
    note,
    setNote,
    sharedNote: trimmed === '' ? undefined : trimmed,
    errors,
    formError,
    setFormError,
    validate: () => {
      const found: Partial<Record<SharedField, string>> = {};
      if (!asOf) found.asOf = 'Enter the date.';
      else if (asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
      if (trimmed.length > 200) found.note = 'Use at most 200 characters.';
      setErrors(found);
      setFormError(null);
      return Object.keys(found).length === 0;
    },
    fail: (error) => {
      const split = formErrorsOf<SharedField>(error, ['asOf', 'note'], {
        'entries.note': 'note',
      });
      // "entries.0.note: …" → the note field.
      const message = error instanceof Error ? error.message : '';
      if (split.fields.note === undefined && /entries\.\d+\.note:/.test(message)) {
        split.fields.note = 'Use at most 200 characters.';
      }
      setErrors(split.fields);
      setFormError(split.form);
    },
  };
}

/** "Older than the latest price (dd/mm/yyyy): added to the history only." */
export function olderThanLatest(what: string, latest: IsoDate): string {
  return `Older than the latest ${what} (${formatDate(latest)}): added to the history only.`;
}

/** True when the shared date is before a row's latest entry (the save only adds history). */
export function isOlder(asOf: IsoDate | null, latest: IsoDate | null): boolean {
  return asOf !== null && latest !== null && asOf < latest;
}
