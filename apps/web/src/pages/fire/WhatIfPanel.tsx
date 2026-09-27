// The what-if panel (stage-6.md §6.4, D100): a result strip, six labelled number fields each with a
// paired range slider, "Save as my settings" and "Reset". The field is the source of truth: valid
// text is reported as it is typed (the page debounces the recompute), Enter commits the field and
// recomputes at once (it never saves: the panel is not a submitting form), a cleared field reverts
// on blur and sends nothing, and out-of-range text shows its error and sends nothing. A slider only
// reports user input, snapped to its step; its keys are handled explicitly.
import { FIRE_FIELD_LABELS, type FireWhatIfField } from '@joinr/schema';
import { Button, Card, Icon, cx } from '@joinr/ui';
import { CircleAlert, RotateCcw, Save } from 'lucide-react';
import { useId, useState, type ChangeEvent, type JSX, type KeyboardEvent } from 'react';
import {
  WHAT_IF_FIELDS,
  changedFields,
  fromSlider,
  inputText,
  parseField,
  saveSummary,
  sameValue,
  sliderKeyValue,
  sliderRange,
  sliderValue,
  sliderValueText,
  snapToStep,
  valueWords,
  whatIfFieldId,
  type WhatIfBase,
  type WhatIfTouched,
  type WhatIfValue,
} from './whatIf';

interface WhatIfFieldProps {
  field: FireWhatIfField;
  /** The value shown: the user's, else the value in use. */
  value: WhatIfValue | null;
  /** The value in use without a what-if (saved, derived or default). */
  base: WhatIfValue | null;
  touched: boolean;
  /** A server validation error for this field. */
  error?: string;
  onChange: (field: FireWhatIfField, value: WhatIfValue) => void;
  /** Enter: recompute at once. */
  onCommit: () => void;
}

const UNIT_START: Partial<Record<FireWhatIfField, string>> = { spend: '$', extraSavings: '$' };
const UNIT_END: Partial<Record<FireWhatIfField, string>> = {
  withdrawalRate: '%',
  inflationRate: '%',
  marketReturn: '%',
};

function WhatIfField({
  field,
  value,
  base,
  touched,
  error,
  onChange,
  onCommit,
}: WhatIfFieldProps): JSX.Element {
  const labelId = useId();
  const inputId = whatIfFieldId(field);
  const errorId = `${inputId}-error`;
  const savedId = `${inputId}-saved`;
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const text = draft ?? inputText(field, value);
  const shownError = message ?? error;
  const differs = touched && value !== null && (base === null || !sameValue(field, value, base));

  const position = sliderValue(field, value);
  const inUse = sliderValue(field, base);
  const range = sliderRange(field, position, inUse);

  const commit = (): void => {
    if (draft === null) return;
    const result = parseField(field, draft);
    if (result === null) {
      // A cleared field shows the value in use again; nothing is sent.
      setDraft(null);
      setMessage(undefined);
      return;
    }
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    setDraft(null);
  };

  const onText = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setDraft(next);
    const result = parseField(field, next);
    if (result?.ok) {
      setMessage(undefined);
      onChange(field, result.value);
    }
  };

  const fromPosition = (next: number): void => {
    setDraft(null);
    setMessage(undefined);
    onChange(field, fromSlider(field, snapToStep(next, range)));
  };

  const onSliderKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const next = sliderKeyValue(event.key, position, range);
    if (next === null) return;
    event.preventDefault();
    fromPosition(next);
  };

  const describedBy = [shownError ? errorId : null, differs ? savedId : null]
    .filter(Boolean)
    .join(' ');
  const start = UNIT_START[field];
  const end = UNIT_END[field];

  return (
    <div
      className={cx('jf-field', 'jf-app-fire-field', shownError && 'jf-field--invalid')}
      data-field={field}
    >
      <label id={labelId} htmlFor={inputId} className="jf-field__label">
        {FIRE_FIELD_LABELS[field]}
      </label>
      <div className="jf-input jf-input--numeric">
        {start ? (
          <span className="jf-input__adorn jf-input__adorn--start" aria-hidden="true">
            {start}
          </span>
        ) : null}
        <input
          id={inputId}
          className="jf-input__control"
          type="text"
          inputMode={field === 'extraSavings' ? 'text' : 'decimal'}
          autoComplete="off"
          value={text}
          onFocus={() => {
            if (draft === null) setDraft(inputText(field, value));
          }}
          onChange={onText}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter commits this field and recomputes at once; it never saves.
            event.preventDefault();
            commit();
            onCommit();
          }}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        {end ? (
          <span className="jf-input__adorn jf-input__adorn--end" aria-hidden="true">
            {end}
          </span>
        ) : null}
      </div>
      <input
        type="range"
        className="jf-app-fire-slider"
        min={range.min}
        max={range.max}
        step={range.step}
        value={position ?? range.min}
        // No value yet (a missing withdrawal rate): the thumb is hidden until one is set (STYLE-8).
        data-unset={position === null ? '' : undefined}
        aria-labelledby={labelId}
        aria-valuetext={sliderValueText(field, value)}
        onChange={(event) => fromPosition(Number(event.target.value))}
        onKeyDown={onSliderKey}
      />
      {shownError ? (
        <p id={errorId} className="jf-field__error">
          <Icon icon={CircleAlert} />
          <span>{shownError}</span>
        </p>
      ) : null}
      {differs ? (
        <p id={savedId} className="jf-field__hint jf-app-fire-saved">
          Saved: {valueWords(field, base)}
        </p>
      ) : null}
    </div>
  );
}

