// Form state shared by the cash-flow pages (stage-3.md §6.8): API error mapping, one inline editor
// open at a time with focus returned to its opener, the delete-confirm state of a table, and the
// desktop / phone column order (§6.9). No components (react-refresh), see forms.tsx.
import type { ColumnTableColumn } from '@joinr/ui';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../../api/client';
import { IMPORT_RUNNING_MESSAGE, splitFormErrors, type FormErrors } from '../investments/apiErrors';

export type { FormErrors };

/** Splits an API error into field messages (by the issue path's first segment) and a form message. */
export function formErrorsOf<Field extends string>(
  error: unknown,
  fields: readonly Field[],
  alias: Readonly<Record<string, Field>> = {},
): FormErrors<Field> {
  return splitFormErrors<Field>(error, (path) => {
    const head = path.split('.')[0] ?? path;
    if (alias[path]) return alias[path];
    if (alias[head]) return alias[head];
    return (fields as readonly string[]).includes(head) ? (head as Field) : undefined;
  });
}

/** An error message for a delete, a reorder or a one-click action. */
export function actionErrorText(error: unknown): string {
  if (isApiError(error) && error.code === 'IMPORT_IN_PROGRESS') return IMPORT_RUNNING_MESSAGE;
  return error instanceof Error && error.message ? error.message : 'Something went wrong.';
}

// ─── One editor at a time, focus return (§6.8) ──────────────────────────────────────────────────

export interface EditorBase {
  /** A selector for the button that opened the form: focus returns there on close. */
  opener: string;
}

export interface EditorState<E extends EditorBase> {
  editor: E | null;
  notice: string | null;
  open: (next: E) => void;
  close: () => void;
  /** Close the form and announce `message` ("Balance saved"). */
  done: (message: string) => void;
  announce: (message: string | null) => void;
}

export function useEditor<E extends EditorBase>(): EditorState<E> {
  const [editor, setEditor] = useState<E | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    const selector = returnFocus.current;
    if (editor || !selector) return;
    returnFocus.current = null;
    document.querySelector<HTMLElement>(selector)?.focus();
  }, [editor]);

  const open = (next: E): void => {
    setNotice(null);
    setEditor(next);
  };
  const close = (): void => {
    returnFocus.current = editor?.opener ?? null;
    setEditor(null);
  };
  const done = (message: string): void => {
    close();
    setNotice(message);
  };
  return { editor, notice, open, close, done, announce: setNotice };
}

/** `[data-cf-action="<key>"]`: the selector of a button carrying that action key. */
export function actionSelector(key: string): string {
  return `[data-cf-action="${key}"]`;
}

/**
 * The delete-confirm state of a table: which row is confirming, the error, and focus back on the
 * row's Delete button after a cancel.
 */
export function useRowDelete<Key extends string | number>(
  deleteSelector: (key: Key) => string,
): {
  confirming: Key | null;
  error: string | null;
  ask: (key: Key) => void;
  cancel: () => void;
  finish: () => void;
  fail: (error: unknown) => void;
} {
  const [confirming, setConfirming] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnTo = useRef<Key | null>(null);
  useEffect(() => {
    const key = returnTo.current;
    if (confirming !== null || key === null) return;
    returnTo.current = null;
    document.querySelector<HTMLElement>(deleteSelector(key))?.focus();
  }, [confirming, deleteSelector]);
  return {
    confirming,
    error,
    ask: (key) => {
      setError(null);
      setConfirming(key);
    },
    cancel: () => {
      returnTo.current = confirming;
      setConfirming(null);
    },
    finish: () => setConfirming(null),
    fail: (e) => setError(actionErrorText(e)),
  };
}

// ─── Columns ────────────────────────────────────────────────────────────────────────────────────

/** The columns in `order` (desktop or the phone's status-first order, §6.9); unknown ids skipped. */
export function orderColumns<Row>(
  all: Readonly<Record<string, ColumnTableColumn<Row>>>,
  order: readonly string[],
): ColumnTableColumn<Row>[] {
  return order.flatMap((id) => {
    const column = all[id];
    return column ? [column] : [];
  });
}
