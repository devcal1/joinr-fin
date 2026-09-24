import { Calendar } from 'lucide-react';
import { useRef, type JSX } from 'react';
import { formatDate, isIsoDate, parseDate, type IsoDate } from '../format';
import { Icon } from '../layout/Icon';
import { FieldFrame, controlAria, useFieldIds, type FieldBaseProps } from './Field';
import { useDraftInput, type Validation } from './useDraftInput';

export interface DateFieldProps extends FieldBaseProps {
  /** ISO 'YYYY-MM-DD', or null when empty. Shown as dd/mm/yyyy. */
  value: IsoDate | null;
  onChange: (iso: IsoDate | null) => void;
  /** Earliest allowed date (ISO). */
  min?: IsoDate;
  /** Latest allowed date (ISO). */
  max?: IsoDate;
}

export const DATE_INVALID_MESSAGE = 'Enter a date like 18/08/2026';

function safeFormat(value: IsoDate | null): string {
  return value && isIsoDate(value) ? formatDate(value) : (value ?? '');
}

/**
 * A dd/mm/yyyy text input, validated on blur with parseDate. The calendar button opens the
 * browser's picker on a hidden `<input type="date">`; the native field's own display format is
 * never shown.
 */
export function DateField({
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
  min,
  max,
}: DateFieldProps): JSX.Element {
  const pickerRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useDraftInput<IsoDate | null>({
    inputRef,
    value,
    onChange,
    format: safeFormat,
    toDraft: safeFormat,
    validate: (text): Validation<IsoDate | null> => {
      if (text.trim() === '') return { ok: true, value: null };
      const iso = parseDate(text);
      if (iso === null) return { ok: false, message: DATE_INVALID_MESSAGE };
      if (min && iso < min)
        return { ok: false, message: `Enter a date on or after ${formatDate(min)}` };
      if (max && iso > max)
        return { ok: false, message: `Enter a date on or before ${formatDate(max)}` };
      return { ok: true, value: iso };
    },
  });
  const shownError = error ?? draft.message;
  const ids = useFieldIds(id, hint, shownError);

  const openPicker = (): void => {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      picker.showPicker();
    } catch {
      // Older browsers without showPicker (or when it is refused): fall back to the native field.
      picker.focus();
      picker.click();
    }
  };

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
      <div className="jf-input jf-input--date">
        <input
          ref={inputRef}
          id={ids.inputId}
          name={name}
          className="jf-input__control jf-input__control--date"
          type="text"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          value={draft.text}
          disabled={disabled}
          onFocus={draft.onFocus}
          onChange={(event) => draft.onChange(event.target.value)}
          onBlur={draft.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') draft.commit();
          }}
          {...controlAria(ids, shownError, required)}
        />
        <button
          type="button"
          className="jf-input__button"
          aria-label={`Choose ${label.toLowerCase()} from a calendar`}
          title="Choose from a calendar"
          disabled={disabled}
          onClick={openPicker}
        >
          <Icon icon={Calendar} />
        </button>
        <input
          ref={pickerRef}
          className="jf-input__picker"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value ?? ''}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => {
            draft.reset();
            const picked = event.target.value;
            onChange(picked === '' ? null : picked);
          }}
        />
      </div>
    </FieldFrame>
  );
}
