// The marginal-rate suggestion (stage-5.md §2.10, §6.5 item 3, D85, D90): the bracket plus the
// Medicare levy is "suggested" (the first button), the bracket alone is offered too, worded by the
// Medicare band; the LITO line in its phase-out range; the bands table (collapsed) with the date
// the ATO rates were checked. A button fills the field only (Save still sends it); a button whose
// rate is already in the field reads "In use". Nothing changes the stored rate on its own. The
// suggested rate is bold, the FY label never breaks, and the buttons are full width on phone.
import { percentTextFromRatio, type MarginalRateSuggestionDto } from '@joinr/schema';
import { Button, Card, ColumnTable } from '@joinr/ui';
import type { JSX } from 'react';
import { formatRate } from '../assets/display';
import {
  LITO_TEXT,
  NO_SALARY_TEXT,
  checkedOnText,
  draftMatches,
  taxBands,
  taxSuggestionParts,
  taxTableNotes,
  type SettingDraft,
} from './settingsForm';

export function TaxSuggestion({
  suggestion,
  draft,
  disabled,
  onUse,
}: {
  suggestion: MarginalRateSuggestionDto | null;
  /** The marginal-rate field's draft (a percentage). */
  draft: SettingDraft;
  disabled: boolean;
  /** Fills the field with a percentage (the form still needs Save). */
  onUse: (percentText: string) => void;
}): JSX.Element {
  if (suggestion === null) {
    return (
      <p className="jf-app-meta" data-testid="tax-suggestion-none">
        {NO_SALARY_TEXT}
      </p>
    );
  }
  const suggested = formatRate(suggestion.suggestedRatio) ?? suggestion.suggestedRatio;
  const bracket = formatRate(suggestion.bracketRatio) ?? suggestion.bracketRatio;
  const levy = suggestion.medicare.band !== 'none';
  // D90: the bracket plus the levy is the "suggested" figure and the first button.
  const choices = levy
    ? [
        { ratio: suggestion.suggestedRatio, rate: suggested, note: ' (suggested)' },
        { ratio: suggestion.bracketRatio, rate: bracket, note: ' (without the levy)' },
      ]
    : [{ ratio: suggestion.bracketRatio, rate: bracket, note: '' }];
  const bands = taxBands(suggestion);
  const parts = taxSuggestionParts(suggestion);
  return (
    <Card as="section" title="Suggested marginal rate" className="jf-app-tax-card">
      <div className="jf-app-block jf-app-block--tight" data-testid="tax-suggestion">
        <p data-testid="tax-suggestion-text">
          {parts.lead}
          <span className="jf-app-nowrap">{parts.fy}</span>
          {parts.body}
          {parts.rate !== null ? <strong className="jf-app-strong">{parts.rate}</strong> : null}
          {parts.tail}
        </p>
        {suggestion.litoPhaseOut ? <p className="jf-app-meta">{LITO_TEXT}</p> : null}
        {taxTableNotes(suggestion).map((note) => (
          <p key={note} className="jf-app-meta">
            {note}
          </p>
        ))}
        <div className="jf-app-tax-actions" data-testid="tax-actions">
          {choices.map((choice) => {
            const inUse = draftMatches(draft, choice.ratio);
            return (
              <Button
                key={choice.ratio + choice.note}
                variant="secondary"
                size="sm"
                disabled={disabled || inUse}
                onClick={() => onUse(percentTextFromRatio(choice.ratio))}
              >
                {inUse ? 'In use' : `Use ${choice.rate}`}
                {choice.note}
              </Button>
            );
          })}
        </div>
        <details className="jf-app-details">
          <summary className="jf-app-details__summary">Tax bands</summary>
          <ColumnTable
            columns={[
              { id: 'band', header: 'Band', value: (b) => b.band, minWidth: 160 },
              { id: 'rate', header: 'Rate', value: (b) => b.rate, numeric: true },
            ]}
            rows={bands}
            getRowId={(b) => b.band}
            caption="Resident tax bands"
          />
        </details>
        <p className="jf-app-meta">{checkedOnText(suggestion)}</p>
      </div>
    </Card>
  );
}
