import type { JSX } from 'react';
import { FieldFrame, controlAria, useFieldIds, type FieldBaseProps } from './Field';

export interface TextFieldProps extends FieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'search' | 'url';
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  /** The id of a `<datalist>` of suggestions (Stage 3, additive). */
  list?: string;
}

export function TextField({
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
  type = 'text',
  placeholder,
  autoComplete,
  maxLength,
  list,
}: TextFieldProps): JSX.Element {
  const ids = useFieldIds(id, hint, error);
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
      <div className="jf-input">
        <input
          id={ids.inputId}
          name={name}
          className="jf-input__control"
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          maxLength={maxLength}
          list={list}
          disabled={disabled}
          {...controlAria(ids, error, required)}
        />
      </div>
    </FieldFrame>
  );
}
