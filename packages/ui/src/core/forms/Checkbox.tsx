import { Check } from 'lucide-react';
import type { JSX } from 'react';
import { cx } from '../cx';
import { useFieldIds } from './Field';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  name?: string;
  hint?: string;
  disabled?: boolean;
}

/** A switch has the same props as a checkbox (it renders `role="switch"`). */
export type SwitchProps = CheckboxProps;

interface ToggleProps extends CheckboxProps {
  kind: 'check' | 'switch';
}

function Toggle({
  kind,
  label,
  checked,
  onChange,
  id,
  name,
  hint,
  disabled,
}: ToggleProps): JSX.Element {
  const ids = useFieldIds(id, hint, undefined);
  const block = kind === 'check' ? 'jf-check' : 'jf-switch';
  return (
    <div className={cx(block, disabled && `${block}--disabled`)}>
      <span className={`${block}__control`}>
        <input
          id={ids.inputId}
          name={name}
          type="checkbox"
          role={kind === 'switch' ? 'switch' : undefined}
          className={`${block}__input`}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={ids.describedBy}
        />
        {kind === 'check' ? (
          <span className="jf-check__box" aria-hidden="true">
            <Check className="jf-check__mark" size={14} strokeWidth={3} />
          </span>
        ) : (
          <span className="jf-switch__track" aria-hidden="true">
            <span className="jf-switch__thumb" />
          </span>
        )}
      </span>
      <label htmlFor={ids.inputId} className={`${block}__label`}>
        {label}
      </label>
      {hint ? (
        <p id={ids.hintId} className={`${block}__hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A checkbox with its label to the right. */
export function Checkbox(props: CheckboxProps): JSX.Element {
  return <Toggle kind="check" {...props} />;
}

/** An on/off switch (`role="switch"`): the thumb position and fill both show the state. */
export function Switch(props: SwitchProps): JSX.Element {
  return <Toggle kind="switch" {...props} />;
}
