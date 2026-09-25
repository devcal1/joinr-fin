// API errors → form messages for the trade and holding forms (stage-2.md §6.6). The server joins
// validation issues as "quantity.units: must be a positive number; price: must be …", so each
// part is mapped onto a field by its path; anything else is a form-level message.
import { isApiError } from '../../api/client';

export const IMPORT_RUNNING_MESSAGE = 'An import is running; try again shortly.';

export interface FormErrors<Field extends string> {
  fields: Partial<Record<Field, string>>;
  /** What could not be tied to a field (shown in a "Do not" callout). */
  form: string | null;
}

/** "must be a positive number" → "Must be a positive number." */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/**
 * Splits an API error. `fieldOf` maps an issue path (e.g. `quantity.units`) to a field, or
 * undefined; `messageOf` words a field's issue (default: the server's words as a sentence).
 * IMPORT_IN_PROGRESS gets its own plain words; every other code keeps the server's message
 * (TRADE_OVERSELL names the sell and the units, §4.1).
 */
export function splitFormErrors<Field extends string>(
  error: unknown,
  fieldOf: (path: string) => Field | undefined,
  messageOf: (path: string, message: string) => string = (_path, message) => sentence(message),
): FormErrors<Field> {
  const message = error instanceof Error ? error.message : String(error);
  if (!isApiError(error)) return { fields: {}, form: message || 'Something went wrong.' };
  if (error.code === 'IMPORT_IN_PROGRESS') return { fields: {}, form: IMPORT_RUNNING_MESSAGE };
  if (error.code !== 'VALIDATION_ERROR') return { fields: {}, form: message };
  const result: FormErrors<Field> = { fields: {}, form: null };
  const rest: string[] = [];
  for (const part of message.split('; ')) {
    const match = /^([A-Za-z][\w.]*):\s*(.+)$/.exec(part);
    const field = match?.[1] === undefined ? undefined : fieldOf(match[1]);
    if (match && field !== undefined && result.fields[field] === undefined) {
      result.fields[field] = messageOf(match[1] ?? '', match[2] ?? '');
    } else {
      rest.push(part);
    }
  }
  if (rest.length) result.form = rest.map(sentence).join(' ');
  return result;
}
