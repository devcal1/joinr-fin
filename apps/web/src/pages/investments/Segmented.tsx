// A segmented choice (Buy / Sell, Units / Amount): Buttons with aria-pressed in a labelled group,
// shaped like a form field (uppercase label above, a hint or an error below).
import { Button, Icon } from '@joinr/ui';
import { CircleAlert } from 'lucide-react';
import { useId, type JSX } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  error,
  disabled,
}: SegmentedProps<T>): JSX.Element {
  const id = useId();
  const labelId = `${id}label`;
  const hintId = `${id}hint`;
  const errorId = `${id}error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className="jf-field jf-app-segmented-field">
      <p id={labelId} className="jf-field__label">
        {label}
      </p>
      <div
        className="jf-app-segmented"
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy || undefined}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            variant={option.value === value ? 'secondary' : 'ghost'}
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="jf-field__error">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="jf-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
