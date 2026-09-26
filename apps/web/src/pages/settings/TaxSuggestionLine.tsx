// The Super page's line beside the marginal tax rate (stage-5.md §6.5 item 10, D85, D90):
// "Suggested 32% for your salary (see Settings: Pay and tax)", from `['settings']`'s tax
// suggestion; nothing without one (no gross salary, or the settings not loaded).
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useSettingsPage } from '../../api/hooks';
import { formatRate } from '../assets/display';

export function TaxSuggestionLine(): JSX.Element | null {
  const { data } = useSettingsPage();
  const suggestion = data?.taxSuggestion ?? null;
  if (!suggestion) return null;
  const rate = formatRate(suggestion.suggestedRatio) ?? suggestion.suggestedRatio;
  return (
    <span data-testid="tax-suggestion-line">
      Suggested {rate} for your salary (see{' '}
      <Link to="/settings" hash="pay">
        Settings: Pay and tax
      </Link>
      )
    </span>
  );
}
