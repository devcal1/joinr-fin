import { useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

export interface DraftInputOptions<T> {
  value: T;
  onChange: (value: T) => void;
  /** The value as shown while the field is not being edited. */
  format: (value: T) => string;
  /** The value as raw, editable text when the field gains focus. */
  toDraft: (value: T) => string;
  validate: (text: string) => Validation<T>;
  /**
   * The field's input. While the draft is invalid it carries a custom validity message, so native
   * form submission is blocked (and the browser points at the field) instead of sending the last
   * valid value the parent still holds.
   */
  inputRef: RefObject<HTMLInputElement | null>;
}

export interface DraftInput {
  /** What the input shows: the raw draft while editing, else the formatted value. */
  text: string;
  /** The validation message from the last commit (blur or Enter), if the text was invalid. */
  message: string | undefined;
  onFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onChange: (text: string) => void;
  /** Validate and format (blur / Enter). Invalid text stays visible with its message. */
  commit: () => void;
  /** Drop the draft and message (e.g. after a picker set the value directly). */
  reset: () => void;
}

/**
 * Formatted-on-blur text input state. Valid text is reported live through `onChange`, so a form
 * submitted with Enter always sees the current value; errors only appear on commit. Invalid text
 * is never reported to the parent. Instead the input is marked invalid (`setCustomValidity`),
 * which blocks native form submission until the text is fixed or cleared.
 */
export function useDraftInput<T>({
  value,
  onChange,
  format,
  toDraft,
  validate,
  inputRef,
}: DraftInputOptions<T>): DraftInput {
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // Swapping the formatted text for the raw text on focus drops the browser's selection, so the
  // text is selected again once the swap has rendered: typing then replaces it, as it would in a
  // plain input that was tabbed into.
  const selectAfterSwap = useRef<HTMLInputElement | null>(null);

  // The live validity of the draft; the formatted value itself is always valid.
  let invalidMessage: string | undefined;
  if (draft !== null) {
    const result = validate(draft);
    if (!result.ok) invalidMessage = result.message;
  }

  useLayoutEffect(() => {
    inputRef.current?.setCustomValidity(invalidMessage ?? '');
  }, [inputRef, invalidMessage]);

  useLayoutEffect(() => {
    const input = selectAfterSwap.current;
    if (!input || draft === null) return;
    selectAfterSwap.current = null;
    if (input.ownerDocument.activeElement === input) input.select();
  }, [draft]);

  const report = (next: T): void => {
    if (!Object.is(next, value)) onChange(next);
  };

  return {
    text: draft ?? format(value),
    message,
    onFocus(event) {
      if (draft !== null) return;
      const next = toDraft(value);
      if (next !== event.currentTarget.value) selectAfterSwap.current = event.currentTarget;
      setDraft(next);
    },
    onChange(text) {
      setDraft(text);
      const result = validate(text);
      if (result.ok) {
        setMessage(undefined);
        report(result.value);
      }
    },
    commit() {
      if (draft === null) return;
      const result = validate(draft);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(undefined);
      setDraft(null);
      report(result.value);
    },
    reset() {
      setDraft(null);
      setMessage(undefined);
    },
  };
}
