// The SG-fund Select + Save (stage-4.md §6.4 items 3–4, UX-24): in the no-SG-fund callout and the
// Funds section header. It sends only `receivesSg` (the name and archived flag echoed), so it keeps
// re-import available and says so ("Choosing the SG fund keeps re-import available").
import type { SuperFundDto } from '@joinr/schema';
import { Button, Select } from '@joinr/ui';
import { Save } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useUpdateSuperFund } from '../../api/hooks';
import { FormError } from '../cashflow/forms';
import { actionErrorText } from '../cashflow/formState';
import { SG_FUND_KEPT } from './superText';

export interface SgFundPickerProps {
  funds: readonly SuperFundDto[];
  /** Distinguishes the two pickers' field ids and names. */
  label?: string;
  onDone: (message: string) => void;
  /** Show the import-safe note under the picker. */
  showNote?: boolean;
}

export function SgFundPicker({
  funds,
  label = 'Fund that receives SG',
  onDone,
  showNote = false,
}: SgFundPickerProps): JSX.Element | null {
  const held = funds.filter((f) => !f.archived);
  const current = held.find((f) => f.receivesSg) ?? null;
  // null = follow the saved SG fund, so a save from the other picker (or the fund form) shows here.
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSuperFund();
  if (held.length === 0) return null;
  const value = choice ?? (current ? String(current.id) : '');
  const chosen = held.find((f) => String(f.id) === value) ?? null;
  const unchanged = chosen === null || chosen.id === current?.id;

  const save = (): void => {
    if (!chosen || unchanged) return;
    setError(null);
    // In the no-SG-fund callout, saving clears the flag and the callout (with this picker)
    // unmounts, and TanStack Query skips the mutate() callbacks of an unmounted observer; the
    // mutateAsync promise still settles, so the page announces the save.
    void update
      .mutateAsync({
        id: chosen.id,
        body: { name: chosen.name, receivesSg: true, archived: chosen.archived },
      })
      .then(
        () => {
          setChoice(null);
          onDone('SG fund saved');
        },
        (e: unknown) => setError(actionErrorText(e)),
      );
  };

  return (
    <div className="jf-app-sg-picker">
      <div className="jf-app-sg-picker__row">
        <Select
          label={label}
          value={value}
          onChange={setChoice}
          options={held.map((f) => ({ value: String(f.id), label: f.name }))}
          placeholder="Choose a fund"
          disabled={update.isPending}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={Save}
          onClick={save}
          disabled={unchanged || update.isPending}
          aria-busy={update.isPending || undefined}
          aria-label={`Save: ${label}`}
        >
          Save
        </Button>
      </div>
      {showNote ? <p className="jf-app-meta">{SG_FUND_KEPT}.</p> : null}
      <FormError message={error} />
    </div>
  );
}
