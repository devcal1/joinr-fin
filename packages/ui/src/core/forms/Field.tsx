// Shared plumbing for the form fields: ids, the label/hint/error frame.
import { CircleAlert } from 'lucide-react';
import { useId, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';

export interface FieldBaseProps {
  label: string;
  id?: string;
  name?: string;
  hint?: string;
  /** Sets `aria-invalid` and describes the input. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export interface FieldIds {
  inputId: string;
  hintId: string;
  errorId: string;
  /** Error first, then hint, then any extra ids (e.g. a unit suffix). */
  describedBy: string | undefined;
}

export function useFieldIds(
  id: string | undefined,
  hint: string | undefined,
  error: string | undefined,
  ...extra: (string | undefined)[]
): FieldIds {
  const autoId = useId();
  const inputId = id ?? `${autoId}field`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const ids = [error ? errorId : undefined, hint ? hintId : undefined, ...extra].filter(
    (value): value is string => Boolean(value),
  );
  return { inputId, hintId, errorId, describedBy: ids.length ? ids.join(' ') : undefined };
}

export interface FieldFrameProps {
  ids: FieldIds;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Visually hidden label (still the input's accessible name). */
  labelHidden?: boolean;
  children: ReactNode;
}

/** Uppercase label above the control; the error (with an icon) and the hint below it. */
export function FieldFrame({
  ids,
  label,
  hint,
  error,
  required,
  disabled,
  className,
  labelHidden = false,
  children,
}: FieldFrameProps): JSX.Element {
  return (
    <div
      className={cx(
        'jf-field',
        error && 'jf-field--invalid',
        disabled && 'jf-field--disabled',
        className,
      )}
    >
      <label
        htmlFor={ids.inputId}
        className={cx('jf-field__label', labelHidden && 'jf-visually-hidden')}
      >
        {label}
        {required ? (
          <span className="jf-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={ids.errorId} className="jf-field__error">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={ids.hintId} className="jf-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** ARIA attributes every text-like control shares. */
export function controlAria(
  ids: FieldIds,
  error: string | undefined,
  required: boolean | undefined,
): {
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  'aria-required': true | undefined;
} {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': ids.describedBy,
    'aria-required': required ? true : undefined,
  };
}
