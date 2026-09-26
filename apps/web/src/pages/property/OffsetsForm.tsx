// Link offset accounts (stage-4.md §6.5 item 5, D67): a checkbox per account flagged Offset on the
// Cash page (its name and balance; one linked to another loan says so and moves here when saved).
// With none: "Mark an account as an offset on the Cash page first". `PUT …/loans/:id/offsets`
// replaces the loan's links with the ticked set.
import type { LoanDto, PropertyPageResponse } from '@joinr/schema';
import { Checkbox, Stack, formatMoney } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';
import { useSaveLoanOffsets } from '../../api/hooks';
import { InlineForm, NewAppDataNote } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import { NO_OFFSET_ACCOUNTS } from './propertyText';

export interface OffsetsFormProps {
  page: PropertyPageResponse;
  loan: LoanDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function OffsetsForm({ page, loan, onDone, onCancel }: OffsetsFormProps): JSX.Element {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(loan.offsetAccountIds));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveLoanOffsets();
  const accounts = page.offsetAccounts;
  const before = new Set(loan.offsetAccountIds);
  const pristine = ticked.size === before.size && [...ticked].every((id) => before.has(id));
  const loanName = (id: number | null): string | null =>
    id === null ? null : (page.loans.find((l) => l.id === id)?.name ?? null);

  const toggle = (id: number, checked: boolean): void => {
    setTicked((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = (): boolean => {
    setError(null);
    save.mutate(
      {
        loanId: loan.id,
        body: { accountIds: accounts.filter((a) => ticked.has(a.id)).map((a) => a.id) },
      },
      {
        onSuccess: () => onDone('Offsets linked'),
        onError: (e) => setError(formErrorsOf<never>(e, []).form),
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Offset accounts · ${loan.name}`}
      subtitle="Mortgage"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={error}
      saveLabel="Save links"
      notes={accounts.length > 0 ? <NewAppDataNote /> : null}
    >
      {accounts.length === 0 ? (
        <p className="jf-app-meta">
          {NO_OFFSET_ACCOUNTS}: <Link to="/cash">go to the Cash page</Link>.
        </p>
      ) : (
        <fieldset className="jf-app-fieldset">
          <legend className="jf-field__label">Offset accounts linked to this loan</legend>
          <Stack gap={2}>
            {accounts.map((account) => {
              const other = account.linkedLoanId !== null && account.linkedLoanId !== loan.id;
              const hint = [
                `${formatMoney(account.balanceCents)}`,
                other
                  ? `now linked to ${loanName(account.linkedLoanId) ?? 'another loan'}: saving moves it here`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Checkbox
                  key={account.id}
                  label={account.name}
                  hint={hint}
                  checked={ticked.has(account.id)}
                  onChange={(checked) => toggle(account.id, checked)}
                  disabled={save.isPending}
                />
              );
            })}
          </Stack>
        </fieldset>
      )}
    </InlineForm>
  );
}
