import { useRef, type JSX } from 'react';
import { formatMoney, parseMoney } from '../format';
import { FieldFrame, controlAria, useFieldIds, type FieldBaseProps } from './Field';
import { useDraftInput, type Validation } from './useDraftInput';

export interface MoneyFieldProps extends FieldBaseProps {
  /** Integer cents, or null when empty. */
  value: number | null;
  onChange: (cents: number | null) => void;
  allowNegative?: boolean;
  placeholder?: string;
}

export const MONEY_INVALID_MESSAGE = 'Enter an amount like 1,234.56';
export const MONEY_NEGATIVE_MESSAGE = 'Enter an amount of zero or more';

/** Cents as plain editable text: 123456 → "1234.56", −5 → "-0.05". */
function centsToText(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A money input with a `$` adornment: raw text while focused, `1,234.56` (formatMoney without
 * the `$`) on blur. Invalid input shows "Enter an amount like 1,234.56".
 */
export function MoneyField({
  label,
  id,
  name,
  hint,
  error,
  required,
  disabled,
  className,
  value,
  onChange,
  allowNegative = false,
  placeholder,
}: MoneyFieldProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useDraftInput<number | null>({
    inputRef,
    value,
    onChange,
    format: (cents) => (cents === null ? '' : formatMoney(cents).replace('$', '')),
    toDraft: (cents) => (cents === null ? '' : centsToText(cents)),
    validate: (text): Validation<number | null> => {
      if (text.trim() === '') return { ok: true, value: null };
      const cents = parseMoney(text);
      if (cents === null) return { ok: false, message: MONEY_INVALID_MESSAGE };
      if (cents < 0 && !allowNegative) return { ok: false, message: MONEY_NEGATIVE_MESSAGE };
      return { ok: true, value: cents };
    },
  });
  const shownError = error ?? draft.message;
  const ids = useFieldIds(id, hint, shownError);
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={shownError}
      required={required}
      disabled={disabled}
      className={className}
    >
      <div className="jf-input jf-input--numeric">
        <span className="jf-input__adorn jf-input__adorn--start" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          id={ids.inputId}
          name={name}
          className="jf-input__control"
          type="text"
          inputMode={allowNegative ? 'text' : 'decimal'}
          autoComplete="off"
          value={draft.text}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={draft.onFocus}
          onChange={(event) => draft.onChange(event.target.value)}
          onBlur={draft.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') draft.commit();
          }}
          {...controlAria(ids, shownError, required)}
        />
      </div>
    </FieldFrame>
  );
}