export interface WhatIfPanelProps {
  touched: WhatIfTouched;
  base: WhatIfBase;
  onChange: (field: FireWhatIfField, value: WhatIfValue) => void;
  onCommit: () => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  saveError: string | null;
  fieldErrors: Partial<Record<FireWhatIfField, string>>;
  /** The result strip's words ("Updating…" while a what-if loads). */
  strip: string;
  updating: boolean;
}

export function WhatIfPanel({
  touched,
  base,
  onChange,
  onCommit,
  onSave,
  onReset,
  saving,
  saveError,
  fieldErrors,
  strip,
  updating,
}: WhatIfPanelProps): JSX.Element {
  const changed = changedFields(touched, base);
  const summary = saveSummary(touched, base);
  const savesSpend = changed.includes('spend');
  const savesReturn = changed.includes('marketReturn');
  const spendWords =
    savesSpend && touched.spend !== undefined ? valueWords('spend', touched.spend) : '';
  return (
    <Card className="jf-app-fire-whatif" padding="normal">
      <p className="jf-app-fire-strip" data-updating={updating || undefined}>
        {updating ? 'Updating…' : strip}
      </p>
      <div className="jf-app-fire-fields">
        <div className="jf-app-fire-fields__grid">
          {WHAT_IF_FIELDS.map((field) => (
            <WhatIfField
              key={field}
              field={field}
              value={touched[field] ?? base[field]}
              base={base[field]}
              touched={touched[field] !== undefined}
              error={fieldErrors[field]}
              onChange={onChange}
              onCommit={onCommit}
            />
          ))}
        </div>
      </div>
      {summary ? (
        <div className="jf-app-fire-save-summary">
          <p>{summary}</p>
          {savesSpend ? (
            <p className="jf-app-muted">
              Your spend will stay at {spendWords} until you choose Use the derived figure.
            </p>
          ) : null}
          {savesReturn ? (
            <p className="jf-app-muted">
              Sets a return for FIRE only; the Investing return is unchanged.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="jf-app-fire-actions">
        <Button
          variant="primary"
          icon={Save}
          onClick={onSave}
          disabled={changed.length === 0 || saving}
        >
          {saving ? 'Saving…' : 'Save as my settings'}
        </Button>
        <Button icon={RotateCcw} onClick={onReset} disabled={changed.length === 0 || saving}>
          Reset
        </Button>
      </div>
      {saveError ? (
        <p className="jf-field__error jf-app-fire-save-error">
          <Icon icon={CircleAlert} />
          <span>Couldn’t save: {saveError}</span>
        </p>
      ) : null}
      <p className="jf-app-muted jf-app-fire-note">
        Saving never blocks re-importing the workbook.
      </p>
    </Card>
  );
}
