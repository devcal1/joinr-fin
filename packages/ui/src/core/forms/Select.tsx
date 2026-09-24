import { ChevronDown } from 'lucide-react';
import type { JSX } from 'react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';
import { FieldFrame, controlAria, useFieldIds, type FieldBaseProps } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown (and not selectable) while the value is ''. */
  placeholder?: string;
}

/** A native select, styled to the field frame. */
export function Select({
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
  options,
  placeholder,
}: SelectProps): JSX.Element {
  const ids = useFieldIds(id, hint, error);
  const showingPlaceholder = placeholder !== undefined && value === '';
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
    >
      <div className="jf-input jf-input--select">
        <select
          id={ids.inputId}
          name={name}
          className={cx(
            'jf-input__control',
            'jf-input__control--select',
            showingPlaceholder && 'jf-input__control--placeholder',
          )}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          {...controlAria(ids, error, required)}
        >
          {placeholder !== undefined ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon icon={ChevronDown} className="jf-input__chevron" />
      </div>
    </FieldFrame>
  );
}
