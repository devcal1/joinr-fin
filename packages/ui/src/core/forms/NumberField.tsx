import { useId, useRef, type JSX } from 'react';
import { formatQuantity, parseDecimal } from '../format';
import { FieldFrame, controlAria, useFieldIds, type FieldBaseProps } from './Field';
import { useDraftInput, type Validation } from './useDraftInput';

export interface NumberFieldProps extends FieldBaseProps {
  /** A decimal string; '' = empty. */
  value: string;
  onChange: (value: string) => void;
  /** Maximum decimal places (e.g. 8 for crypto units). Unlimited when omitted. */
  maxDp?: number;
  allowNegative?: boolean;
  /** A unit shown after the number, e.g. "%" or "units". */
  suffix?: string;
  placeholder?: string;
  /**
   * Visually hide the label; it still names the input (an inline cell editor whose column header
   * already says what it is). Stage 4, additive (as MoneyField's).
   */
  labelHidden?: boolean;
}

export function numberInvalidMessage(maxDp: number | undefined): string {
  if (maxDp === undefined) return 'Enter a number like 1,234.5';
  if (maxDp === 0) return 'Enter a whole number';
  return `Enter a number with up to ${maxDp} decimal place${maxDp === 1 ? '' : 's'}`;
}

export const NUMBER_NEGATIVE_MESSAGE = 'Enter a number of zero or more';

function display(value: string, maxDp: number | undefined): string {
  if (value === '') return '';
  try {
    return formatQuantity(value, { maxDp: maxDp ?? 20 });
  } catch {
    return value;
  }
}

/** A monospaced, right-aligned decimal input: raw while focused, grouped (formatQuantity) on blur. */
export function NumberField({
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
  maxDp,
  allowNegative = false,
  suffix,
  placeholder,
  labelHidden,
}: NumberFieldProps): JSX.Element {
  const suffixId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useDraftInput<string>({
    inputRef,
    value,
    onChange,
    format: (current) => display(current, maxDp),
    toDraft: (current) => current,
    validate: (text): Validation<string> => {
      if (text.trim() === '') return { ok: true, value: '' };
      const parsed = parseDecimal(text, maxDp);
      if (parsed === null) return { ok: false, message: numberInvalidMessage(maxDp) };
      if (parsed.startsWith('-') && !allowNegative) {
        return { ok: false, message: NUMBER_NEGATIVE_MESSAGE };
      }
      return { ok: true, value: parsed };
    },
  });
  const shownError = error ?? draft.message;
  const ids = useFieldIds(id, hint, shownError, suffix ? suffixId : undefined);
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={shownError}
      required={required}
      disabled={disabled}
      className={className}
      labelHidden={labelHidden}
    >
      <div className="jf-input jf-input--numeric">
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
        {suffix ? (
          <span id={suffixId} className="jf-input__adorn jf-input__adorn--end">
            {suffix}
          </span>
        ) : null}
      </div>
    </FieldFrame>
  );
}
